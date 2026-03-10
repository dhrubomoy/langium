# Langium-X Architecture

Langium-X decouples Langium from its Chevrotain parser, introducing a plugin-based parser
architecture that supports multiple backends (Chevrotain, Lezer) through a common interface.

## High-Level Pipeline

```
.langium grammar
      │
      ▼
┌──────────────────┐
│ Grammar Parser   │  (unchanged — Langium parses its own grammar)
└────────┬─────────┘
         │ Grammar AST
         ├────────────────────────────────────────────────┐
         │                                                │
         ▼                                                ▼
┌──────────────────┐                           ┌────────────────────┐
│ AST Type Gen     │ (ast.ts — unchanged)      │ GrammarTranslator  │
└──────────────────┘                           │ (per backend)      │
                                               └────────┬───────────┘
                                                        │
                                  ┌─────────────────────┘
                                  │                      │
                                  ▼                      ▼
                           ┌──────────────┐        ┌───────────────┐
                           │ Chevrotain   │        │ Lezer         │
                           │ (in-memory   │        │ (.grammar →   │
                           │  interpreted)│        │  parse tables)│
                           └──────┬───────┘        └──────┬────────┘
                                  │                      │
                                  │         ┌────────────┘
                                  │         │
                                  ▼         ▼
                 ┌───────────────────────────────────────────────┐
                 │              SyntaxNode Interface             │
                 │  (thin wrapper — each backend wraps its       │
                 │   native tree nodes, zero copy)               │
                 └─────────────────────┬─────────────────────────┘
                                       │
                                       ▼
                         ┌──────────────────────────┐
                         │   AST Builder            │
                         │   (walks SyntaxNode tree,│
                         │    constructs typed AST) │
                         └─────────────┬────────────┘
                                       │
                                       ▼
                         ┌─────────────────────────────┐
                         │   LSP Services              │
                         │   (operate on AST +         │
                         │    SyntaxNode for position) │
                         └─────────────────────────────┘
```

## Package Structure

```
packages/
  langium-core/              # Parser-agnostic core
                             #   SyntaxNode interface, AST types, grammar parser,
                             #   AST builder, document lifecycle, DI, shared utils
                             #   NO parser backend code. NO Chevrotain imports.

  langium-chevrotain/        # Chevrotain parser backend
                             #   ChevrotainAdapter, ChevrotainSyntaxNode,
                             #   TokenBuilder, Lexer, parser builder

  langium-lezer/             # Lezer parser backend
                             #   LezerAdapter, LezerSyntaxNode (zero-copy),
                             #   LezerGrammarTranslator, incremental parsing,
                             #   completion via parse state analysis

  langium-lsp/               # LSP services
                             #   Completion, hover, rename, go-to-definition,
                             #   formatting, semantic tokens, folding, etc.
                             #   Depends on langium-core only (backend-agnostic)

  langium/                   # Meta-package
                             #   Re-exports langium-core + langium-chevrotain +
                             #   langium-lsp for backward compatibility

  langium-cli/               # CLI with --backend flag
  langium-vscode/            # VS Code extension
  langium-railroad/          # Railroad diagram generator
  langium-sprotty/           # Sprotty visualization
```

### Dependency Graph

```
langium-core  ←─── langium-chevrotain
     ↑               ↑
     │               │
langium-lsp          │
     ↑               │
     └───────┬───────┘
             │
          langium (meta-package)
```

## Core Interfaces

### SyntaxNode

The most important interface — replaces Langium's CstNode with a backend-agnostic,
minimal parse tree node.

```typescript
interface SyntaxNode {
    readonly type: string;           // Grammar rule or token name
    readonly offset: number;         // Start offset (0-based)
    readonly end: number;            // End offset (exclusive)
    readonly length: number;         // end - offset
    readonly text: string;           // Matched source text (lazy)
    readonly range: Range;           // LSP Range (line/column)
    readonly parent: SyntaxNode | null;
    readonly children: readonly SyntaxNode[];
    readonly isLeaf: boolean;        // Leaf/token node
    readonly isHidden: boolean;      // Whitespace, comment
    readonly isError: boolean;       // Error/recovery node
    readonly isKeyword: boolean;     // Keyword token
    readonly tokenType: string | undefined;

    childForField(name: string): SyntaxNode | undefined;
    childrenForField(name: string): readonly SyntaxNode[];
}

interface RootSyntaxNode extends SyntaxNode {
    readonly fullText: string;
    readonly diagnostics: readonly ParseDiagnostic[];
}
```

**Design principles:**
- No back-pointer to AST (avoids circular references)
- No back-pointer to Grammar AST (use GrammarRegistry instead)
- Lazy children (computed on access, not construction)
- Immutable (parse produces a new tree)

**Backend implementations:**
- `ChevrotainSyntaxNode`: Wraps existing CstNode objects
- `LezerSyntaxNode`: Cursor-based view over Lezer's compact buffer tree (zero copy)

### ParserAdapter

Plugin interface that each parser backend implements. Registered via DI.

```typescript
interface ParserAdapter {
    readonly name: string;
    readonly supportsIncremental: boolean;

    configure(grammar: Grammar, config?: ParserAdapterConfig): void;
    parse(text: string, entryRule?: string): AdapterParseResult;
    parseIncremental?(
        text: string,
        previousState: IncrementalParseState,
        changes: readonly TextChange[]
    ): AdapterParseResult;
    getExpectedTokens(text: string, offset: number): ExpectedToken[];
    dispose?(): void;
}
```

- **Chevrotain**: Builds an in-memory interpreted parser from the Grammar AST at startup.
  Does not support incremental parsing.
- **Lezer**: Loads pre-compiled parse tables (generated at build time). Supports incremental
  parsing via Lezer's `TreeFragment` mechanism.

### GrammarTranslator

Build-time interface for compiling Langium grammars into backend-native formats.

```typescript
interface GrammarTranslator {
    readonly backend: string;

    validate(grammar: Grammar): TranslationDiagnostic[];
    translate(grammar: Grammar, outputDir: string): Promise<TranslationResult>;
}
```

- **Chevrotain**: Serializes grammar JSON for runtime interpretation
- **Lezer**: Writes `.grammar` file → runs `@lezer/generator` → produces parse tables JS

### GrammarRegistry

Provides O(1) grammar introspection by node type name, replacing the per-node
`grammarSource` back-pointers that CstNode carried.

```typescript
interface GrammarRegistry {
    getRuleByName(name: string): AbstractRule | undefined;
    isKeyword(value: string): boolean;
    getAlternatives(ruleName: string): AbstractElement[];
    getAssignmentByProperty(ruleName: string, property: string): Assignment | undefined;
    getAssignments(ruleName: string): Assignment[];
    getAssignmentInfos(ruleName: string): AssignmentInfo[];
    isDataTypeRule(ruleName: string): boolean;
    getInferActions(ruleName: string): InferActionInfo[];
    getChainingActions(ruleName: string): ChainingActionInfo[];
    getInfixRuleInfo(ruleName: string): InfixRuleInfo | undefined;
}
```

Populated once from the Grammar AST at startup. Used by LSP services (hover, completion,
semantic tokens, formatter) and the AST builder. Key metadata indexed:

- **`AssignmentInfo`**: Enriched assignment data (property, operator, cross-reference flags, terminal rule name)
- **`InferActionInfo`**: `{infer X}` actions with `requiredFields` (only mandatory fields — optional fields inside `?`/`*` groups are excluded)
- **`ChainingActionInfo`**: `{infer X.prop=current}` actions with `chainProperty` and `assignedFields`
- **`InfixRuleInfo`**: `infix` rule metadata with `operandRuleName` and `binaryTypeName`

### SyntaxNodeAstBuilder

Walks a `SyntaxNode` parse tree (from any backend) and constructs a typed AST. This is
the post-parse step that replaces Chevrotain's in-parse AST construction for new backends.

**File**: `packages/langium-core/src/parser/syntax-node-ast-builder.ts`

`DefaultSyntaxNodeAstBuilder` handles the full Langium grammar feature set:

| Feature | Method | Description |
|---------|--------|-------------|
| Normal assignments | `processAssignment()` | `=`, `+=`, `?=` operators |
| Type overrides | `inlineChildNode()` | Unassigned subrule calls (e.g., `Element: Source \| Target`) |
| `{infer X}` actions | `applyTypeInference()` | Matches populated fields against `requiredFields` |
| `{infer X.prop=current}` | `tryBuildChainedNode()` | Restructures flat nodes into nested chains |
| `infix` rules | `buildInfixExpression()` | Extracts operator from source text between operands |
| Leaf node fix | `extractAssignmentValue()` | Forces `buildNode()` for "leaf" rules with only anonymous children |
| Cross-references | `extractAssignmentValue()` | Built via `Linker.buildReferenceSN()` |
| Data type rules | `buildDataTypeValue()` | Returns concatenated text |

**Type inference details**: `applyTypeInference()` uses a two-pass approach. First, it tries
actions with specific `requiredFields` (most specific match wins). Then, catch-all actions
(empty `requiredFields`) only apply if the node has no populated fields at all — preventing
incorrect matches for branches without `{infer}` actions.

**Chaining details**: `tryBuildChainedNode()` detects two patterns:
1. **Shared field**: `element=X ({infer T.prev=current} '.' element=X)*` — all field children share the same name
2. **Separate base**: `Base ({infer T.left=current} op=Op right=Base)*` — base is an unassigned child

## Incremental Parsing

When using the Lezer backend, document changes trigger incremental re-parsing:

```
textDocument/didChange (from editor)
       │
       ├─ TextChange[] (offset, rangeLength, newText)
       │
       ▼
┌────────────────────────────────────────────┐
│ DocumentBuilder                             │
│                                            │
│ if (adapter.supportsIncremental            │
│     && document.incrementalParseState) {   │
│                                            │
│   result = adapter.parseIncremental(       │
│     newText,                               │
│     document.incrementalParseState,        │
│     changes                                │
│   );                                       │
│ } else {                                   │
│   result = adapter.parse(newText);         │
│ }                                          │
│                                            │
│ document.incrementalParseState             │
│   = result.incrementalState;               │
│                                            │
│ // Rebuild AST from new SyntaxNode tree    │
│ astBuilder.buildAst(result.root);          │
│                                            │
│ // Continue with linking, validation...    │
└────────────────────────────────────────────┘
```

Lezer reuses unchanged subtrees from the previous parse, achieving up to 8x speedup
for single-character edits in large documents (5000+ items).

## DI System

Langium uses dependency injection to wire services together. Each backend provides
a DI module that overrides the parser services:

```typescript
// Chevrotain (default)
import { createDefaultModule } from 'langium';

const services = inject(
    createDefaultModule({ shared }),
    MyLanguageModule
);

// Lezer
import { createDefaultCoreModule } from 'langium-core';
import { createLezerParserModule } from 'langium-lezer';

const services = inject(
    createDefaultCoreModule({ shared }),
    createLezerParserModule(),
    MyLanguageModule
);
```

Services are registered in `default-module.ts` files, types declared in `services.ts`.
