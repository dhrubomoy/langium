# Plan: Replace Chevrotain with Tree-sitter

## Architectural Decisions

### What gets deleted
- All Chevrotain and `chevrotain-allstar` dependencies
- `LangiumParser`, `ChevrotainWrapper`, `AbstractLangiumParser`
- `LangiumCompletionParser` (deferred to v2)
- `CstNodeBuilder`, `RootCstNodeImpl`, `CompositeCstNodeImpl`, `LeafCstNodeImpl`
- `TokenBuilder`, `DefaultLexer`
- `cst-node-builder.ts`, `cst-utils.ts`
- All CST interfaces from `syntax-tree.ts` (`CstNode`, `CompositeCstNode`, `LeafCstNode`, `RootCstNode`)
- `parser-builder-base.ts`, `langium-parser.ts`, `langium-parser-builder.ts`

### Dropped grammar features (breaking changes)
| Feature | Reason |
|---|---|
| `UnorderedGroup` (`&`) | No tree-sitter equivalent |
| `RuleParameter` / `GuardCondition` (`<param>`) | No tree-sitter equivalent |
| `NegatedToken` (`!element`) | No tree-sitter equivalent — use regex |
| `UntilToken` (`->element`) | No tree-sitter equivalent — use regex |
| Semantic predicates (`=>`, `->` on grammar elements) | No tree-sitter equivalent |
| Terminal lookahead assertions (`?=`, `?!`, `?<=`, `?<!`) | No tree-sitter equivalent |

### New grammar features added to `.langium` syntax
```langium
// Keyword disambiguation — marks which terminal is tree-sitter's word rule
@word terminal ID: /[a-zA-Z_][a-zA-Z0-9_]*/;

// Precedence annotation on alternatives or rule elements
Expression:
    @prec(2) left=Expression op='+' right=Expression
  | @prec(1) left=Expression op='*' right=Expression
  | value=INT;

// Explicit conflict declarations at grammar top level
conflicts:
    [Expression, Statement];
```

---

## v1: Arithmetic Example End-to-End

**Goal:** Make a simple arithmetic language with variable declarations and cross-references
work end-to-end using incremental parsing.

### New Components

#### 1. Grammar Compiler (extends `langium generate`)
- **Input:** `.langium` grammar file
- **Outputs:**
  - `grammar.js` — tree-sitter grammar definition
  - `src/generated/metadata.ts` — mapping table (see below)
  - `resources/grammar.wasm` — compiled via tree-sitter CLI (invoked internally)
- **Responsibilities:**
  - Translate parser rules → tree-sitter `seq()`, `choice()`, `repeat()`, `optional()`
  - Translate `InfixRule` → `prec.left()` / `prec.right()`
  - Translate assignments (`=`, `+=`, `?=`) → `field('name', ...)` in grammar.js + metadata entry
  - Translate `Action` (`{infer T}`) → metadata entry (node type variant selection)
  - Translate `CrossReference` (`[Type:T]`) → `field('name', ...)` + metadata `isRef: true`
  - Emit `@word` terminal as grammar.js `word` property
  - Emit `@prec` annotations as `prec()` wrappers
  - Emit `conflicts` block as grammar.js `conflicts` array
  - Expand `fragment` rules → `_`-prefixed inline rules
  - Map `hidden terminal` → `extras` array
  - Emit compile error for dropped features with migration hint

#### 2. Metadata Table (`src/generated/metadata.ts`)
Generated artifact describing how to interpret tree-sitter node types:

```ts
export const METADATA: GrammarMetadata = {
  program: {
    astType: 'Program',
    fields: {
      statements: { operator: '+=', isRef: false }
    }
  },
  var_decl: {
    astType: 'VarDecl',
    fields: {
      name: { operator: '=', isRef: false },
      value: { operator: '=', isRef: false }
    }
  },
  expression: {
    astType: 'BinaryExpr',
    fields: {
      left:  { operator: '=', isRef: false },
      op:    { operator: '=', isRef: false },
      right: { operator: '=', isRef: false }
    },
    passThrough: true   // if no 'op' field present, unwrap to child node
  },
  primary_number: {
    astType: 'NumberLit',
    fields: { value: { operator: '=', isRef: false, transform: 'number' } }
  },
  primary_varref: {
    astType: 'VarRef',
    fields: { ref: { operator: '=', isRef: true, refType: 'VarDecl' } }
  }
};
```

#### 3. WASM Loader
- Reads `resources/grammar.wasm` via `context.extensionUri` (path-based, works in both Node.js and web extensions)
- `extensionUri` is threaded through `createLangiumServices()` as an initialization parameter
- Initializes `web-tree-sitter` `Language` before any parsing begins

#### 4. Document Index (replaces CST + AST + Linker)
Built by a single pass over the tree-sitter `SyntaxNode` tree using the metadata table:

```ts
interface DocumentIndex {
  declarations: Map<string, { type: string; range: Range }[]>;  // name → declaration sites
  references:   Map<string, Range[]>;                           // name → reference sites
  diagnostics:  Diagnostic[];                                   // ERROR/MISSING nodes → generic "Syntax error"
}
```

- Rebuilt fully after every document update
- tree-sitter incremental parsing reduces what is re-parsed in its C layer; the index walk runs over the full new tree
- Error collection (ERROR/MISSING nodes) happens in the same pass — no second traversal

#### 5. LSP Services (v1 scope)

| Feature | Implementation |
|---|---|
| Parse error diagnostics | `diagnostics` from DocumentIndex |
| Cross-ref diagnostics | References with no matching declaration in index |
| Go-to-definition | Look up name in `declarations` map |
| Find references | Look up name in `references` map |
| Document symbols | All entries in `declarations` map |
| Rename | All entries in `declarations` + `references` for that name |
| Folding ranges | tree-sitter node ranges directly |

### Implementation Order

1. **Add `web-tree-sitter` dependency** and wire up WASM loading via `extensionUri` in the service container
2. **Hand-write `grammar.js` + `metadata.ts` for arithmetic** — skip the compiler, validate the full pipeline end-to-end first
3. **Build `DocumentIndex` and index builder** — single-pass tree walk using the hand-written metadata
4. **Wire up the 7 LSP services** against the index
5. **Build the grammar compiler** — now that the output format is validated by hand, generate it from `.langium`

### v1 Out of Scope
- Code completion
- Hover
- Semantic tokens
- Range-based incremental link invalidation
- `external terminal` declarations (external C scanner)
- Error message enrichment beyond generic "Syntax error"

---

## v2: Incremental Linker + Full LSP

### Index-based incremental linker
- Use tree-sitter `node.hasChanges` after incremental parse to identify dirty ranges
- Only re-resolve references whose source range overlaps a changed node
- Replaces the full index rebuild from v1 with a partial update

### Enriched error messages
- Use metadata table to infer expected tokens at `ERROR` node positions
- Report "Expected expression" instead of generic "Syntax error"
- Implement as `TreeSitterDiagnosticEnricher` service, optional override per language

### Code completion
- Compute follow sets statically from grammar at compile time
- Emit follow set table in `metadata.ts` alongside the mapping table
- Runtime: at cursor position, find enclosing tree-sitter node → look up valid next tokens in follow set table

### External scanner support
- New `external terminal` declaration in `.langium` grammar syntax
- Grammar compiler generates a C scanner skeleton (`scanner.c`)
- Language authors implement the scanner body for patterns that can't be expressed as regex
  (e.g. nested comments, indentation-sensitive parsing, heredocs)

### Hover and semantic tokens
- Hover: derive type information from index + metadata table
- Semantic tokens: classify tree-sitter node types using metadata `astType` mapping
