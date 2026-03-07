# Langium-X: Parser-Agnostic Langium Fork — Implementation Design

> **Purpose**: This document is the single source of truth for implementing Langium-X, a fork of [Langium](https://github.com/eclipse-langium/langium) (v4.x) that decouples the parser from the framework, supports incremental parsing, and extends the grammar language. Use this document to guide all implementation work in Claude Code.

---

## 1. Project Overview

### 1.1 What Langium Is

Langium is a TypeScript framework for building domain-specific languages (DSLs) with built-in Language Server Protocol (LSP) support. You write a `.langium` grammar file, and Langium gives you:

- A parser (currently Chevrotain-only)
- Generated TypeScript AST types
- A full LSP language server (completion, hover, go-to-definition, rename, formatting, validation, etc.)
- A CLI (`langium-cli`) for code generation

Langium's pipeline:

```
.langium grammar → Grammar AST → Chevrotain in-memory parser → Lexer+Parser → CST → AST → LSP services
```

### 1.2 What We're Building

Three changes to Langium:

1. **Parser-agnostic architecture**: Replace the tight Chevrotain coupling with an abstraction layer. Supported backends: Chevrotain (default/backward-compatible), Lezer.
2. **Incremental parsing**: On keystroke, only re-parse the changed region (Lezer supports this natively). Currently Langium re-parses the entire document.
3. **Extended grammar syntax**: New grammar constructs for precedence markers, external tokenizers, conflict declarations, and token specialization — exposing features from Lezer while remaining backward-compatible.

### 1.3 Key Design Decisions (Resolved)

| Decision | Resolution |
|----------|-----------|
| Precedence for binary operators | Use Langium 4's `infix` rules (precedence inferred from `>` ordering). No changes needed. |
| Precedence for non-infix rules | New `precedence { }` block + `@precMarker=tag` annotations on alternatives |
| External tokenizer module format | TypeScript modules for Chevrotain/Lezer |
| Build-time vs runtime compilation | Build-time grammar compilation for all backends |
| CST representation | **Eliminate Langium's CST entirely for new backends.** Use a thin `SyntaxNode` interface that wraps each backend's native tree. No tree conversion, no inflation. |
| Priority of grammar extensions | (1) precedence markers, (2) external tokenizers, (3) token specialization, (4) conflict declarations, (5) local token groups |

---

## 2. Current Architecture — What to Change

### 2.1 Langium's CST: Why It Exists and Why It's a Problem

Langium maintains a full Concrete Syntax Tree (CST) alongside the AST. Every parsed document has both trees in memory, cross-linked with bidirectional pointers.

**What a CST node carries:**

```typescript
// Simplified from Langium source (packages/langium/src/syntax-tree.ts)
interface CstNode {
  // --- Positional data (universally needed) ---
  readonly offset: number;       // start offset in source
  readonly end: number;          // end offset
  readonly length: number;       // end - offset
  readonly text: string;         // matched source text
  readonly hidden: boolean;      // whitespace/comment?

  // --- Tree structure ---
  readonly container: CompositeCstNode;  // parent
  readonly root: CompositeCstNode;       // document root

  // --- Back-pointer #1: CST → AST ---
  readonly astNode: AstNode;     // the AST node this CST node belongs to

  // --- Back-pointer #2: CST → Grammar AST ---
  readonly grammarSource: AbstractElement;  // the grammar rule/keyword/terminal
                                            // from the .langium file that produced this node
}

interface CompositeCstNode extends CstNode {
  readonly content: CstNode[];   // children (both visible and hidden tokens)
}

interface LeafCstNode extends CstNode {
  readonly tokenType: TokenType; // Chevrotain token type
}
```

**Why it's inflated — two back-pointers that don't belong on every node:**

1. **`astNode`** (CST → AST): Every CST node, including every whitespace token and comma, holds a reference to the AST node it belongs to. This creates a circular reference (AST has `$cstNode`, CST has `astNode`). Both trees stay in memory for the document's lifetime.

2. **`grammarSource`** (CST → Grammar AST): Every CST node holds a live reference to the Grammar AST element that produced it — not a string tag, but the actual object from the parsed `.langium` file. This is used by:
   - Completion provider: walks `grammarSource` to find valid alternatives
   - Formatter: checks `isKeyword(cstNode.grammarSource)` to distinguish token types
   - Hover provider: looks up documentation comments on grammar source elements
   - Semantic token provider: determines token types from grammar source

   This was "free" with Chevrotain (the interpreted parser walks grammar elements anyway), but it couples the tree representation deeply to Langium's grammar model.

**What Lezer/Tree-sitter use instead:**
- Node type as a string/integer (not a live grammar object)
- No AST back-pointer (positional queries are fast O(log n) on the tree itself)
- Compact buffer-based storage (Lezer: 64 bits per node)

### 2.2 Chevrotain Coupling Points

These are every place in Langium's source where Chevrotain is directly used:

| Module | File(s) | What It Does | Coupling Type |
|--------|---------|-------------|--------------|
| **Parser builder** | `langium-parser-builder.ts` | Translates Grammar AST → Chevrotain `RULE()`, `CONSUME()`, `SUBRULE()`, `OR()` calls to build an in-memory parser | Core — must be abstracted |
| **Parser runtime** | `langium-parser.ts` | `LangiumParser` extends Chevrotain's `EmbeddedActionsParser`. Executes parse and builds CST nodes during Chevrotain rule callbacks | Core — must be abstracted |
| **Lexer / Token builder** | `token-builder.ts`, `lexer.ts` | Converts terminal rules to `createToken()` calls. Handles `LONGER_ALT`, `CATEGORIES`, `GROUP: Lexer.SKIPPED` | Core — must be abstracted |
| **CST node builder** | `cst-node-builder.ts` | Constructs `CompositeCstNode` / `LeafCstNode` during parse. Sets `grammarSource`, `astNode` back-pointers | Core — replaced by `SyntaxNode` adapters |
| **Completion provider** | `completion-provider.ts` | Uses Chevrotain's `computeContentAssist()` for expected tokens at cursor | Must be re-implemented per backend |
| **Error recovery** | Built into Chevrotain | `recoveryEnabled` flag, error tokens | Each backend has its own recovery |
| **ALL(*) lookahead** | `@chevrotain/allstar` package | Extended lookahead for LL ambiguity resolution | Chevrotain-specific, not needed for LR backends |
| **Config** | `langium-config.json` | `chevrotainParserConfig` passed to Chevrotain | Replace with backend-agnostic config |

### 2.3 What Doesn't Need to Change

These parts of Langium are already parser-agnostic and should remain largely untouched:

- **Grammar parser** (Langium parsing its own `.langium` files) — self-hosted, keep as-is
- **AST type generation** (`ast.ts` generation from Grammar AST) — independent of parser
- **Linker / Cross-reference resolution** — operates on AST, not CST
- **Scope provider** — operates on AST
- **Validation framework** — operates on AST
- **DI system** — just needs new service interfaces
- **Document lifecycle** (build, index, link, validate phases) — needs minor changes for incremental, but structure stays

---

## 3. Target Architecture

### 3.1 High-Level Pipeline

```
.langium grammar
      │
      ▼
┌──────────────────┐
│ Grammar Parser    │  (unchanged — Langium parses its own grammar)
└────────┬─────────┘
         │ Grammar AST
         ├────────────────────────────────────────────────┐
         │                                                │
         ▼                                                ▼
┌──────────────────┐                           ┌────────────────────┐
│ AST Type Gen      │ (ast.ts — unchanged)      │ Grammar Translator  │
└──────────────────┘                           │ (per backend)       │
                                               └────────┬───────────┘
                                                        │
                                  ┌─────────────────────┘
                                  │                      │
                                  ▼                      ▼
                           ┌─────────────┐        ┌──────────────┐
                           │ Chevrotain   │        │ Lezer         │
                           │ (in-memory   │        │ (.grammar →   │
                           │  interpreted)│        │  parse tables)│
                           └──────┬──────┘        └──────┬───────┘
                                  │                      │
                                  │         ┌────────────┘
                                  │         │
                                  ▼         ▼
                 ┌─────────────────────────────────────────────────────────────────┐
                 │                    SyntaxNode Interface                          │
                 │  (thin wrapper — each backend wraps its native tree nodes)       │
                 └─────────────────────────────┬───────────────────────────────────┘
                                               │
                                               ▼
                                 ┌──────────────────────────┐
                                 │   AST Builder              │
                                 │   (walks SyntaxNode tree,  │
                                 │    constructs typed AST)    │
                                 └─────────────┬──────────────┘
                                               │
                                               ▼
                                 ┌──────────────────────────┐
                                 │   LSP Services             │
                                 │   (operate on AST +        │
                                 │    SyntaxNode for position) │
                                 └────────────────────────────┘
```

### 3.2 Monorepo Package Structure

```
packages/
  langium-core/              # SyntaxNode interface, AST types, grammar parser,
                             #   AST builder, document lifecycle, DI, shared utils
                             #   NO parser backend code. NO Chevrotain imports.

  langium-chevrotain/        # ChevrotainAdapter, ChevrotainSyntaxNode,
                             #   ChevrotainGrammarTranslator, token builder,
                             #   completion via computeContentAssist

  langium-lezer/             # LezerAdapter, LezerSyntaxNode,
                             #   LezerGrammarTranslator, incremental parsing,
                             #   completion via parse state analysis

  langium-lsp/               # All LSP service implementations.
                             #   Depends on langium-core only.
                             #   Backend-agnostic via SyntaxNode interface.

  langium-cli/               # CLI with --backend flag.
                             #   Orchestrates grammar translation + build per backend.

  langium/                   # Convenience meta-package. Re-exports langium-core +
                             #   langium-chevrotain + langium-lsp for backward compat.
                             #   `import { ... } from 'langium'` still works.
```

---

## 4. Core Interfaces

### 4.1 SyntaxNode — The Abstraction That Replaces CstNode

This is the most important interface in the entire design. It replaces Langium's `CstNode` / `CompositeCstNode` / `LeafCstNode` with a minimal, backend-agnostic interface.

```typescript
// packages/langium-core/src/syntax-node.ts

/**
 * A node in the concrete/parse syntax tree. Backend-agnostic.
 *
 * Each parser backend implements this by wrapping its native tree nodes:
 * - Chevrotain: wraps existing CstNode
 * - Lezer: cursor-based view over Lezer's buffer tree (zero copy)
 *
 * Design principles:
 * - No back-pointer to AST (avoids circular references; use positional lookup instead)
 * - No back-pointer to Grammar AST (use type string + grammar lookup instead)
 * - Lazy children (don't inflate the full tree unless walked)
 * - Immutable (parse produces a new tree; old one can be GC'd or reused)
 */
export interface SyntaxNode {
  /** Node type name. Corresponds to the grammar rule or token name. */
  readonly type: string;

  /** Start offset in source text (0-based byte offset). */
  readonly offset: number;

  /** End offset in source text (exclusive). */
  readonly end: number;

  /** Length in bytes (end - offset). */
  readonly length: number;

  /** The source text matched by this node. Lazy — reads from document text. */
  readonly text: string;

  /** Parent node. Null for the root. */
  readonly parent: SyntaxNode | null;

  /** All child nodes (including hidden/whitespace if retained by backend). */
  readonly children: readonly SyntaxNode[];

  /** True if this is a leaf/token node with no children. */
  readonly isLeaf: boolean;

  /** True if this node is a hidden token (whitespace, comment). */
  readonly isHidden: boolean;

  /** True if this node is an error/recovery node. */
  readonly isError: boolean;

  /**
   * Whether this is a keyword token.
   * Backends determine this differently:
   * - Chevrotain: token is in the keyword set
   * - Lezer: anonymous string tokens
   */
  readonly isKeyword: boolean;

  /**
   * For leaf nodes: the token type name (e.g., "ID", "STRING", "NUMBER").
   * For composite nodes: undefined.
   */
  readonly tokenType: string | undefined;

  /**
   * Get a single named child (by field/assignment name from the grammar).
   * Used by AST builder to map grammar assignments to AST properties.
   *
   * Example: for grammar `Person: 'person' name=ID;`
   *   node.childForField("name") returns the ID leaf node.
   */
  childForField(name: string): SyntaxNode | undefined;

  /**
   * Get all named children for a list field.
   * Example: for grammar `Model: items+=Item*;`
   *   node.childrenForField("items") returns all Item nodes.
   */
  childrenForField(name: string): readonly SyntaxNode[];
}

/**
 * The root syntax node with document-level metadata.
 */
export interface RootSyntaxNode extends SyntaxNode {
  /** All lexer/parser diagnostics from this parse. */
  readonly diagnostics: readonly ParseDiagnostic[];
}

/**
 * A parser diagnostic (lexer error, parse error, recovery).
 */
export interface ParseDiagnostic {
  readonly message: string;
  readonly offset: number;
  readonly length: number;
  readonly severity: 'error' | 'warning';
  readonly source: 'lexer' | 'parser';
}
```

### 4.2 ParserAdapter — The Backend Plugin Interface

```typescript
// packages/langium-core/src/parser/parser-adapter.ts

import type { Grammar } from '../languages/generated/ast.js';

/**
 * Interface that each parser backend implements.
 * Registered via DI. The document builder delegates all parsing to this.
 */
export interface ParserAdapter {
  /** Human-readable backend name. */
  readonly name: string;

  /** Whether this backend supports incremental parsing. */
  readonly supportsIncremental: boolean;

  /**
   * Initialize the parser from a Langium Grammar AST.
   * Called once at startup (or when grammar changes in dev mode).
   *
   * For Chevrotain: builds in-memory interpreted parser.
   * For Lezer: loads pre-compiled parse tables (built at CLI time).
   */
  configure(grammar: Grammar, config?: ParserAdapterConfig): void;

  /**
   * Parse a document from scratch. Returns the root SyntaxNode.
   */
  parse(text: string, entryRule?: string): ParseResult;

  /**
   * Incremental parse. Only available if supportsIncremental is true.
   *
   * Takes the previous parse state (opaque, backend-specific) and the
   * text changes since the last parse. Returns a new tree that reuses
   * unchanged subtrees from the previous parse.
   */
  parseIncremental?(
    text: string,
    previousState: IncrementalParseState,
    changes: readonly TextChange[]
  ): ParseResult;

  /**
   * Compute tokens expected at a given offset. Used for code completion.
   *
   * Different backends implement this differently:
   * - Chevrotain: computeContentAssist()
   * - Lezer: analyze parse state at position
   */
  getExpectedTokens(text: string, offset: number): ExpectedToken[];

  /**
   * Release resources (WASM modules, etc.).
   */
  dispose?(): void;
}

export interface ParseResult {
  /** Root syntax node of the parsed tree. */
  readonly root: RootSyntaxNode;
  /** Opaque state for incremental re-parse. Store on the LangiumDocument. */
  readonly incrementalState?: IncrementalParseState;
}

/** Opaque — each backend stores whatever it needs. */
export type IncrementalParseState = unknown;

export interface TextChange {
  /** Start offset in the OLD text. */
  readonly rangeOffset: number;
  /** Number of characters removed from OLD text. */
  readonly rangeLength: number;
  /** New text inserted at rangeOffset. */
  readonly text: string;
}

export interface ExpectedToken {
  readonly name: string;
  readonly isKeyword: boolean;
  readonly pattern?: RegExp | string;
}

export interface ParserAdapterConfig {
  /** Enable error recovery (default: true). */
  recoveryEnabled?: boolean;
  /** Max lookahead for LL parsers. Ignored by LR backends. */
  maxLookahead?: number;
  /** Arbitrary backend-specific config. */
  backendConfig?: Record<string, unknown>;
}
```

### 4.3 GrammarTranslator — Build-Time Grammar Compilation

```typescript
// packages/langium-core/src/parser/grammar-translator.ts

import type { Grammar } from '../languages/generated/ast.js';

/**
 * Translates a Langium Grammar AST into a backend's native grammar format.
 * Each backend package provides an implementation.
 * Called at build time by langium-cli.
 */
export interface GrammarTranslator {
  /** Backend name (e.g., "chevrotain", "lezer", "tree-sitter"). */
  readonly backend: string;

  /**
   * Validate that the grammar is compatible with this backend.
   * Returns diagnostics for unsupported features.
   *
   * Example: `conflicts` block with Chevrotain → error diagnostic.
   */
  validate(grammar: Grammar): TranslationDiagnostic[];

  /**
   * Translate the grammar and write output file(s).
   *
   * - Chevrotain: serialize grammar JSON (runtime interpretation)
   * - Lezer: write .grammar file, run @lezer/generator → parse tables JS
   */
  translate(grammar: Grammar, outputDir: string): Promise<TranslationResult>;
}

export interface TranslationDiagnostic {
  readonly message: string;
  readonly severity: 'error' | 'warning' | 'info';
  /** The grammar element that triggered this diagnostic. */
  readonly source?: string;
  /** Suggestion for fixing the issue. */
  readonly suggestion?: string;
}

export interface TranslationResult {
  /** Files generated by translation. */
  readonly outputFiles: string[];
  /** Any diagnostics produced during translation. */
  readonly diagnostics: TranslationDiagnostic[];
}
```

### 4.4 Modified AstNode — $syntaxNode Replaces $cstNode

```typescript
// In packages/langium-core/src/syntax-tree.ts (modified from Langium)

export interface AstNode {
  /** Discriminator for AST node types. */
  readonly $type: string;
  /** The container (parent) AST node. */
  readonly $container?: AstNode;
  /** Property name on the container that holds this node. */
  readonly $containerProperty?: string;
  /** Index in container property array, if applicable. */
  readonly $containerIndex?: number;

  /**
   * The SyntaxNode corresponding to this AST node's source range.
   * Replaces the old $cstNode (which was a Langium CstNode).
   */
  readonly $syntaxNode?: SyntaxNode;

  /**
   * @deprecated Use $syntaxNode. Alias for backward compatibility.
   */
  readonly $cstNode?: SyntaxNode;

  /** Document reference (only on root node). */
  readonly $document?: LangiumDocument;
}
```

### 4.5 Modified LangiumDocument — Incremental State

```typescript
// In packages/langium-core/src/workspace/documents.ts (additions)

export interface LangiumDocument<T extends AstNode = AstNode> {
  // ... existing properties ...

  /** Opaque parse state from the last successful parse. Used for incremental re-parse. */
  incrementalParseState?: IncrementalParseState;

  /** Document version, incremented on each edit. */
  version: number;
}
```

---

## 5. Backend Implementations

### 5.1 Chevrotain Adapter (Default — Backward Compatible)

This wraps the existing Langium parser logic behind the `ParserAdapter` interface. Existing behavior is preserved exactly.

```typescript
// packages/langium-chevrotain/src/chevrotain-adapter.ts

export class ChevrotainAdapter implements ParserAdapter {
  readonly name = 'chevrotain';
  readonly supportsIncremental = false;

  // Wraps existing LangiumParser + TokenBuilder + Lexer logic.
  // ChevrotainSyntaxNode wraps existing CstNode objects.
  // configure() builds the Chevrotain in-memory parser from Grammar AST.
  // parse() runs lexer + parser, wraps resulting CstNode tree.
  // getExpectedTokens() delegates to Chevrotain's computeContentAssist().
}
```

**ChevrotainSyntaxNode**: Thin wrapper around existing `CstNode`. Maps:
- `type` → `cstNode.grammarSource` name / rule name
- `offset/end/text` → direct passthrough
- `children` → wraps `cstNode.content`
- `isKeyword` → `isKeyword(cstNode.grammarSource)`
- `childForField(name)` → searches children whose grammar source is an assignment with that name

### 5.2 Lezer Adapter

```typescript
// packages/langium-lezer/src/lezer-adapter.ts

export class LezerAdapter implements ParserAdapter {
  readonly name = 'lezer';
  readonly supportsIncremental = true;

  private parser: LRParser; // from @lezer/lr

  configure(grammar: Grammar, config?: ParserAdapterConfig): void {
    // Load pre-compiled parse tables (generated at build time by CLI)
  }

  parse(text: string, entryRule?: string): ParseResult {
    const tree = this.parser.parse(text);
    const root = new LezerSyntaxNode(tree.topNode, text);
    return {
      root,
      incrementalState: { tree, fragments: TreeFragment.addTree(tree) }
    };
  }

  parseIncremental(
    text: string,
    previousState: IncrementalParseState,
    changes: readonly TextChange[]
  ): ParseResult {
    const prev = previousState as LezerIncrementalState;
    // Apply changes to fragments
    const fragments = TreeFragment.applyChanges(prev.fragments, changes.map(c => ({
      fromA: c.rangeOffset,
      toA: c.rangeOffset + c.rangeLength,
      fromB: c.rangeOffset,
      toB: c.rangeOffset + c.text.length
    })));
    // Parse with fragment reuse
    const tree = this.parser.parse(text, fragments);
    const root = new LezerSyntaxNode(tree.topNode, text);
    return {
      root,
      incrementalState: { tree, fragments: TreeFragment.addTree(tree) }
    };
  }
}
```

**LezerSyntaxNode**: Cursor-based view over Lezer's compact buffer tree. Zero copy — never materializes a full node tree. Lezer nodes are 64 bits each in a flat buffer, so this is extremely memory-efficient.

---

## 6. Grammar Extensions

All new syntax uses keywords/constructs that don't conflict with existing Langium grammars. Full backward compatibility.

### 6.1 Precedence for Binary Operators (No Change Needed)

Langium 4's `infix` rules already handle this perfectly:

```langium
Expression: BinaryExpr;

infix BinaryExpr on PrimaryExpr:
    right assoc '^'           // highest
    > '*' | '/'
    > '+' | '-'
    > right assoc '=' | '+='  // lowest
    ;

PrimaryExpr: '(' expr=Expression ')' | value=NUMBER;
```

Precedence is inferred from `>` ordering. Associativity defaults to left; use `right assoc` to override.

**Backend translation:**
- Chevrotain: Langium 4 already generates optimized internal rules (50% faster than manual left-factoring)
- Lezer: `>` levels → `@precedence { power @right, times @left, plus @left, assign @right }` + `!tag` markers

### 6.2 Precedence for Non-Infix Rules: `@precMarker=tag`

For cases `infix` can't handle (ternary operators, type assertions, GLR disambiguation):

```langium
// Declare named levels in descending priority
precedence {
    typeAssertion
    ternary
    assignment @right
}

// Attach markers to specific alternatives
Expression:
    {TernaryExpr} @precMarker=ternary
        condition=Expression '?' consequent=Expression ':' alternate=Expression
  | {TypeAssertion} @precMarker=typeAssertion
        expr=Expression 'as' type=TypeRef
  | BinaryExpr   // falls through to infix rules
;
```

**Why `@precMarker=tag` instead of `!tag`:**
- `!` already means negated lookahead in Langium grammar syntax
- `@precMarker=tag` is self-documenting and follows Langium's annotation conventions
- Easy to search/grep in large grammars

**Backend translation:**
- Chevrotain: desugared to rule ordering + left-factoring (with warnings for unsupported cases)
- Lezer: maps to `!tag` markers in generated `.grammar` file

### 6.3 External Tokenizers

```langium
// Declare tokens produced by user-provided code
external tokens from "./tokenizer" {
    Indent
    Dedent
    Newline
}

// Optional: context tracker for stateful tokenization
external context IndentationTracker from "./context";

// Use external tokens like any other terminal
Block: Indent statements+=Statement+ Dedent;
```

The `"./tokenizer"` path resolves to `./tokenizer.ts` or `./tokenizer.js` (TypeScript module) for both Chevrotain and Lezer.

**Chevrotain tokenizer module interface:**
```typescript
import type { ExternalTokenizer } from 'langium-x/chevrotain';
export const tokenizer: ExternalTokenizer = {
  tokens: ['Indent', 'Dedent', 'Newline'],
  match(text: string, offset: number, expectedTokens: string[]): TokenMatch | null { /* ... */ }
};
```

**Lezer tokenizer module interface:**
```typescript
import { ExternalTokenizer } from '@lezer/lr';
export const tokenizer = new ExternalTokenizer((input, stack) => { /* ... */ });
```

### 6.4 Conflict / Ambiguity Declarations

```langium
// Declare intentional ambiguities for GLR parsing
conflicts {
    [Expression, TypeExpression]
    [ParameterList, ParenthesizedExpr]
}

// Dynamic precedence for runtime disambiguation
Expression:
    {ArrowFunction} @dynamicPrecedence(1)
        params=ParameterList '=>' body=Expression
  | /* ... */
;
```

**Backend support:**
- Chevrotain: ❌ not supported (emit clear error: "conflicts require Lezer backend")
- Lezer: maps to `~ambiguity` markers + `@dynamicPrecedence`

### 6.5 Backend-Native Terminal Syntax

Terminal rules support two body formats:

```langium
// Regex body — portable. Chevrotain native, Lezer best-effort conversion for simple patterns.
terminal ID: /[a-zA-Z_]\w*/;
terminal INT: /[0-9]+/;

// String body — backend-native. Passed verbatim to the target backend.
// Use when regex can't express what you need, or for precise control.
terminal ID: '$[a-zA-Z_] $[a-zA-Z0-9_]*';
terminal INT: '@digit+';
```

**Regex bodies** (`/pattern/`) work with Chevrotain natively. For Lezer, the translator does best-effort conversion of simple patterns (`\s` → `@whitespace`, `\d` → `@digit`, `\w` → `$[a-zA-Z0-9_]`, `.` → `_`). Complex regex features (backreferences, lookahead/lookbehind) produce an error diagnostic suggesting a rewrite with string body syntax.

**String bodies** (`'lezer syntax'`) are interpreted by the target backend as its native token syntax. The grammar parser already handles string literals — no parser changes needed.

**Backend validation:**
- Chevrotain + string body → error: "Terminal 'X' uses backend-native token syntax; not supported by Chevrotain. Use regex `/pattern/` instead."
- Lezer + regex with unsupported features → error: "Terminal 'X' uses regex features unsupported by Lezer. Rewrite using string body syntax: `terminal X: 'lezer_syntax';`"
- Lezer + string body → pass through verbatim into `@tokens` block
- Lezer + simple regex → best-effort conversion (no error)

This is consistent with `external tokens`, `conflicts`, and `local tokens` — some grammar features are backend-specific. The feature support matrix reflects this.

### 6.6 Token Specialization

```langium
terminal ID: /[a-zA-Z_]\w*/;

// Replace ID with a keyword token when it matches specific strings
specialize ID {
    'if' => IfKeyword
    'else' => ElseKeyword
    'while' => WhileKeyword
}

// Contextual: allow both interpretations (triggers GLR if needed)
extend ID {
    'async' => AsyncKeyword
    'yield' => YieldKeyword
}
```

**Backend support:**
- Chevrotain: `specialize` → keyword config / `LONGER_ALT`; `extend` → limited (warning)
- Lezer: `specialize` → `@specialize`; `extend` → `@extend`

### 6.7 Local Token Groups

```langium
StringLiteral: '"' content=StringContent* '"';

local tokens in StringContent {
    terminal EscapeSequence: /\\[nrt"\\]/;
    terminal Interpolation: '${';
    terminal StringText: /[^"\\$]+/;
}
```

Tokens only active when parsing `StringContent`. Prevents interference with main grammar tokens.

**Backend support:**
- Chevrotain: lexer modes
- Lezer: `@local tokens` (native)

### 6.8 Feature Support Matrix

| Grammar Feature | Chevrotain | Lezer |
|----------------|-----------|-------|
| Existing Langium grammars | ✅ Full | ✅ Full |
| `infix` (Langium 4) | ✅ Native | ✅ Translated |
| `@precMarker=tag` | ⚠️ Desugared | ✅ Native |
| `external tokens` | ⚠️ Custom matchers | ✅ Native |
| Terminal regex body (`/pattern/`) | ✅ Native | ⚠️ Best-effort conversion |
| Terminal string body (`'native'`) | ❌ Error | ✅ Verbatim passthrough |
| `conflicts` / GLR | ❌ Error | ✅ Native |
| `specialize` / `extend` | ⚠️ Partial | ✅ Native |
| `local tokens` | ⚠️ Lexer modes | ✅ Native |
| Incremental parsing | ❌ | ✅ |
| Error recovery | ✅ | ✅ |
| Browser support | ✅ Pure JS | ✅ Pure JS |

---

## 7. LSP Service Adaptations

### 7.1 Grammar Lookup by Type Name

Several LSP services currently use `cstNode.grammarSource` (a live Grammar AST reference) to introspect the grammar at runtime. With `SyntaxNode` having only `type: string`, these services need a different approach.

**Solution: GrammarRegistry service.**

```typescript
// packages/langium-core/src/grammar/grammar-registry.ts

/**
 * Provides grammar introspection by node type name.
 * Replaces the grammarSource back-pointer on CstNode.
 */
export interface GrammarRegistry {
  /** Get the grammar rule that produces nodes of this type. */
  getRuleByName(typeName: string): AbstractRule | undefined;

  /** Check if a type name corresponds to a keyword. */
  isKeyword(typeName: string): boolean;

  /** Get all valid alternatives at a given rule. For completion. */
  getAlternatives(ruleName: string): AbstractElement[];

  /** Get the assignment name for a child node type within a parent rule. */
  getAssignment(parentType: string, childType: string): Assignment | undefined;
}
```

This is populated once from the Grammar AST at startup. O(1) lookups by type name replace the per-node `grammarSource` pointers.

### 7.2 Position → AST Mapping

Currently: `cstNode.astNode` back-pointer (O(1) per node, but doubles memory).

New approach: Walk the `SyntaxNode` tree from root, using offsets to narrow down, then look up the corresponding AST node. Lezer supports fast positional queries natively.

```typescript
/**
 * Find the most specific AST node at a given offset.
 * Uses SyntaxNode tree for positional lookup, then maps to AST.
 */
function findAstNodeAtOffset(root: AstNode, offset: number): AstNode | undefined {
  const syntaxNode = root.$syntaxNode;
  if (!syntaxNode || offset < syntaxNode.offset || offset >= syntaxNode.end) return undefined;

  // Walk AST children (which have $syntaxNode ranges) to find the deepest match
  for (const child of getAstChildren(root)) {
    const sn = child.$syntaxNode;
    if (sn && offset >= sn.offset && offset < sn.end) {
      return findAstNodeAtOffset(child, offset) ?? child;
    }
  }
  return root;
}
```

### 7.3 Completion Provider

Current: Uses Chevrotain's `computeContentAssist()`.

New: Each backend implements `ParserAdapter.getExpectedTokens()`. The completion provider calls this instead.

### 7.4 Formatter

The formatter is the hardest service to adapt because it walks every token (including hidden whitespace/comments) to control spacing.

**Approach**: `SyntaxNode.children` includes hidden tokens when the backend retains them:
- Chevrotain: already includes hidden tokens in CST `content`
- Lezer: hidden tokens are in the tree (as `@skip` matched nodes)

The formatter iterates `SyntaxNode` leaves instead of `CstNode` leaves. Same algorithm, different types.

### 7.5 Incremental Document Building

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
│                                            │
│ } else {                                   │
│   result = adapter.parse(newText);         │
│ }                                          │
│                                            │
│ document.incrementalParseState             │
│   = result.incrementalState;               │
│                                            │
│ // Rebuild AST from new SyntaxNode tree    │
│ document.parseResult                       │
│   = astBuilder.buildAst(result.root);      │
│                                            │
│ // Continue with linking, validation...    │
└────────────────────────────────────────────┘
```

---

## 8. Build Pipeline (CLI)

### 8.1 Config File

```jsonc
// langium-config.json
{
  "projectName": "MyLanguage",
  "parserBackend": "lezer",          // "chevrotain" | "lezer"
  "languages": [{
    "id": "my-language",
    "grammar": "src/language/my-language.langium",
    "fileExtensions": [".ml"]
  }],
  "out": "src/language/generated",
  "backendConfig": {
    "chevrotain": { "recoveryEnabled": true, "maxLookahead": 3 },
    "lezer": { "strict": false }
  }
}
```

### 8.2 CLI Commands

```bash
# Generate with configured backend (default: chevrotain)
langium generate

# Explicit backend override
langium generate --backend=lezer

# What langium generate does per backend:

# Chevrotain:
#   1. Parse .langium → Grammar AST
#   2. Generate ast.ts, module.ts (same as today)
#   3. Serialize grammar JSON for runtime interpretation

# Lezer:
#   1. Parse .langium → Grammar AST
#   2. Generate ast.ts, module.ts
#   3. Translate Grammar AST → .grammar file
#   4. Run @lezer/generator → parse-tables.js
#   5. Bundle parse tables with LezerAdapter
```

---

## 9. Implementation Roadmap

### Phase 1: Foundation — SyntaxNode + Chevrotain Adapter (Weeks 1–3)

**Goal**: Extract abstraction layer. All existing tests pass.

1. Define `SyntaxNode`, `ParserAdapter`, `GrammarTranslator` interfaces in `langium-core`
2. Create `GrammarRegistry` service (replaces `grammarSource` back-pointer)
3. Implement `ChevrotainSyntaxNode` wrapping existing `CstNode`
4. Implement `ChevrotainAdapter` wrapping existing `LangiumParser`
5. Migrate `DocumentBuilder` to use `ParserAdapter` instead of direct Chevrotain calls
6. Add `$syntaxNode` to `AstNode`, deprecate `$cstNode`
7. Migrate AST builder from `CstNode` to `SyntaxNode`
8. Migrate all LSP services from `CstNode` to `SyntaxNode`:
   - Completion provider → use `ParserAdapter.getExpectedTokens()`
   - Formatter → iterate `SyntaxNode` leaves
   - Hover/GoTo/Rename → use `findAstNodeAtOffset()` utility
   - Folding/Highlighting → use `SyntaxNode` ranges
9. Set up monorepo structure, extract packages
10. Run full Langium test suite — everything must pass

### Phase 2: Lezer Adapter + Incremental Parsing (Weeks 4–7)

**Goal**: Working Lezer backend. Incremental parsing on every keystroke.

1. Implement `LezerGrammarTranslator`:
   - Map parser rules → Lezer nonterminals
   - Map `infix` rules → `@precedence` block + `BinaryExpression` alternatives
   - Map terminal rules → `@tokens` block
   - Map `hidden terminal` → `@skip`
   - Map `fragment` rules → lowercase (hidden) Lezer rules
   - Map cross-references → generate appropriate node types
2. CLI integration: `langium generate --backend=lezer` runs `@lezer/generator`
3. Implement `LezerSyntaxNode` (cursor-based, lazy, zero-copy)
4. Implement `LezerAdapter` with full and incremental parsing
5. Implement completion for Lezer (parse state analysis)
6. Run full test suite against Lezer backend

### Phase 3: Grammar Extensions (Weeks 8–11)

**Goal**: New grammar syntax, implemented per backend.

1. Extend Langium grammar parser to recognize:
   - `precedence { }` blocks and `@precMarker=tag` annotations
   - `external tokens from "path" { ... }` declarations
   - `external context` declarations
   - `specialize` / `extend` blocks
   - `conflicts { }` blocks
   - `local tokens in Rule { ... }` blocks
2. Extend Grammar AST types for new elements
3. Implement translation for each feature × each backend (per support matrix)
4. Emit clear diagnostics for unsupported feature × backend combinations

### Phase 4: Polish (Weeks 12–14)

1. Performance benchmarks: parse time, memory, incremental re-parse time
2. Migration guide: existing Langium project → Langium-X
3. Backend selection guide: when to use Chevrotain vs Lezer
4. Example project: one DSL with both backends
5. Documentation for new grammar syntax

---

## 10. Grammar Translation Reference: Langium → Lezer

| Langium Grammar | Lezer Grammar |
|----------------|---------------|
| `entry Model: ...;` | `@top Model { ... }` |
| `Person: 'person' name=ID;` | `Person { "person" Name }` (Name is token) |
| `items+=Item*` | `Item*` (field tracked externally) |
| `name=ID` | `Name` (field tracked externally) |
| `terminal ID: /[a-zA-Z_]\w*/;` | `@tokens { Name { @asciiLetter (@asciiLetter | @digit | "_")* } }` (best-effort regex conversion) |
| `terminal ID: '$[a-zA-Z_] $[a-zA-Z0-9_]*';` | `@tokens { Name { $[a-zA-Z_] $[a-zA-Z0-9_]* } }` (verbatim passthrough) |
| `hidden terminal WS: /\s+/;` | `@skip { space } @tokens { space { @whitespace+ } }` |
| `hidden terminal ML_COMMENT: ...;` | `@skip { ... Comment } @tokens { Comment { "/*" ... "*/" } }` |
| `fragment X: ...;` | `x { ... }` (lowercase = hidden in tree) |
| `'keyword'` (literal) | `"keyword"` |
| `A \| B` (alternative) | `A \| B` |
| `A?` | `A?` |
| `A*` | `A*` |
| `A+` | `A+` |
| `(A B)` (group) | `(A B)` |
| `infix BinaryExpr on PrimaryExpr: '*' > '+';` | `@precedence { times @left, plus @left }` + `BinaryExpression { expr !times "*" expr \| expr !plus "+" expr }` |
| `[Ref:ID]` (cross-ref) | `Name` (cross-ref handled at AST level, not parser level) |

---

## 11. Lezer Backend Gaps — Incomplete Work

> **Status**: These items were planned for Phase 1/2 but were not implemented. The Lezer backend currently only works at the parser level (producing SyntaxNode trees). It **cannot** produce ASTs, run LSP services, or integrate with the full Langium document pipeline. All items below must be completed before the Lezer backend is functional for end users.

### 11.1 Critical Infrastructure Gaps

#### Gap 1: No SyntaxNode → AST Builder for Lezer

**File**: `packages/langium-core/src/workspace/documents.ts:318-325`

`DefaultLangiumDocumentFactory.parse()` calls `services.parser.LangiumParser.parse()`, which is Chevrotain-specific. `LangiumParser` simultaneously builds both the CST and AST during parsing using Chevrotain grammar callbacks. There is **no equivalent AST builder for the Lezer backend**.

The Lezer adapter returns a `SyntaxNode` tree, but nothing walks that tree to construct typed AST nodes (`AstNode` with `$type`, `$container`, properties, cross-references, etc.).

**Required**: Implement a generic `AstBuilder` service that takes a `SyntaxNode` tree (from any backend) and produces a `ParseResult<AstNode>`. This should use `GrammarRegistry` for grammar introspection. The `DefaultLangiumDocumentFactory.parse()` method should be updated to use `ParserAdapter.parse()` → `AstBuilder.build()` instead of `LangiumParser.parse()`.

**Also affected**: `DefaultAsyncParser` (`packages/langium-core/src/parser/async-parser.ts:48-50`) — directly accesses `services.parser.LangiumParser`.

#### Gap 2: SyntaxNode → AstNode Mapping Returns `undefined` for Lezer

**File**: `packages/langium-core/src/utils/syntax-node-utils.ts:330-338`

`findAstNodeForSyntaxNode()` only supports `ChevrotainSyntaxNode` (checks `isChevrotainSyntaxNode()` and delegates to `underlyingCstNode.astNode`). For Lezer `SyntaxNode`s, it always returns `undefined`.

This function is used by LSP services to map a position in the document to the AST node at that position — a fundamental operation for hover, go-to-definition, rename, references, etc.

**Required**: Implement positional AST lookup for generic SyntaxNode trees, as described in §7.2 of this document. Walk the AST children using `$syntaxNode` offset ranges to find the deepest match.

#### Gap 3: `References.findDeclarations()` API Requires CstNode

**File**: `packages/langium-core/src/references/references.ts:35,43,79-104,148-155`

The `References` service interface has `findDeclarations(sourceCstNode: CstNode)` and `findDeclarationNodes(sourceCstNode: CstNode)`. These are CstNode-typed APIs. The implementation uses `cstNode.astNode`, `findAssignment(cstNode)` (which uses `cstNode.grammarSource`), and CstNode offset comparison.

Every LSP service that finds declarations goes through this CstNode API: hover, definition, references, rename, document-highlight, call-hierarchy, type-hierarchy, type-provider, implementation-provider.

**Required**: Add `SyntaxNode`-based overloads or replace the `CstNode` parameter with `SyntaxNode`, using `GrammarRegistry` instead of `grammarSource` and `findAstNodeForSyntaxNode()` instead of `cstNode.astNode`.

### 11.2 LSP Services Still Using `$cstNode` (10 files in langium-lsp)

All of these services check `if (!astNode?.$cstNode)` as a guard and return empty/undefined when `$cstNode` is absent. With the Lezer backend, `$cstNode` is always `undefined`, so **every LSP feature silently returns nothing**.

| LSP Service | File | CstNode Usage |
|-------------|------|---------------|
| Hover | `lsp/hover-provider.ts:37,44,80` | `CstUtils.findDeclarationNodeAtOffset(rootNode)`, `CstUtils.findCommentNode(node.$cstNode)` |
| Definition | `lsp/definition-provider.ts:83,86,90` | `CstUtils.findDeclarationNodeAtOffset(astNode.$cstNode)`, `references.findDeclarationNodes(sourceCstNode)` |
| References | `lsp/references-provider.ts:55,58,62` | `CstUtils.findDeclarationNodeAtOffset(astNode.$cstNode)`, `this.getReferences(selectedCstNode)` |
| Rename | `lsp/rename-provider.ts:69,72,111,114` | `CstUtils.findDeclarationNodeAtOffset(astNode.$cstNode)` (2 places) |
| Document Highlight | `lsp/document-highlight-provider.ts:48,60,63` | `CstUtils.findDeclarationNodeAtOffset(rootNode)`, `references.findDeclarations(selectedCstNode)` |
| Call Hierarchy | `lsp/call-hierarchy-provider.ts:50,53` | `CstUtils.findDeclarationNodeAtOffset(astNode.$cstNode)` |
| Type Hierarchy | `lsp/type-hierarchy-provider.ts:57,60` | `CstUtils.findDeclarationNodeAtOffset(astNode.$cstNode)` |
| Type Provider | `lsp/type-provider.ts:38,39` | `CstUtils.findDeclarationNodeAtOffset(astNode.$cstNode)` |
| Implementation | `lsp/implementation-provider.ts:39,40` | `CstUtils.findDeclarationNodeAtOffset(astNode.$cstNode)` |
| Formatter | `lsp/formatter.ts:185,484,585,591-592` | `node.$cstNode`, `root.$cstNode`, iterates CstNode tree for formatting |

**Required**: Complete the `$cstNode` → `$syntaxNode` migration in all 10 files. Use `SyntaxNodeUtils` functions instead of `CstUtils`, and update `References` service to accept `SyntaxNode`.

### 11.3 Core Services Using `$cstNode` (8 files in langium-core)

These core services also depend on `$cstNode` and will not work correctly with Lezer:

| Core Service | File | CstNode Usage |
|-------------|------|---------------|
| CommentProvider | `documentation/comment-provider.ts:34` | `findCommentNode(node.$cstNode, ...)` — comment extraction fails |
| NameProvider | `references/name-provider.ts:50-51` | `findNodeForProperty(node.$cstNode, 'name')` — name node lookup fails |
| AstDescriptions | `workspace/ast-descriptions.ts:57,64` | `nameProvider.getNameNode(node) ?? node.$cstNode` — description segments fail |
| DocumentValidator | `validation/document-validator.ts:297-301` | `findNodeForProperty(info.node.$cstNode, ...)` — diagnostic ranges default to 0:0 |
| JsonSerializer | `serializer/json-serializer.ts:211,234-239` | `value.$cstNode?.text`, `node.$cstNode` — serialization loses text regions |
| GrammarValidator | `grammar/validation/validator.ts:441-488,643-654,1318` | Multiple `findNodeForKeyword(rule.$cstNode, ...)` calls |
| GrammarNaming | `grammar/references/grammar-naming.ts:26` | `findNodeForProperty(node.$cstNode, 'feature')` |
| GrammarScope | `grammar/references/grammar-scope.ts:182,189` | `nameProvider.getNameNode(node) ?? node.$cstNode` |

**Note**: The grammar-specific services (GrammarValidator, GrammarNaming, GrammarScope) are only used for the Langium grammar language itself, which is always parsed by Chevrotain. These do NOT need Lezer migration. The first 5 services (CommentProvider through JsonSerializer) are used by all DSLs and DO need migration.

### 11.4 Linker and Reference Resolution

**File**: `packages/langium-core/src/references/linker.ts:76,78,215,260`

The `Linker.buildReference()` and `buildMultiReference()` methods take a `CstNode | undefined` parameter for the reference node (`$refNode`). With Lezer, there is no CstNode, so `$refNode` on all `Reference` objects will be `undefined`. This means:

- `Reference.$refNode` is always `undefined` with Lezer backend
- Code that checks `ref.$refNode.offset` / `ref.$refNode.end` (like in `References.findDeclarations`) will fail
- Cross-reference navigation relies on `$refNode` for positional matching

**Required**: The linker needs to accept SyntaxNode-based reference nodes, or `Reference.$refNode` needs a SyntaxNode equivalent.

### 11.5 Code Generation / Tracing

**Files**: `generate/generator-node.ts`, `generate/generator-tracing.ts`, `generate/template-node.ts`, `generate/node-joiner.ts`

These files contain extensive `$cstNode` references in JSDoc examples and in runtime code (e.g., `generator-tracing.ts:95,119-121,132` uses `astNode.$cstNode` for tracing). Code generation tracing will produce incomplete source maps with the Lezer backend.

**Required**: Update tracing to use `$syntaxNode` when `$cstNode` is not available.

### 11.6 Test Infrastructure

**File**: `packages/langium-lsp/src/test/langium-test.ts:623`

The test helper `expectValidation` accesses `options.node.$cstNode`. This means validation test helpers will not work for Lezer-based tests.

### 11.7 Summary of What Works vs What Doesn't with Lezer

| Feature | Works with Lezer? | Notes |
|---------|-------------------|-------|
| Parsing to SyntaxNode tree | Yes | `LezerAdapter.parse()` returns `SyntaxNode` tree |
| Incremental parsing | Yes | `LezerAdapter.parseIncremental()` works |
| Grammar translation | Yes | `LezerGrammarTranslator` generates Lezer grammar |
| AST construction | **No** | No SyntaxNode → AST builder exists |
| Document pipeline | **No** | `DocumentFactory.parse()` requires `LangiumParser` |
| Linking / cross-references | **No** | Depends on AST construction + CstNode `$refNode` |
| Validation | **No** | Depends on AST construction + `$cstNode` for diagnostic ranges |
| Hover | **No** | Requires `$cstNode` for declaration lookup + comment extraction |
| Go-to-definition | **No** | Requires `$cstNode` for `findDeclarationNodes` |
| Find references | **No** | Requires `$cstNode` for `findDeclarations` |
| Rename | **No** | Requires `$cstNode` for `findDeclarations` |
| Document highlight | **No** | Requires `$cstNode` for `findDeclarations` |
| Completion | **Partial** | `LezerAdapter.getExpectedTokens()` works, but full completion requires AST |
| Formatting | **No** | Iterates CstNode tree directly |
| Semantic tokens | **Partial** | Entry point uses SyntaxNode, but may fall back to CstUtils |
| Code generation tracing | **No** | Uses `$cstNode` for source mapping |
| JSON serialization | **Partial** | Falls back gracefully when `$cstNode` is undefined, but loses text regions |
| Call/Type hierarchy | **No** | Requires `$cstNode` for `findDeclarationNodes` |
| Workspace symbols | **No** | Depends on AST construction |

---

## 12. Testing Strategy

### 12.1 Test Structure

```
tests/
  core/                    # SyntaxNode interface tests, AST builder tests
  chevrotain/              # Chevrotain adapter tests (should mirror existing Langium tests)
  lezer/                   # Lezer adapter tests
  cross-backend/           # Same grammar, same input, both backends → assert same AST
  grammar-extensions/      # New syntax features
  incremental/             # Incremental parsing correctness + performance
  lsp/                     # LSP services work with all backends
```

### 12.2 Cross-Backend Conformance Tests

For every grammar in the test suite, parse the same input with both backends and assert:
- Same AST structure (same `$type`, same property values)
- Same diagnostics (same error messages, same positions)
- Same completion results at same cursor positions

This is the primary quality gate. If a backend produces a different AST for the same input, that's a bug.

### 12.3 Incremental Parsing Tests

For Lezer:
1. Parse a document fully
2. Apply a small edit (insert a character, delete a line, etc.)
3. Parse incrementally
4. Parse the edited document from scratch
5. Assert that incremental and full parse produce identical ASTs
6. Assert that incremental parse is faster (wall-clock) for documents > 1KB
