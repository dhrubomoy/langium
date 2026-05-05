# Phase 1: langium-cli Generators on Tree-sitter SyntaxNode

**Date:** 2026-05-04  
**Branch:** langium-treesitter  
**Status:** Approved, pending implementation plan

---

## Context

The `langium-treesitter` branch replaces Chevrotain with tree-sitter (web-tree-sitter WASM) as Langium's runtime parser. Through US-028, a set of Chevrotain-based parser implementations were vendored into `packages/langium-cli/src/grammar-parser/` (~2,823 lines, 11 files) so that `.langium` grammar files could still be parsed for code generation after Chevrotain was removed from `packages/langium`.

This design replaces that vendored infrastructure and the Chevrotain-era `GrammarAST` types in the `langium-cli` code generation pipeline entirely. Tree-sitter's `SyntaxNode` becomes the sole representation.

**This is Phase 1 of 3:**
- **Phase 1 (this spec):** `langium-cli` generators work directly from tree-sitter `SyntaxNode`. `GrammarAST` no longer used in CLI.
- **Phase 2:** `langium-vscode` language server reimplemented with tree-sitter (LSP features for `.langium` files).
- **Phase 3:** `langium/grammar` module and `GrammarAST` types deleted entirely.

---

## Goal

Eliminate all Chevrotain code and `GrammarAST` usage from the `langium-cli` code generation pipeline. The `langium generate` command parses `.langium` files using tree-sitter and generates TypeScript code directly from `SyntaxNode` trees.

---

## Architecture

```
packages/langium-cli/
  src/
    grammar-parser/
      grammar.js               ← tree-sitter grammar for .langium (source of truth)
      langium-grammar.wasm     ← pre-compiled binary artifact (committed to repo)
      grammar-parser.ts        ← parse .langium text → SyntaxNode
      grammar-queries.ts       ← ergonomic SyntaxNode query + semantic analysis helpers
    generator/
      ast-generator.ts         ← rewritten: SyntaxNode → TypeScript interfaces
      module-generator.ts      ← rewritten: SyntaxNode → DI module
      bnf-generator.ts         ← rewritten: SyntaxNode → BNF notation
      grammar-js-compiler.ts   ← rewritten: SyntaxNode → tree-sitter grammar.js
      metadata-compiler.ts     ← rewritten: SyntaxNode → metadata.ts
      types-generator.ts       ← rewritten: SyntaxNode → type file
      grammar-serializer.ts    ← deleted: serialized grammar.ts no longer generated
      (highlighting generators) ← rewritten: SyntaxNode → Monarch/TextMate/Prism
    generate.ts                ← refactored: calls GrammarParser directly, no DI services
```

**Data flow:**

```
.langium file(s)
  → grammar-parser.ts  (web-tree-sitter + langium-grammar.wasm)
  → SyntaxNode tree(s) (one per file, keyed by URI)
  → grammar-queries.ts (shared structural + semantic helpers)
  → generators         (emit TypeScript using expandToNode/expandToString)
  → output files
```

Nothing downstream of the generators changes. Consumers of the generated code (the `langium` runtime, user language projects) are unaffected.

---

## Components

### 1. `grammar.js` + `langium-grammar.wasm`

A tree-sitter grammar covering all 69 parser rules and 4 terminal rules from `langium-grammar.langium` and `langium-types.langium`:

- Terminals: `ID`, `STRING`, `NUMBER`, `RegexLiteral`, `WS`, `SL_COMMENT`, `ML_COMMENT`
- Declares `word: $ => $.ID` and `extras: [$._whitespace, $.SL_COMMENT, $.ML_COMMENT]`
- Named nodes for every grammar construct: `parser_rule`, `terminal_rule`, `infix_rule`, `assignment`, `alternatives`, `group`, `keyword`, `rule_call`, `cross_reference`, `action`, `interface_decl`, `type_decl`, etc.

**Build artifact:** `langium-grammar.wasm` is committed to the repo. A `build:grammar-wasm` npm script in `langium-cli/package.json` regenerates it when `grammar.js` changes:

```
tree-sitter generate && tree-sitter build-wasm
```

Consumers of `langium-cli` (including `langium-vscode`) never need to run this. Same model used by all published tree-sitter grammars.

---

### 2. `grammar-parser.ts`

```typescript
interface GrammarParser {
    parse(uri: string, text: string): SyntaxNode
    parseWithImports(entryPath: string): Promise<ParsedGrammarSet>
}

type ParsedGrammarSet = Map<string, SyntaxNode>  // uri → tree root
```

- Loads `langium-grammar.wasm` once at construction via the existing `WasmLoader` service.
- `parse()` calls `web-tree-sitter`'s `Parser.parse()` and returns the root `SyntaxNode`.
- `parseWithImports()` walks `grammar_import` nodes in the parsed tree, resolves relative paths, loads and parses each imported file, and recurses transitively. Returns a `ParsedGrammarSet` containing all files.
- Plain async class — no Langium DI services involved.

---

### 3. `grammar-queries.ts`

Shared semantic analysis layer. All exports are plain functions over `SyntaxNode` / `ParsedGrammarSet`. No new class hierarchy or intermediate AST types.

**Structural queries** (direct SyntaxNode navigation):

| Function | Returns |
|---|---|
| `getRules(root)` | `SyntaxNode[]` — all parser rules |
| `getTerminals(root)` | `SyntaxNode[]` — all terminal rules |
| `getInterfaces(root)` | `SyntaxNode[]` — interface declarations |
| `getTypes(root)` | `SyntaxNode[]` — type alias declarations |
| `getImports(root)` | `SyntaxNode[]` — import statements |
| `getRuleName(rule)` | `string` |
| `getRuleReturnType(rule)` | `string \| null` |
| `isEntryRule(rule)` | `boolean` |
| `isFragment(rule)` | `boolean` |
| `getTerminalPattern(terminal)` | `string` — regex source |
| `getAssignments(rule)` | `AssignmentInfo[]` |

**Semantic analysis** (cross-rule, cross-file resolution):

| Function | Returns |
|---|---|
| `collectTypes(set)` | `TypeInfo[]` — all types inferred from rules + explicit declarations |
| `collectFields(typeName, set)` | `FieldInfo[]` — all fields for a given type |
| `resolveRuleRef(name, set)` | `SyntaxNode \| null` — find a rule by name across the grammar set |
| `getTypeHierarchy(set)` | `Map<string, string[]>` — type → supertype names |

**Result records** (plain POJOs, not AST nodes):

```typescript
interface AssignmentInfo {
    feature: string
    operator: '=' | '+=' | '?='
    isRef: boolean
    typeText: string   // raw text of RHS (rule call name, keyword, etc.)
}

interface TypeInfo {
    name: string
    superTypes: string[]
    isInterface: boolean  // from explicit 'interface' declaration
}

interface FieldInfo {
    name: string
    operator: '=' | '+=' | '?='
    type: string
    isRef: boolean
    isOptional: boolean
}
```

These records have no `$cstNode`, no lazy `Reference<T>`, no container links.

---

### 4. Rewritten generators

Each generator drops all imports from `langium/grammar` and uses `grammar-queries.ts` helpers instead. The code emission layer (`expandToNode`, `expandToString`, `joinToNode`) is unchanged.

**`ast-generator.ts`:** Calls `collectTypes(set)` and `collectFields(typeName, set)` to emit TypeScript `interface` and `type` declarations. Type inference logic (currently in `grammar-utils.ts`) moves into `collectTypes`/`collectFields`.

**`module-generator.ts`:** Calls `getRules(root)` and `isEntryRule(rule)` to emit the DI module.

**`bnf-generator.ts`:** Walks rule `SyntaxNode`s directly to emit BNF notation.

**`grammar-js-compiler.ts`:** Uses structural queries to navigate parser/terminal rule structure and emit tree-sitter `grammar.js` for the user's language.

**`metadata-compiler.ts`:** Calls `collectTypes` and `collectFields` to emit `metadata.ts`.

**`grammar-serializer.ts`:** Deleted. This file serialized `GrammarAST` to a JSON blob embedded in generated `grammar.ts` files so the Langium runtime could access grammar structure at runtime. In the tree-sitter world, the runtime uses `grammar.wasm` and `metadata.ts` instead. Neither `grammar-serializer.ts` nor its output `grammar.ts` are generated in Phase 1.

**Highlighting generators:** Walk terminal rule `SyntaxNode`s for pattern extraction.

---

### 5. Refactored `generate.ts`

The top-level generate action currently creates grammar services via DI (`createCliLangiumGrammarServices`) and drives the Langium `DocumentBuilder` pipeline. This is replaced with a direct call:

```typescript
const parser = new DefaultGrammarParser();
const grammarSet = await parser.parseWithImports(entryFilePath);
// run validators directly on grammarSet
// run each generator with grammarSet
```

No `createCliLangiumGrammarServices`, no `DocumentBuilder`, no `LangiumDocuments`.

---

## What Is Deleted

| Deleted | Lines |
|---|---|
| `grammar-parser/langium-parser.ts` | 912 |
| `grammar-parser/parser-builder-base.ts` | 532 |
| `grammar-parser/indentation-aware.ts` | 435 |
| `grammar-parser/regexp-utils.ts` | 313 |
| `grammar-parser/cst-node-builder.ts` | 279 |
| `grammar-parser/token-builder.ts` | 164 |
| `grammar-parser/lexer.ts` | 117 |
| `grammar-parser/langium-parser-builder.ts` | 30 |
| `grammar-parser/completion-parser-builder.ts` | 18 |
| `grammar-parser/index.ts` | 16 |
| `grammar-parser/parser-config.ts` | 7 |
| `create-grammar-services.ts` | 56 |
| `generator/grammar-serializer.ts` | 63 |
| **Total removed** | **~2,942 lines** |

Dependencies removed from `langium-cli/package.json`:
- `chevrotain`
- `chevrotain-allstar`
- `@chevrotain/regexp-to-ast`

---

## What Is NOT Changed in Phase 1

- `packages/langium/src/grammar/` — `GrammarAST` types remain (still used by `langium-vscode`)
- `packages/langium-vscode/` — unchanged (Phase 2)
- Generated output format — `langium generate` produces identical TypeScript files
- `packages/langium/` runtime — unaffected

---

## Testing Strategy

- **Regression baseline:** The 132 passing `langium-cli` tests serve as the pass/fail benchmark.
- **Parser smoke test:** Parse the arithmetic `.langium` and `langium-grammar.langium` files and assert expected SyntaxNode structure.
- **Query unit tests:** Test `collectTypes`, `collectFields`, `getAssignments` against known grammar snippets.
- **Generator output tests:** Existing generator snapshot tests pass with identical output using the new pipeline.

---

## Open Questions

None. Cross-reference resolution within the grammar set (e.g. rule calls, type references) is handled by `resolveRuleRef` in `grammar-queries.ts` using name lookup across the `ParsedGrammarSet`. This is sufficient for code generation; full scope-aware linking is a Phase 2 concern.
