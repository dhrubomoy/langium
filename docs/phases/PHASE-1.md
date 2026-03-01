# Phase 1: Foundation — SyntaxNode + Chevrotain Adapter

**Goal**: Extract parser abstraction layer. All existing Langium tests pass. No new backends yet.

**Source of truth**: [DESIGN.md](../../DESIGN.md) §1–§4, §7, §9.Phase 1

---

## 1. Core Interfaces

### 1.1 SyntaxNode (replaces CstNode)

File: `packages/langium/src/parser/syntax-node.ts`

```typescript
/**
 * Backend-agnostic parse tree node. Replaces Langium's CstNode/CompositeCstNode/LeafCstNode.
 *
 * Design principles:
 * - No back-pointer to AST (avoids circular references; use positional lookup)
 * - No back-pointer to Grammar AST (use type string + GrammarRegistry)
 * - Lazy children (don't inflate the full tree unless walked)
 * - Immutable (parse produces a new tree)
 */
export interface SyntaxNode {
  readonly type: string;                    // Grammar rule or token name
  readonly offset: number;                  // Start offset (0-based)
  readonly end: number;                     // End offset (exclusive)
  readonly length: number;                  // end - offset
  readonly text: string;                    // Matched source text (lazy)
  readonly parent: SyntaxNode | null;       // Null for root
  readonly children: readonly SyntaxNode[]; // Including hidden tokens if retained
  readonly isLeaf: boolean;                 // True = leaf/token node
  readonly isHidden: boolean;               // Whitespace, comment
  readonly isError: boolean;                // Error/recovery node
  readonly isKeyword: boolean;              // Keyword token
  readonly tokenType: string | undefined;   // Token type name (leaf only)

  childForField(name: string): SyntaxNode | undefined;
  childrenForField(name: string): readonly SyntaxNode[];
}

export interface RootSyntaxNode extends SyntaxNode {
  readonly diagnostics: readonly ParseDiagnostic[];
}

export interface ParseDiagnostic {
  readonly message: string;
  readonly offset: number;
  readonly length: number;
  readonly severity: 'error' | 'warning';
  readonly source: 'lexer' | 'parser';
}
```

### 1.2 ParserAdapter (backend plugin interface)

File: `packages/langium/src/parser/parser-adapter.ts`

```typescript
export interface ParserAdapter {
  readonly name: string;
  readonly supportsIncremental: boolean;

  configure(grammar: Grammar, config?: ParserAdapterConfig): void;
  parse(text: string, entryRule?: string): ParseResult;
  parseIncremental?(
    text: string,
    previousState: IncrementalParseState,
    changes: readonly TextChange[]
  ): ParseResult;
  getExpectedTokens(text: string, offset: number): ExpectedToken[];
  dispose?(): void;
}

export interface ParseResult {
  readonly root: RootSyntaxNode;
  readonly incrementalState?: IncrementalParseState;
}

export type IncrementalParseState = unknown; // Opaque per-backend

export interface TextChange {
  readonly rangeOffset: number;  // Start in OLD text
  readonly rangeLength: number;  // Chars removed from OLD text
  readonly text: string;         // Inserted text
}

export interface ExpectedToken {
  readonly name: string;
  readonly isKeyword: boolean;
  readonly pattern?: RegExp | string;
}

export interface ParserAdapterConfig {
  recoveryEnabled?: boolean;
  maxLookahead?: number;
  backendConfig?: Record<string, unknown>;
}
```

### 1.3 GrammarRegistry (replaces grammarSource back-pointers)

File: `packages/langium/src/grammar/grammar-registry.ts`

```typescript
export interface GrammarRegistry {
  getRuleByName(typeName: string): AbstractRule | undefined;
  isKeyword(typeName: string): boolean;
  getAlternatives(ruleName: string): AbstractElement[];
  getAssignment(parentType: string, childType: string): Assignment | undefined;
}
```

Populated once from Grammar AST at startup. O(1) lookups by type name.

### 1.4 Modified AstNode ($syntaxNode replaces $cstNode)

File: `packages/langium/src/syntax-tree.ts`

```typescript
export interface AstNode {
  readonly $type: string;
  readonly $container?: AstNode;
  readonly $containerProperty?: string;
  readonly $containerIndex?: number;
  readonly $syntaxNode?: SyntaxNode;   // NEW — replaces $cstNode
  readonly $cstNode?: SyntaxNode;      // DEPRECATED — alias for backward compat
  readonly $document?: LangiumDocument;
}
```

---

## 2. Chevrotain Coupling Points

These files directly import/use Chevrotain and must be abstracted or wrapped:

| File | What it does | Migration action |
|------|-------------|-----------------|
| `parser/langium-parser-builder.ts` | Grammar AST → Chevrotain RULE/CONSUME/SUBRULE/OR | Wrap behind ChevrotainAdapter.configure() |
| `parser/langium-parser.ts` | LangiumParser extends Chevrotain EmbeddedActionsParser | Wrap behind ChevrotainAdapter.parse() |
| `parser/token-builder.ts` | Terminal rules → createToken() calls | Keep inside ChevrotainAdapter |
| `parser/lexer.ts` | Chevrotain Lexer wrapper | Keep inside ChevrotainAdapter |
| `parser/cst-node-builder.ts` | Builds CompositeCstNode/LeafCstNode during parse | ChevrotainSyntaxNode wraps these |
| `lsp/completion/completion-provider.ts` | computeContentAssist() for expected tokens | Use ParserAdapter.getExpectedTokens() |
| `lsp/completion/follow-element-computation.ts` | Grammar walking for completions | Generalize to use GrammarRegistry |

---

## 3. LSP Services Migration

Each service currently using CstNode/grammarSource must migrate to SyntaxNode/GrammarRegistry.

### Already migrated
- **Hover provider** (`lsp/hover-provider.ts`) — uses $syntaxNode
- **Document highlight provider** (`lsp/document-highlight-provider.ts`) — uses $syntaxNode

### Must migrate

| Service | File | CstNode usage | Migration approach |
|---------|------|--------------|-------------------|
| **Completion provider** | `lsp/completion/completion-provider.ts` | computeContentAssist(), grammar walking | Use ParserAdapter.getExpectedTokens() |
| **Formatter** | `lsp/formatter.ts` | Iterates CstNode leaves, checks isKeyword via grammarSource | Iterate SyntaxNode leaves, use .isKeyword property |
| **Definition provider** | `lsp/definition-provider.ts` | $cstNode for position mapping | Use $syntaxNode |
| **References provider** | `lsp/references-provider.ts` | $cstNode for position | Use $syntaxNode |
| **Rename provider** | `lsp/rename-provider.ts` | $cstNode for token ranges | Use $syntaxNode |
| **Semantic token provider** | `lsp/semantic-token-provider.ts` | grammarSource for token classification | Use SyntaxNode.type + GrammarRegistry |
| **Folding range provider** | `lsp/folding-range-provider.ts` | $cstNode for ranges | Use $syntaxNode |
| **Document symbol provider** | `lsp/document-symbol-provider.ts` | $cstNode for ranges | Use $syntaxNode |
| **Signature help provider** | `lsp/signature-help-provider.ts` | $cstNode for cursor context | Use $syntaxNode |
| **Call hierarchy provider** | `lsp/call-hierarchy-provider.ts` | $cstNode for ranges | Use $syntaxNode |
| **Type hierarchy provider** | `lsp/type-hierarchy-provider.ts` | $cstNode for ranges | Use $syntaxNode |
| **Type provider** | `lsp/type-provider.ts` | $cstNode | Use $syntaxNode |
| **Implementation provider** | `lsp/implementation-provider.ts` | $cstNode | Use $syntaxNode |

### No migration needed (AST-only services)
- Linker, scope provider, validation framework, document lifecycle, DI system

---

## 4. Utility Migration

### CstNode utilities → SyntaxNode utilities

| Old utility (cst-utils.ts) | New utility (syntax-node-utils.ts) | Status |
|---------------------------|-----------------------------------|--------|
| `streamCst()` | `streamSyntaxTree()` | Done |
| `findLeafNodeAtOffset()` | `findLeafSyntaxNodeAtOffset()` | Done |
| `findNodesForProperty()` | `findNodesForPropertySN()` | Done |
| `findCommentNode()` | `findCommentSyntaxNode()` | Done |
| `getPreviousNode()` | `getPreviousSyntaxNode()` | Done |
| `getNextNode()` | `getNextSyntaxNode()` | Done |

Bridge functions exist for gradual migration. See `syntax-node-utils.ts`.

---

## 5. Step-by-Step Implementation Instructions

### Step 1: Define core interfaces ✅ DONE
- Created `SyntaxNode`, `RootSyntaxNode`, `ParseDiagnostic` in `parser/syntax-node.ts`
- Created `ParserAdapter`, `ParseResult`, etc. in `parser/parser-adapter.ts`
- Created `GrammarTranslator` in `parser/grammar-translator.ts`

### Step 2: Create GrammarRegistry ✅ DONE
- Created `GrammarRegistry` interface and `DefaultGrammarRegistry` in `grammar/grammar-registry.ts`
- Indexes grammar rules by name for O(1) lookup

### Step 3: Implement ChevrotainSyntaxNode ✅ DONE
- Created `ChevrotainSyntaxNode` wrapping CstNode in `parser/chevrotain-syntax-node.ts`
- Uses WeakMap for identity-preserving caching
- Lazy children (computed on first access)

### Step 4: Implement ChevrotainAdapter ✅ DONE
- Created `ChevrotainAdapter` in `parser/chevrotain-adapter.ts`
- Wraps existing LangiumParser behind ParserAdapter interface

### Step 5: Migrate DocumentBuilder/DocumentFactory ✅ DONE
- `packages/langium/src/workspace/documents.ts`
- `update()` method now uses `$syntaxNode` for text comparison (with RootSyntaxNode.fullText)
- LangiumParser still used directly for Phase 1 (Chevrotain builds AST during parsing)
- Future backends will use ParserAdapter → SyntaxNode → AST builder pipeline

### Step 6: Add $syntaxNode to AstNode ✅ DONE
- Added `$syntaxNode?: SyntaxNode` to AstNode in `syntax-tree.ts`
- Added `$cstNode?: SyntaxNode` as deprecated alias

### Step 7: AST builder sets $syntaxNode ✅ DONE
- `packages/langium/src/parser/cst-node-builder.ts` defines lazy `$syntaxNode` getter
- Uses `wrapCstNode`/`wrapRootCstNode` with WeakMap cache for identity preservation
- Root CstNodes detected via `'fullText' in` check and wrapped as RootSyntaxNode

### Step 8: Migrate LSP services ✅ DONE
All 14 LSP services migrated from `$cstNode` to `$syntaxNode`:

1. Simple position-only services: definition, references, folding, document-symbol, type, implementation
2. Token-classification services: semantic tokens, rename
3. Complex services: formatter (minimal Phase 1), completion, signature help
4. Hierarchy services: call-hierarchy, type-hierarchy

Migration patterns used:
- **SyntaxNode-first entry**: `$syntaxNode` + `findDeclarationSyntaxNodeAtOffset`
- **Bridge to CstNode**: `findAstNodeForSyntaxNode` → `astNode.$cstNode` for `references.findDeclarations()`
- **Property/keyword lookup**: `findNodeForPropertySN`, `findNodesForKeywordSN`
- **Formatter bridge**: `toCstNode()` helper for internal CstNode tree walking (full rewrite deferred)

Also fixed: `LangiumGrammarNameProvider.getNameSyntaxNode()` override for Assignment nodes.

### Step 9: Set up monorepo split ✅ DONE
- Extracted parser-agnostic code → `packages/langium-core/` (~75 files)
- Extracted Chevrotain-specific code → `packages/langium-chevrotain/` (~15 files)
- Extracted LSP services → `packages/langium-lsp/` (~42 files)
- `packages/langium/` becomes meta-package re-exporting all three for backward compatibility
- All cross-package imports updated (relative → package imports)
- Verified: no `chevrotain` imports in langium-core, no `vscode-languageserver` imports in langium-core, no `chevrotain` imports in langium-lsp
- All downstream packages (langium-cli, examples, vscode extension) build without import changes

### Step 10: Full test suite pass ✅ DONE
- `npm run build` — compiles cleanly
- `npm test` — 1264 passed, 10 skipped
- 2 pre-existing failures: `fs.rmdirSync` deprecation in statemachine/domainmodel CLI tests (unrelated)
- All LSP service tests pass
- All example projects build successfully

---

## 6. DI Registration

New services are registered in `packages/langium/src/default-module.ts`:

```typescript
// In the parser group:
ParserAdapter: (services) => new ChevrotainAdapter(services),

// In the grammar group:
GrammarRegistry: (services) => new DefaultGrammarRegistry(services),
```

Service types declared in `packages/langium/src/services.ts`:
- `parser.ParserAdapter: ParserAdapter`
- `grammar.GrammarRegistry: GrammarRegistry`

---

## 7. Testing Checklist

### Existing test files for Phase 1 work
- `test/parser/chevrotain-syntax-node.test.ts` — SyntaxNode wrapper correctness
- `test/parser/chevrotain-adapter.test.ts` — ParserAdapter contract
- `test/grammar/grammar-registry.test.ts` — GrammarRegistry indexing
- `test/utils/syntax-node-utils.test.ts` — Utility functions

### Tests to add during remaining migration
- [ ] DocumentBuilder integration test with ParserAdapter
- [ ] AST builder test producing $syntaxNode on nodes
- [ ] Each migrated LSP service: verify same behavior with SyntaxNode
- [ ] End-to-end: parse → AST → LSP response using only SyntaxNode path
- [ ] Example project regression tests

---

## 8. Files Changed So Far (Phase 1)

New files:
- `src/parser/syntax-node.ts` — SyntaxNode interface
- `src/parser/parser-adapter.ts` — ParserAdapter interface
- `src/parser/grammar-translator.ts` — GrammarTranslator interface
- `src/parser/chevrotain-syntax-node.ts` — ChevrotainSyntaxNode impl
- `src/parser/chevrotain-adapter.ts` — ChevrotainAdapter impl
- `src/grammar/grammar-registry.ts` — GrammarRegistry impl
- `src/utils/syntax-node-utils.ts` — SyntaxNode utility functions
- `test/parser/chevrotain-syntax-node.test.ts`
- `test/parser/chevrotain-adapter.test.ts`
- `test/grammar/grammar-registry.test.ts`
- `test/utils/syntax-node-utils.test.ts`

Modified files:
- `src/syntax-tree.ts` — added $syntaxNode to AstNode
- `src/services.ts` — added ParserAdapter, GrammarRegistry service types
- `src/default-module.ts` — DI bindings
- `src/index.ts` — exports
- `src/parser/cst-node-builder.ts` — sets $syntaxNode via lazy getter with root detection
- `src/workspace/documents.ts` — DocumentFactory uses $syntaxNode for text comparison
- `src/references/name-provider.ts` — added getNameSyntaxNode method
- `src/serializer/json-serializer.ts` — uses $syntaxNode
- `src/lsp/hover-provider.ts` — migrated to SyntaxNode
- `src/lsp/document-highlight-provider.ts` — migrated to SyntaxNode
- `src/lsp/definition-provider.ts` — migrated to SyntaxNode
- `src/lsp/references-provider.ts` — migrated to SyntaxNode
- `src/lsp/rename-provider.ts` — migrated to SyntaxNode
- `src/lsp/semantic-token-provider.ts` — migrated to SyntaxNode
- `src/lsp/folding-range-provider.ts` — migrated to SyntaxNode
- `src/lsp/document-symbol-provider.ts` — migrated to SyntaxNode
- `src/lsp/signature-help-provider.ts` — migrated to SyntaxNode
- `src/lsp/call-hierarchy-provider.ts` — migrated to SyntaxNode
- `src/lsp/type-hierarchy-provider.ts` — migrated to SyntaxNode
- `src/lsp/type-provider.ts` — migrated to SyntaxNode
- `src/lsp/implementation-provider.ts` — migrated to SyntaxNode
- `src/lsp/completion/completion-provider.ts` — migrated to SyntaxNode
- `src/lsp/formatter.ts` — minimal Phase 1 migration (entry points + DefaultNodeFormatter)
- `src/grammar/references/grammar-naming.ts` — added getNameSyntaxNode override for Assignment
- `src/grammar/lsp/grammar-definition.ts` — updated to match new base class SyntaxNode signature
