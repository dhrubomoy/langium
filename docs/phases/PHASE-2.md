# Phase 2: Lezer Adapter + Incremental Parsing

**Goal**: Working Lezer parser backend behind the `ParserAdapter` interface. Incremental parsing on every keystroke. Cross-backend conformance tests prove identical AST output.

**Source of truth**: [DESIGN.md](../../DESIGN.md) §5.2, §7, §8, §9.Phase 2, §10, §11

**Prerequisites**: Phase 1 complete — `SyntaxNode`, `ParserAdapter`, `GrammarTranslator` interfaces stable in `langium-core`; `ChevrotainAdapter` passing all tests.

---

## 1. Package Setup: `langium-lezer`

### 1.1 Package Structure

```
packages/langium-lezer/
  package.json
  tsconfig.json
  tsconfig.build.json
  src/
    index.ts                          # Public API exports
    parser/
      lezer-adapter.ts                # LezerAdapter implements ParserAdapter
      lezer-syntax-node.ts            # LezerSyntaxNode implements SyntaxNode
      lezer-grammar-translator.ts     # LezerGrammarTranslator implements GrammarTranslator
      lezer-completion.ts             # Completion via parse state analysis
      lezer-module.ts                 # DI module (like ChevrotainModule)
      lezer-services.ts               # Service type declarations
      field-map.ts                    # FieldMap data structure
      regex-to-lezer.ts              # Best-effort simple regex → Lezer token conversion
  test/
    parser/
      lezer-syntax-node.test.ts
      lezer-adapter.test.ts
      lezer-grammar-translator.test.ts
      lezer-completion.test.ts
    cross-backend/
      conformance.test.ts             # Same grammar + input → same AST with both backends
      incremental.test.ts             # Incremental vs full parse produce identical ASTs
```

### 1.2 Dependencies

```json
{
  "name": "langium-lezer",
  "dependencies": {
    "langium-core": "workspace:*",
    "@lezer/common": "^1.x",
    "@lezer/lr": "^1.x",
    "@lezer/highlight": "^1.x"
  },
  "devDependencies": {
    "@lezer/generator": "^1.x",
    "langium-chevrotain": "workspace:*",
    "vitest": "..."
  }
}
```

Key: `@lezer/generator` is a **dev/build dependency** (used by `LezerGrammarTranslator` at CLI build time), not a runtime dependency. `@lezer/lr` + `@lezer/common` are runtime.

### 1.3 DI Module

File: `src/parser/lezer-module.ts`

```typescript
// Pattern follows langium-chevrotain/src/parser/chevrotain-module.ts
export const LezerModule: Module<LangiumLezerServices, LangiumLezerAddedServices> = {
    parser: {
        ParserAdapter: (services) => new LezerAdapter(services),
    }
};
```

Service types in `src/parser/lezer-services.ts`:

```typescript
export type LangiumLezerServices = LangiumCoreServices & LangiumLezerAddedServices;

export type LangiumLezerAddedServices = {
    parser: {
        ParserAdapter: ParserAdapter;
    };
};
```

### 1.4 Build Integration

Add to root `tsconfig.build.json` references. Add to root `package.json` workspaces. Wire into `langium` meta-package as optional peer dependency (not re-exported by default — users opt in via config).

---

## 2. LezerGrammarTranslator

File: `src/parser/lezer-grammar-translator.ts`

Implements `GrammarTranslator` from `langium-core`. Called at build time by `langium-cli`.

### 2.1 Translation Pipeline

```
Langium Grammar AST
       │
       ▼
┌─────────────────────┐
│ LezerGrammarTranslator │
│   .translate()         │
└────────┬──────────────┘
         │
         ▼
    .grammar file (Lezer grammar syntax)
         │
         ▼
┌─────────────────────┐
│ @lezer/generator      │
│  buildParserFile()    │
└────────┬──────────────┘
         │
         ▼
    parser.ts (parse tables as JS/TS module)
```

### 2.2 Grammar Rule Translation

Reference: DESIGN.md §10

| Langium Grammar | Lezer Grammar |
|----------------|---------------|
| `entry Model: ...;` | `@top Model { ... }` |
| `Person: 'person' name=ID;` | `Person { kw<"person"> name }` |
| `items+=Item*` | `Item*` (field tracked via node names) |
| `name=ID` | `name` (field tracked via node names) |
| `terminal ID: /[a-zA-Z_]\w*/;` (regex) | `@tokens { Identifier { ... } }` (best-effort conversion) |
| `terminal ID: '$[a-zA-Z_] $[a-zA-Z0-9_]*';` (string) | `@tokens { Identifier { $[a-zA-Z_] $[a-zA-Z0-9_]* } }` (verbatim) |
| `hidden terminal WS: /\s+/;` | `@skip { whitespace }` in `@tokens` |
| `hidden terminal ML_COMMENT: ...;` | `@skip { BlockComment }` |
| `hidden terminal SL_COMMENT: ...;` | `@skip { LineComment }` |
| `fragment X: ...;` | `x { ... }` (lowercase = hidden in Lezer tree) |
| `'keyword'` (literal) | `kw<"keyword">` or inline `"keyword"` |
| `A \| B` | `A \| B` |
| `A?` / `A*` / `A+` | `A?` / `A*` / `A+` |
| `(A B)` (group) | `(A B)` |
| `[Ref:ID]` (cross-ref) | `Identifier` (cross-ref resolved at AST level) |
| `infix BinaryExpr on PrimaryExpr: '*' > '+';` | `@precedence { times @left, plus @left }` + `BinaryExpression { expr !times "*" expr \| expr !plus "+" expr }` (`@precMarker=tag` → Lezer `!tag`) |

### 2.3 Translation Details

#### Entry rules

```
// Langium: entry Model: elements+=Element*;
// Lezer:
@top Model { Element* }
```

Only one `@top` rule. The Langium entry rule becomes `@top`.

#### Parser rules (non-terminal)

Each Langium parser rule becomes a Lezer nonterminal. Assignments (`name=`, `items+=`) don't appear in Lezer syntax — instead, the child node names serve as implicit field identifiers. The `LezerSyntaxNode.childForField()` implementation maps field names to child node types using a field map generated alongside the grammar.

```
// Langium:
// Person: 'person' name=ID age=INT?;
//
// Lezer:
// Person { kw<"person"> PersonName PersonAge? }
// PersonName { Identifier }
// PersonAge { Number }
```

Strategy for assignments: Each assignment `prop=Rule` generates a wrapper nonterminal `ParentProp { Rule }` so the field name is recoverable from the tree. The translator emits a **field map** (JSON) alongside the `.grammar` file mapping `(parentType, fieldName) → childNodeType`.

#### Terminal rules

Terminal rules have two body formats (see DESIGN.md §6.5):

**Regex body** (`/pattern/`): The translator does best-effort conversion of simple patterns to Lezer token syntax:
- `\s` → `@whitespace`, `\d` → `@digit`, `\w` → `$[a-zA-Z0-9_]`, `.` → `_`
- `/[a-zA-Z_]\w*/` → `$[a-zA-Z_] $[a-zA-Z0-9_]*`
- `/[0-9]+/` → `@digit+`

Complex regex (backreferences, lookahead/lookbehind) → error diagnostic: "Terminal 'X' uses regex features unsupported by Lezer. Rewrite using string body: `terminal X: 'lezer_syntax';`"

**String body** (`'lezer syntax'`): Passed verbatim into the Lezer `@tokens` block. No conversion needed. This is the preferred approach for Lezer-targeted grammars:

```langium
terminal ID: '$[a-zA-Z_] $[a-zA-Z0-9_]*';
terminal INT: '@digit+';
terminal STRING: '"' !["]* '"';
```

The Chevrotain backend rejects string bodies with a clear error: "Terminal 'X' uses backend-native token syntax; not supported by Chevrotain."

#### Hidden terminals (skip rules)

```
// Langium: hidden terminal WS: /\s+/;
// Lezer:
@skip { whitespace | LineComment | BlockComment }

@tokens {
  whitespace { @whitespace+ }
  LineComment { "//" ![\n]* }
  BlockComment { "/*" blockCommentRest }
  blockCommentRest { ![*] blockCommentRest | "*" blockCommentAfterStar }
  blockCommentAfterStar { "/" | ![/*] blockCommentRest | "*" blockCommentAfterStar }
}
```

#### Cross-references

Langium cross-references (`[Type:ID]`) are **not** represented in the parser output — they resolve to the same token as the referenced terminal. The cross-reference resolution happens at the AST/linker level, which is unchanged.

#### Infix rules (Langium 4)

Langium 4's `infix` rules map to Lezer's `@precedence` declaration plus a flat `BinaryExpression` rule with `!tag` markers. Note: `@precMarker=tag` is Langium grammar syntax; `!tag` is **Lezer's native output syntax** in the generated `.grammar` file. The translator performs this mapping automatically.

```
// Langium input (.langium file):
// infix BinaryExpr on PrimaryExpr:
//     '*' | '/'        // higher precedence
//     > '+' | '-'      // lower precedence
//     ;
//
// Generated Lezer output (.grammar file):
// @precMarker=times → !times, @precMarker=plus → !plus
@precedence { times @left, plus @left }

BinaryExpression {
  expr !times ArithOp<"*" | "/"> expr |
  expr !plus ArithOp<"+" | "-"> expr
}
```

#### Actions / unordered groups

Langium actions (`{TypeName}`) and unordered groups (`&`) need special handling:
- Actions: Generate alternative rules for each action type. The AST builder uses the action type to set `$type`.
- Unordered groups: Expand into all permutations (with warning for large groups).

### 2.4 validate() Method

Checks the grammar for Lezer-incompatible features and returns diagnostics:

| Condition | Severity | Message |
|-----------|----------|---------|
| Terminal regex with backreferences | error | "Terminal 'X' uses backreferences unsupported by Lezer. Rewrite using string body syntax." |
| Terminal regex with lookahead/lookbehind | error | "Terminal 'X' uses lookahead/lookbehind unsupported by Lezer. Rewrite using string body syntax." |
| Terminal string body + Chevrotain backend | error | "Terminal 'X' uses backend-native token syntax; not supported by Chevrotain. Use regex." |
| Unordered group with >4 elements | warning | "Unordered group expands to N! permutations; consider restructuring" |
| `chevrotainParserConfig` in config | info | "chevrotainParserConfig is ignored when using Lezer backend" |

### 2.5 translate() Output

`translate(grammar, outputDir)` writes:

1. `<language-id>.grammar` — The Lezer grammar file
2. `<language-id>.terms.ts` — Term constants (generated by `@lezer/generator`)
3. `<language-id>.parser.ts` — Parse tables module (generated by `@lezer/generator`)
4. `<language-id>.field-map.json` — Maps `(parentType, fieldName) → childNodeType[]` for `childForField()`/`childrenForField()`

The translator calls `@lezer/generator`'s `buildParserFile()` programmatically (not as a CLI subprocess).

---

## 3. LezerSyntaxNode

File: `src/parser/lezer-syntax-node.ts`

### 3.1 Design Principles

- **Zero-copy**: Wraps Lezer's `SyntaxNode` (from `@lezer/common`) directly. No tree conversion.
- **Lazy children**: Children materialized only when `.children` is accessed, using cursor traversal.
- **Cursor-based**: Uses `TreeCursor` for efficient traversal without allocating node objects.
- **Cached**: Uses a `Map<number, LezerSyntaxNode>` keyed by `(from, to, type)` hash for identity.

### 3.2 Implementation Sketch

```typescript
import type { SyntaxNode as LezerNode, Tree } from '@lezer/common';
import type { SyntaxNode, RootSyntaxNode, ParseDiagnostic } from 'langium-core';

export class LezerSyntaxNode implements SyntaxNode {
    /** The wrapped Lezer SyntaxNode. */
    private readonly lezerNode: LezerNode;
    /** Source text of the entire document (for .text access). */
    private readonly sourceText: string;
    /** Field map from grammar translation. */
    private readonly fieldMap: FieldMap;

    private _children?: readonly SyntaxNode[];
    private _parent?: SyntaxNode | null;

    constructor(lezerNode: LezerNode, sourceText: string, fieldMap: FieldMap) {
        this.lezerNode = lezerNode;
        this.sourceText = sourceText;
        this.fieldMap = fieldMap;
    }

    get type(): string {
        return this.lezerNode.type.name;
    }

    get offset(): number {
        return this.lezerNode.from;
    }

    get end(): number {
        return this.lezerNode.to;
    }

    get length(): number {
        return this.end - this.offset;
    }

    get text(): string {
        return this.sourceText.slice(this.offset, this.end);
    }

    get parent(): SyntaxNode | null {
        if (this._parent === undefined) {
            const p = this.lezerNode.parent;
            this._parent = p ? new LezerSyntaxNode(p, this.sourceText, this.fieldMap) : null;
        }
        return this._parent;
    }

    get children(): readonly SyntaxNode[] {
        if (!this._children) {
            const kids: SyntaxNode[] = [];
            let child = this.lezerNode.firstChild;
            while (child) {
                kids.push(new LezerSyntaxNode(child, this.sourceText, this.fieldMap));
                child = child.nextSibling;
            }
            this._children = kids;
        }
        return this._children;
    }

    get isLeaf(): boolean {
        return this.lezerNode.firstChild === null;
    }

    get isHidden(): boolean {
        // In Lezer, anonymous nodes (type.name === "") are hidden/skip tokens
        return this.lezerNode.type.name === '' || this.lezerNode.type.isSkipped;
    }

    get isError(): boolean {
        return this.lezerNode.type.isError;
    }

    get isKeyword(): boolean {
        // Lezer: anonymous string terminals are keywords
        // The field map or term constants can identify keywords
        return this.lezerNode.type.name === '' && this.isLeaf;
    }

    get tokenType(): string | undefined {
        return this.isLeaf ? this.lezerNode.type.name || undefined : undefined;
    }

    childForField(name: string): SyntaxNode | undefined {
        // Look up expected child type from field map
        const childTypes = this.fieldMap.getChildTypes(this.type, name);
        if (!childTypes) return undefined;
        return this.children.find(c => childTypes.includes(c.type));
    }

    childrenForField(name: string): readonly SyntaxNode[] {
        const childTypes = this.fieldMap.getChildTypes(this.type, name);
        if (!childTypes) return [];
        return this.children.filter(c => childTypes.includes(c.type));
    }
}

export class LezerRootSyntaxNode extends LezerSyntaxNode implements RootSyntaxNode {
    private _diagnostics: readonly ParseDiagnostic[] = [];

    get fullText(): string {
        return this.text;
    }

    get diagnostics(): readonly ParseDiagnostic[] {
        return this._diagnostics;
    }

    setDiagnostics(diagnostics: readonly ParseDiagnostic[]): void {
        this._diagnostics = diagnostics;
    }
}
```

### 3.3 Field Map

The field map is a data structure generated alongside the Lezer grammar. It maps `(parentNodeType, fieldName)` pairs to the child node type names that represent that field.

```typescript
export interface FieldMap {
    /** Get the child node type(s) that represent a field on a parent rule. */
    getChildTypes(parentType: string, fieldName: string): string[] | undefined;
    /** Get the field name for a child node type within a parent. */
    getFieldName(parentType: string, childType: string): string | undefined;
}
```

Example: For Langium rule `Person: 'person' name=ID age=INT?;`, the field map contains:
- `("Person", "name") → ["PersonName"]`
- `("Person", "age") → ["PersonAge"]`

Where `PersonName` and `PersonAge` are wrapper nonterminals generated by the translator.

### 3.4 Handling Lezer's Anonymous Nodes

Lezer has anonymous nodes (type ID = 0, name = `""`) for tokens like keywords that don't need their own node type. These map to `isHidden = true` in `SyntaxNode`. The `isKeyword` property returns `true` for anonymous leaf nodes whose text matches a keyword literal from the grammar.

For keyword detection, the translator emits a keyword set alongside the field map. `LezerSyntaxNode` checks `text ∈ keywordSet` for anonymous leaves.

---

## 4. LezerAdapter

File: `src/parser/lezer-adapter.ts`

### 4.1 Implementation

```typescript
import { LRParser } from '@lezer/lr';
import { TreeFragment } from '@lezer/common';
import type { ParserAdapter, AdapterParseResult, TextChange, ExpectedToken,
              ParserAdapterConfig, IncrementalParseState } from 'langium-core';
import type { Grammar } from 'langium-core/languages/generated/ast';

interface LezerIncrementalState {
    tree: Tree;
    fragments: readonly TreeFragment[];
}

export class LezerAdapter implements ParserAdapter {
    readonly name = 'lezer';
    readonly supportsIncremental = true;

    private parser!: LRParser;
    private fieldMap!: FieldMap;
    private keywordSet!: Set<string>;

    configure(grammar: Grammar, config?: ParserAdapterConfig): void {
        // Load pre-compiled parse tables (generated at build time by CLI)
        // The parser module path is derived from the grammar/config
        // this.parser = loadParserModule(grammar, config);
        // this.fieldMap = loadFieldMap(grammar, config);
        // this.keywordSet = loadKeywordSet(grammar, config);
    }

    parse(text: string, _entryRule?: string): AdapterParseResult {
        const tree = this.parser.parse(text);
        const root = new LezerRootSyntaxNode(tree.topNode, text, this.fieldMap);
        root.setDiagnostics(this.extractDiagnostics(tree, text));
        return {
            root,
            incrementalState: {
                tree,
                fragments: TreeFragment.addTree(tree)
            } as LezerIncrementalState
        };
    }

    parseIncremental(
        text: string,
        previousState: IncrementalParseState,
        changes: readonly TextChange[]
    ): AdapterParseResult {
        const prev = previousState as LezerIncrementalState;

        // Convert TextChange[] to Lezer's change format
        const lezerChanges = changes.map(c => ({
            fromA: c.rangeOffset,
            toA: c.rangeOffset + c.rangeLength,
            fromB: c.rangeOffset,
            toB: c.rangeOffset + c.text.length
        }));

        // Apply changes to fragments for tree reuse
        const fragments = TreeFragment.applyChanges(prev.fragments, lezerChanges);

        // Parse with fragment reuse — Lezer reuses unchanged subtrees
        const tree = this.parser.parse(text, fragments);
        const root = new LezerRootSyntaxNode(tree.topNode, text, this.fieldMap);
        root.setDiagnostics(this.extractDiagnostics(tree, text));

        return {
            root,
            incrementalState: {
                tree,
                fragments: TreeFragment.addTree(tree)
            } as LezerIncrementalState
        };
    }

    getExpectedTokens(_text: string, _offset: number): ExpectedToken[] {
        // See §5 below for completion implementation
        return [];
    }

    private extractDiagnostics(tree: Tree, text: string): ParseDiagnostic[] {
        // Walk tree for error nodes (type.isError === true)
        const diagnostics: ParseDiagnostic[] = [];
        tree.iterate({
            enter(node) {
                if (node.type.isError) {
                    diagnostics.push({
                        message: 'Unexpected input',
                        offset: node.from,
                        length: node.to - node.from,
                        severity: 'error',
                        source: 'parser'
                    });
                }
            }
        });
        return diagnostics;
    }

    dispose(): void {
        // No resources to release for pure-JS Lezer
    }
}
```

### 4.2 Loading Pre-Compiled Parse Tables

The `configure()` method loads parse tables that were generated at build time by `LezerGrammarTranslator.translate()`. Two strategies:

1. **Dynamic import** (Node.js): `await import(parserModulePath)` to load the generated `.js` module containing `LRParser.deserialize(...)`.
2. **Bundled** (browser/VS Code): Parse tables bundled into the language server at build time.

The `configure()` method receives the grammar and config, from which it derives the path to the generated parser module (e.g., `<outDir>/<languageId>.parser.js`).

### 4.3 Incremental Parsing Flow

```
textDocument/didChange
       │
       ├─ TextChange[] from LSP
       │
       ▼
DocumentBuilder calls adapter.parseIncremental(newText, prevState, changes)
       │
       ├─ TreeFragment.applyChanges(prevFragments, lezerChanges)
       │     Adjusts fragment positions for the edit
       │
       ├─ parser.parse(newText, adjustedFragments)
       │     Lezer reuses unchanged subtrees from fragments
       │     Only re-parses the edited region + affected context
       │
       ├─ Returns new tree + new fragments
       │
       ▼
Document stores new incrementalState for next edit
```

For a typical single-character edit in a 10KB document, Lezer re-parses ~100-500 bytes instead of the full 10KB.

### 4.4 DocumentBuilder Integration

The `DocumentBuilder` (in `langium-core`) already supports the `ParserAdapter` interface. For incremental parsing, the `DocumentBuilder.update()` method needs a small change:

```typescript
// In langium-core/src/workspace/document-builder.ts (modification)
async update(document: LangiumDocument, changes: TextChange[]): Promise<void> {
    const adapter = this.services.parser.ParserAdapter;

    let result: AdapterParseResult;
    if (adapter.supportsIncremental
        && document.incrementalParseState
        && changes.length > 0) {
        result = adapter.parseIncremental!(
            document.textDocument.getText(),
            document.incrementalParseState,
            changes
        );
    } else {
        result = adapter.parse(document.textDocument.getText());
    }

    document.incrementalParseState = result.incrementalState;
    // Rebuild AST from new SyntaxNode tree...
}
```

---

## 5. Lezer Completion

File: `src/parser/lezer-completion.ts`

### 5.1 Approach

Chevrotain provides `computeContentAssist()` which returns expected tokens at a position. Lezer has no direct equivalent. Instead, the Lezer completion strategy:

1. **Parse up to cursor**: Use a partial parse (Lezer supports parsing partial input via `parser.parse(text.slice(0, offset))`).
2. **Inspect parse state**: The resulting tree's rightmost error or incomplete node indicates what the parser expects.
3. **Use GrammarRegistry**: Look up the parent rule's alternatives to determine valid completions.

```typescript
export function getLezerExpectedTokens(
    parser: LRParser,
    text: string,
    offset: number,
    grammarRegistry: GrammarRegistry
): ExpectedToken[] {
    // Parse text up to offset
    const partialTree = parser.parse(text.slice(0, offset));

    // Find the deepest node at the end of the partial parse
    const cursor = partialTree.cursor();
    cursor.moveTo(offset);

    // Use the node type + grammar registry to determine expected tokens
    const parentRule = grammarRegistry.getRuleByName(cursor.name);
    if (!parentRule) return [];

    const alternatives = grammarRegistry.getAlternatives(cursor.name);
    return alternatives
        .filter(alt => isTokenElement(alt))
        .map(alt => ({
            name: getTokenName(alt),
            isKeyword: isKeywordElement(alt),
            pattern: getTokenPattern(alt)
        }));
}
```

### 5.2 Limitations

Lezer completion is inherently less precise than Chevrotain's `computeContentAssist()` for LL grammars. Acceptable tradeoffs:

- May suggest tokens that are grammatically valid but semantically invalid (filtered by scope/linker anyway)
- Does not handle mid-token completion as precisely (e.g., completing `per` → `person`)
- Error recovery state may cause over-suggestion

These limitations are acceptable because Langium's completion pipeline already applies semantic filtering (scope, validation) on top of syntactic suggestions.

---

## 6. CLI Integration: `--backend` Flag

### 6.1 Config Changes

File: `packages/langium-cli/src/package-types.ts`

```typescript
export interface LangiumConfig {
    // ... existing fields ...
    /** Default parser backend. Default: 'chevrotain'. */
    parserBackend?: 'chevrotain' | 'lezer';
}

export interface LangiumLanguageConfig {
    // ... existing fields ...
    /** Per-language parser backend override. */
    parserBackend?: 'chevrotain' | 'lezer';
}
```

### 6.2 CLI Option

File: `packages/langium-cli/src/langium.ts`

```typescript
program.command('generate')
    // ... existing options ...
    .option('-b, --backend <backend>', 'Parser backend (chevrotain or lezer)', 'chevrotain')
    .action(generateAction);
```

CLI flag `--backend` overrides config file's `parserBackend`.

### 6.3 Generate Flow Changes

File: `packages/langium-cli/src/generate.ts`

```typescript
async function runGenerator(config: LangiumConfig, options: GenerateOptions): Promise<void> {
    const backend = options.backend ?? config.parserBackend ?? 'chevrotain';

    // Common: parse .langium, generate ast.ts, module.ts
    // ...

    if (backend === 'chevrotain') {
        // Existing flow: validateParser(), serializeGrammar()
        await runChevrotainGeneration(config, grammar);
    } else if (backend === 'lezer') {
        // New flow: validate, translate, generate parse tables
        const translator = new LezerGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        if (hasErrors(diagnostics)) {
            reportDiagnostics(diagnostics);
            return;
        }
        const result = await translator.translate(grammar, outputDir);
        reportDiagnostics(result.diagnostics);
    }
}
```

### 6.4 Generated Module Wiring

For Lezer, the generated `module.ts` should wire the `LezerModule` instead of `ChevrotainModule`:

```typescript
// Generated: src/language/generated/module.ts (when backend = lezer)
import { LezerModule } from 'langium-lezer';
import { parserTables } from './my-language.parser.js';
import { fieldMap } from './my-language.field-map.js';

export const MyLanguageModule: Module<...> = {
    ...LezerModule,
    parser: {
        ParserAdapter: (services) => {
            const adapter = new LezerAdapter(services);
            adapter.loadParseTables(parserTables, fieldMap);
            return adapter;
        }
    }
};
```

---

## 7. Cross-Backend Conformance Tests

File: `test/cross-backend/conformance.test.ts`

### 7.1 Test Structure

```typescript
describe('Cross-backend conformance', () => {
    const grammars = [
        'arithmetics',    // infix rules, binary expressions
        'domainmodel',    // imports, cross-references, inheritance
        'statemachine',   // simple state machine
        'hello-world',    // minimal grammar
    ];

    for (const grammarName of grammars) {
        describe(grammarName, () => {
            it('produces identical AST for valid input', async () => {
                const input = loadTestInput(grammarName);
                const chevrotainAst = await parseWith('chevrotain', grammarName, input);
                const lezerAst = await parseWith('lezer', grammarName, input);
                assertAstEqual(chevrotainAst, lezerAst);
            });

            it('produces same diagnostics for invalid input', async () => {
                const input = loadInvalidTestInput(grammarName);
                const chevrotainResult = await parseWith('chevrotain', grammarName, input);
                const lezerResult = await parseWith('lezer', grammarName, input);
                assertDiagnosticsEquivalent(
                    chevrotainResult.diagnostics,
                    lezerResult.diagnostics
                );
            });

            it('produces same completions at cursor positions', async () => {
                const { text, positions } = loadCompletionTestInput(grammarName);
                for (const pos of positions) {
                    const chevrotainTokens = getExpectedTokensWith('chevrotain', grammarName, text, pos);
                    const lezerTokens = getExpectedTokensWith('lezer', grammarName, text, pos);
                    assertCompletionsEquivalent(chevrotainTokens, lezerTokens);
                }
            });
        });
    }
});
```

### 7.2 AST Equality

`assertAstEqual` compares:
- `$type` on every node
- All property values (primitives, references by name, arrays by element)
- Tree structure (container/child relationships)
- Does **not** compare: `$syntaxNode` (backend-specific), `$cstNode`, positional data on the AST itself

### 7.3 Diagnostic Equivalence

Diagnostics may differ in exact wording between backends but must agree on:
- Number of errors
- Approximate positions (within a few characters tolerance)
- Severity

---

## 8. Incremental Parsing Tests

File: `test/cross-backend/incremental.test.ts`

### 8.1 Correctness: Incremental vs Full Parse

```typescript
describe('Incremental parsing correctness', () => {
    it('single character insertion produces same AST as full reparse', async () => {
        const original = 'person Alice\nperson Bob';
        const { incrementalState } = await lezerParse(original);

        // Insert " age 30" after "Alice"
        const edited = 'person Alice age 30\nperson Bob';
        const change: TextChange = { rangeOffset: 12, rangeLength: 0, text: ' age 30' };

        const incrementalResult = await lezerParseIncremental(edited, incrementalState, [change]);
        const fullResult = await lezerParse(edited);

        assertAstEqual(incrementalResult.ast, fullResult.ast);
    });

    it('line deletion produces same AST as full reparse', async () => { ... });
    it('multi-edit produces same AST as full reparse', async () => { ... });
    it('edit inside string literal produces same AST', async () => { ... });
    it('edit that changes token boundaries produces same AST', async () => { ... });
});
```

### 8.2 Performance: Incremental Faster Than Full

```typescript
describe('Incremental parsing performance', () => {
    it('incremental is faster than full for documents > 1KB', async () => {
        const largeDoc = generateLargeDocument(5000); // ~5KB
        const { incrementalState } = await lezerParse(largeDoc);

        // Small edit near the middle
        const offset = Math.floor(largeDoc.length / 2);
        const edited = largeDoc.slice(0, offset) + 'x' + largeDoc.slice(offset);
        const change: TextChange = { rangeOffset: offset, rangeLength: 0, text: 'x' };

        const fullStart = performance.now();
        await lezerParse(edited);
        const fullTime = performance.now() - fullStart;

        const incrStart = performance.now();
        await lezerParseIncremental(edited, incrementalState, [change]);
        const incrTime = performance.now() - incrStart;

        expect(incrTime).toBeLessThan(fullTime);
    });
});
```

---

## 9. Step-by-Step Implementation Instructions

### Step 1: Create `langium-lezer` package scaffold

- Create directory structure per §1.1
- Set up `package.json` with dependencies per §1.2
- Set up `tsconfig.json` / `tsconfig.build.json` extending root configs
- Add to root workspace and `tsconfig.build.json` references
- Create `src/index.ts` with placeholder exports
- Verify `npm run build` still passes

### Step 2: Implement LezerGrammarTranslator

- Implement `validate()`: check for unsupported regex features
- Implement `translate()`: Grammar AST → `.grammar` file text
- Start with simple grammars (hello-world, then arithmetics)
- Generate field map JSON alongside `.grammar` file
- Call `@lezer/generator`'s `buildParserFile()` to produce parse tables
- Write unit tests: round-trip from Langium grammar → Lezer grammar text → parse tables

### Step 3: Implement LezerSyntaxNode

- Implement `LezerSyntaxNode` wrapping `@lezer/common`'s `SyntaxNode`
- Implement `LezerRootSyntaxNode` with diagnostics
- Implement `FieldMap` data structure
- Lazy children via cursor traversal
- `childForField()` / `childrenForField()` via field map lookup
- Write unit tests: parse with Lezer, wrap in LezerSyntaxNode, verify all SyntaxNode properties

### Step 4: Implement LezerAdapter

- Implement `configure()`: load pre-compiled parse tables
- Implement `parse()`: full parse → `LezerRootSyntaxNode`
- Implement `parseIncremental()`: fragment-based reuse
- Implement `extractDiagnostics()`: walk tree for error nodes
- Implement `dispose()`: no-op for pure JS
- Write unit tests: parse valid/invalid input, verify AST + diagnostics

### Step 5: Implement Lezer completion

- Implement `getExpectedTokens()` via partial parse + grammar registry
- Write unit tests: verify expected tokens at various cursor positions

### Step 6: CLI integration

- Add `parserBackend` to config types
- Add `--backend` CLI option
- Branch `runGenerator()` for lezer backend
- Generate wired `module.ts` for Lezer
- Test: `langium generate --backend=lezer` on example grammars

### Step 7: DI module and service wiring

- Create `LezerModule` in `lezer-module.ts`
- Create `LangiumLezerServices` type
- Verify a language server can start with Lezer backend

### Step 8: Cross-backend conformance tests

- Write conformance tests per §7
- Run against example grammars (arithmetics, domainmodel, statemachine)
- Fix any AST differences until all pass

### Step 9: Incremental parsing tests

- Write correctness tests per §8.1
- Write performance tests per §8.2
- Verify incremental state survives across multiple edits

### Step 10: Integration testing

- Run full Langium test suite with Lezer backend where applicable
- Test LSP services (hover, completion, go-to-definition) with Lezer backend
- Verify example projects work end-to-end with `--backend=lezer`

---

## 10. Key Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Complex Langium regex terminals can't translate to Lezer tokens | Some grammars won't work with Lezer | Validate upfront, emit clear diagnostics suggesting string body rewrite (`terminal X: 'lezer_syntax';`) |
| Field map approach is fragile for deeply nested alternatives | `childForField()` returns wrong node | Extensive conformance tests; fall back to positional matching |
| Lezer error recovery produces different tree shapes than Chevrotain | LSP services behave differently | Conformance tests with invalid input; accept "equivalent" not "identical" diagnostics |
| `@lezer/generator` as build dependency adds weight | Larger CLI install | Generator is dev-only; parse tables are small runtime artifacts |
| Incremental AST rebuilding is expensive even with incremental parse | Keystroke latency not improved | Phase 2 only does incremental parse; incremental AST rebuild is a future optimization |

---

## 11. Files to Create

| File | Purpose |
|------|---------|
| `packages/langium-lezer/package.json` | Package manifest |
| `packages/langium-lezer/tsconfig.json` | TypeScript config |
| `packages/langium-lezer/tsconfig.build.json` | Build config |
| `packages/langium-lezer/src/index.ts` | Public exports |
| `packages/langium-lezer/src/parser/lezer-adapter.ts` | ParserAdapter implementation |
| `packages/langium-lezer/src/parser/lezer-syntax-node.ts` | SyntaxNode implementation |
| `packages/langium-lezer/src/parser/lezer-grammar-translator.ts` | GrammarTranslator implementation |
| `packages/langium-lezer/src/parser/lezer-completion.ts` | Completion via parse state |
| `packages/langium-lezer/src/parser/lezer-module.ts` | DI module |
| `packages/langium-lezer/src/parser/lezer-services.ts` | Service types |
| `packages/langium-lezer/src/parser/field-map.ts` | FieldMap data structure |
| `packages/langium-lezer/src/parser/regex-to-lezer.ts` | Best-effort simple regex → Lezer token conversion |
| `packages/langium-lezer/test/parser/lezer-syntax-node.test.ts` | SyntaxNode wrapper tests |
| `packages/langium-lezer/test/parser/lezer-adapter.test.ts` | Adapter tests |
| `packages/langium-lezer/test/parser/lezer-grammar-translator.test.ts` | Translator tests |
| `packages/langium-lezer/test/parser/lezer-completion.test.ts` | Completion tests |
| `packages/langium-lezer/test/cross-backend/conformance.test.ts` | Cross-backend AST equality |
| `packages/langium-lezer/test/cross-backend/incremental.test.ts` | Incremental correctness + perf |

## 12. Files to Modify

| File | Change |
|------|--------|
| `tsconfig.build.json` (root) | Add `langium-lezer` to project references |
| `package.json` (root) | Add `langium-lezer` to workspaces |
| `packages/langium-cli/src/package-types.ts` | Add `parserBackend` field |
| `packages/langium-cli/src/langium.ts` | Add `--backend` CLI option |
| `packages/langium-cli/src/generate.ts` | Branch generation flow for lezer |
| `packages/langium-core/src/workspace/documents.ts` | Add `incrementalParseState` to `LangiumDocument` |
| `packages/langium/package.json` | Add `langium-lezer` as optional peer dependency |
