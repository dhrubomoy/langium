# PRD: Replace Chevrotain with Tree-sitter

**Status:** needs-triage  
**Feature slug:** langium-treesitter

---

## Problem Statement

Langium language authors and their users experience significant performance and memory degradation as language workspaces grow. The root cause is Langium's current parser, Chevrotain, which builds an in-memory Concrete Syntax Tree (CST) on every document change — even when only a single character is edited. There is no incremental parsing: every keystroke triggers a full re-parse of the affected document and a full rebuild of the CST, AST, and linked symbol table. TypeFox, the original maintainers of Langium, have themselves started replacing the CST with token-metadata approaches on their own projects because the overhead became untenable. Language server users feel this as editor lag, memory pressure, and sluggish diagnostics.

## Solution

Replace Chevrotain entirely with tree-sitter (via `web-tree-sitter`) as Langium's parser. Tree-sitter provides incremental parsing — it only re-parses the changed subtrees after an edit. Rather than rebuilding a parallel CST and AST, Langium will work directly from tree-sitter's native syntax nodes through a metadata-driven `DocumentIndex`: a flat, efficient map of declarations, references, and diagnostics built in a single pass over the parsed tree. The `langium generate` CLI will compile `.langium` grammar files into tree-sitter `grammar.js` definitions, invoke the tree-sitter CLI to produce `.wasm` parser bundles, and emit a `metadata.ts` mapping table that the runtime uses to interpret the raw syntax tree.

The result is a cross-environment (Node.js and web extensions), incrementally-parsing language server backend with no Chevrotain dependency, no CST allocation, and a clean metadata-table foundation that serves both v1 (direct index queries) and future incremental linking optimizations.

## User Stories

### Language Author

1. As a language author, I want `langium generate` to compile my `.langium` grammar into a tree-sitter `grammar.js` definition, so that I do not have to learn or manually write tree-sitter grammar syntax.
2. As a language author, I want `langium generate` to invoke the tree-sitter CLI and produce a `grammar.wasm` file, so that I have a single build command that outputs everything needed to run my language server.
3. As a language author, I want the compiler to emit a `metadata.ts` mapping table alongside `grammar.js`, so that the runtime can interpret tree-sitter syntax nodes without me writing any mapping code.
4. As a language author, I want to annotate my terminal rule with `@word` to declare the word/identifier terminal, so that tree-sitter can disambiguate keywords from identifiers correctly.
5. As a language author, I want to use `@prec(n)` annotations on parser rule alternatives to express operator precedence, so that I can resolve ambiguities without writing a separate precedence table.
6. As a language author, I want to declare `conflicts: [RuleA, RuleB];` at the grammar level, so that I can explicitly tell tree-sitter's GLR parser how to resolve specific grammar conflicts.
7. As a language author, I want the compiler to emit clear migration errors for dropped Langium grammar features (`UnorderedGroup`, `RuleParameter`, `GuardCondition`, `NegatedToken`, `UntilToken`, semantic predicates, lookahead assertions) with concrete migration hints, so that I know exactly what to change when upgrading my grammar.
8. As a language author, I want fragment rules to be compiled to `_`-prefixed inline rules in tree-sitter, so that I get the same code-reuse benefit without fragments appearing as named nodes in the tree.
9. As a language author, I want hidden terminals to be compiled to tree-sitter's `extras` array, so that whitespace and comments are automatically ignored during parsing without boilerplate.
10. As a language author, I want assignments (`=`, `+=`, `?=`) in my grammar to be translated to `field()` declarations in `grammar.js` plus operator-semantics entries in `metadata.ts`, so that I retain the same declarative field model I use today.
11. As a language author, I want `Action` nodes (`{infer T}`, `{Type.field=current}`) to be represented in `metadata.ts` so that the runtime can determine the correct `$type` without semantic actions in the parser.
12. As a language author, I want `CrossReference` declarations (`[Type:Rule]`) to be emitted as `isRef: true` entries in `metadata.ts`, so that the runtime knows which fields hold references rather than values.

### Language Server User (End User)

13. As a language server user, I want parse errors to appear as diagnostics in my editor without noticeable delay after every keystroke, so that I get fast feedback on syntax mistakes.
14. As a language server user, I want cross-reference errors (unresolved identifiers) to appear as diagnostics, so that I can detect undefined variables and types without running the language.
15. As a language server user, I want "Go to definition" to navigate instantly to the declaration of any symbol, so that I can explore code without searching manually.
16. As a language server user, I want "Find all references" to list every usage of a symbol across the document, so that I can understand where a declaration is used.
17. As a language server user, I want "Document symbols" to show an outline of all declared names, so that I can navigate large files quickly.
18. As a language server user, I want "Rename symbol" to update every occurrence of a name atomically, so that I can refactor identifiers safely.
19. As a language server user, I want folding ranges to collapse blocks in my language, so that I can manage large files visually.
20. As a language server user, I want a language server that stays responsive even in large workspaces, so that my editor does not freeze or stutter when editing complex files.
21. As a language server user, I want incremental parsing so that only the changed portion of a document is re-parsed after an edit, so that the server responds quickly even in files with thousands of lines.

### Language Server Author (Service Implementor)

22. As a service implementor, I want a `DocumentIndex` interface with a stable API (declarations map, references map, diagnostics list), so that I can build LSP features against a well-defined contract without depending on tree-sitter internals.
23. As a service implementor, I want the index builder to collect `ERROR` and `MISSING` tree-sitter nodes in the same pass that builds the declaration/reference maps, so that diagnostics are always consistent with the index state.
24. As a service implementor, I want the index to be rebuilt atomically on every document change, so that LSP queries never observe a partially-updated state.
25. As a service implementor, I want the `DocumentIndex` keyed by `URI`, so that multi-document workspaces are supported from the start.
26. As a service implementor, I want `web-tree-sitter` used as the binding, so that the language server works in both Node.js environments and VS Code web extensions without native addons.
27. As a service implementor, I want the `grammar.wasm` loaded via a path threaded through the service container (not hardcoded), so that the same loader code works in both desktop and web extension contexts.

### Langium Core Maintainer

28. As a core maintainer, I want all Chevrotain and `chevrotain-allstar` dependencies removed from `package.json` after v1 ships, so that there is no dead code and the bundle size is reduced.
29. As a core maintainer, I want all `CstNode`, `CstNodeBuilder`, `LangiumParser`, `ChevrotainWrapper`, `TokenBuilder`, and `DefaultLexer` types deleted, so that the codebase is clean and does not suggest to contributors that the CST approach is still used.
30. As a core maintainer, I want `langium generate` to be the single entry point for all code generation (grammar.js, metadata.ts, grammar.wasm), so that language authors have one command and one config format.
31. As a core maintainer, I want the metadata table format to be a stable, versioned TypeScript type (`GrammarMetadata`), so that future tooling can consume it without breaking changes.
32. As a core maintainer, I want the grammar compiler to be tested with the hand-written arithmetic example as ground truth, so that I can validate generated output against a known-good reference.

## Implementation Decisions

### Modules to Build or Modify

**Module 1: Grammar Syntax Extensions (`langium-cli`)**  
Extend the `.langium` grammar parser to recognize three new surface-level constructs:
- `@word` annotation on terminal rules
- `@prec(n)` annotation on rule alternatives or group elements
- `conflicts: [Rule, Rule, ...];` top-level declaration  
These are parsed and represented in the grammar AST, then fed to the grammar compiler. Dropped features are rejected with migration error messages at parse time.

**Module 2: Grammar Compiler (`langium-cli`)**  
A new compiler stage inside `langium generate` that:
- Traverses the Langium grammar AST and emits a tree-sitter `grammar.js` file
- Emits a `metadata.ts` file (a `GrammarMetadata` constant) describing node-to-AST-type mappings, field operators, reference markers, and passthrough semantics
- Invokes the tree-sitter CLI (`tree-sitter generate` + `tree-sitter build --wasm`) to produce `grammar.wasm` in the language's `resources/` directory
- Replaces the existing Chevrotain-based code generation path entirely

**Module 3: WASM Loader Service (`langium`)**  
A new service that:
- Accepts `extensionUri` (or equivalent path) at initialization
- Loads `web-tree-sitter` and calls `Language.load(wasmUrl)` before any parsing
- Exposes the initialized `Language` to the parser service
- Works identically in Node.js and web extension environments

**Module 4: DocumentIndex + Index Builder (`langium`)**  
The core runtime module:
- `DocumentIndex` interface: `declarations: Map<string, DeclarationInfo[]>`, `references: Map<string, ReferenceInfo[]>`, `diagnostics: Diagnostic[]`
- `IndexBuilder` service that walks the tree-sitter `SyntaxNode` tree using the `GrammarMetadata` table, populating all three maps in a single pass
- `ERROR` and `MISSING` nodes are converted to generic "Syntax error" diagnostics in the same walk
- On every document update, the old `Tree` is retained for tree-sitter's incremental parse, then the index is fully rebuilt from the new tree

**Module 5: LSP Service Adapters (`langium/lsp`)**  
Seven thin adapters that read from `DocumentIndex` and implement standard LSP interfaces:
- Parse-error diagnostics (from `index.diagnostics`)
- Cross-ref diagnostics (references with no matching declaration)
- Go-to-definition (lookup in `declarations` map)
- Find references (lookup in `references` map)
- Document symbols (all entries in `declarations` map)
- Rename (edit all entries in both maps for a given name)
- Folding ranges (tree-sitter node ranges directly)

### Technical Clarifications

- **tree-sitter binding:** `web-tree-sitter` (WASM) is the only supported binding. `node-tree-sitter` (native addon) is not used.
- **Incremental parsing granularity (v1):** Tree-sitter's C layer parses incrementally (reusing unchanged subtrees). The index builder runs a full walk of the new tree on every update. Range-based incremental index invalidation is a v2 concern.
- **Cross-reference resolution (v1):** Full re-link on every update. On a document change, the index is fully rebuilt. Incremental cross-ref invalidation (re-link only dirty ranges) is a v2 concern.
- **No CST, no typed AST:** The `DocumentIndex` is the only in-memory representation derived from the tree. There is no `CstNode` hierarchy, no parallel AST object graph, and no typed wrapper layer. LSP services query the index directly.
- **`GrammarMetadata` stability:** The shape of `metadata.ts` is a public API. The `GrammarMetadata` type is exported from `langium/generate` and versioned.
- **Error messages (v1):** All parse errors are "Syntax error at [range]". Enrichment from metadata (e.g., "Expected expression") is a v2 concern.
- **`.wasm` artifact location:** `resources/grammar.wasm` in each language package. Binary artifacts do not live next to TypeScript source files.
- **`extensionUri` threading:** The path to `grammar.wasm` is passed into `createLangiumServices()` as an explicit parameter, travels through the service container to the WASM Loader, and is used to construct the fetch URL. `context.extensionPath` (Node.js-only) must not be used.

### Dropped Grammar Features (Breaking Changes)

| Feature | Migration |
|---|---|
| `UnorderedGroup` (`&`) | Rewrite as ordered alternatives |
| `RuleParameter` / `GuardCondition` | Duplicate rules, one per variant |
| `NegatedToken` (`!element`) | Rewrite as regex |
| `UntilToken` (`->element`) | Rewrite as regex |
| Semantic predicates (`=>`, `->` on grammar elements) | Use `conflicts` + `prec` |
| Terminal lookahead assertions (`?=`, `?!`, `?<=`, `?<!`) | Rewrite as unambiguous terminals |

## Testing Decisions

**What makes a good test:**  
Tests should assert on observable outputs and public interfaces — not on internal traversal order, intermediate data structures, or private methods. For the compiler, the observable output is the content of `grammar.js` and `metadata.ts`. For the index builder, the observable output is the populated `DocumentIndex`. For LSP adapters, the observable output is the LSP response shape. Tests should not assert on tree-sitter internal node IDs or pointer addresses.

**Modules to test:**

- **Grammar syntax extensions:** Parse `.langium` strings containing `@word`, `@prec`, `conflicts` and assert the grammar AST contains the correct nodes. Use the existing `parseHelper` pattern from `langium/test`. Assert that dropped features emit parse errors with migration hints.
- **Grammar compiler:** Given a `.langium` source string, assert the emitted `grammar.js` text matches expected tree-sitter constructs (seq, choice, field, prec, extras, word). Assert the emitted `metadata.ts` constant matches the expected `GrammarMetadata` shape. Use the hand-written arithmetic `grammar.js` + `metadata.ts` as ground-truth reference fixtures.
- **DocumentIndex + Index Builder:** Given a `GrammarMetadata` and a mock tree-sitter `SyntaxNode` tree (or a real one parsed by `web-tree-sitter` in a test environment), assert that `declarations`, `references`, and `diagnostics` are populated correctly for representative inputs (simple declaration, cross-reference, syntax error node).
- **LSP adapters:** Given a `DocumentIndex` with known content, assert each adapter returns the correct LSP response. These are pure function tests with no tree-sitter dependency.

**Prior art in the codebase:**  
`packages/langium/test/grammar/` — grammar parsing and validation tests using `createLangiumGrammarServices(EmptyFileSystem)` and `parseHelper`. New compiler tests can follow the same pattern, replacing assertions on diagnostics with assertions on emitted file content.

## Out of Scope

- **Code completion:** Requires a follow-set table emitted at compile time. Planned for v2.
- **Hover:** Planned for v2.
- **Semantic tokens:** Planned for v2.
- **Enriched parse error messages:** Generic "Syntax error" in v1. Metadata-driven enrichment planned for v2.
- **Range-based incremental link invalidation:** Full re-link in v1. Incremental cross-ref resolution planned for v2.
- **External scanner support:** `external terminal` grammar syntax and C scanner skeleton generation. Planned for v2.
- **Multi-language workspace cross-references:** Cross-document linking within the same workspace is supported, but linking across separately-managed Langium service containers is not addressed.
- **`node-tree-sitter` native addon support:** Only `web-tree-sitter` (WASM) is supported.
- **Migration tooling:** There is no automated codemigration tool for grammars using dropped features. Authors receive compile-time errors with hints.

## Further Notes

- The v1 implementation order (per `docs/plan.md`) is: WASM loader → hand-written arithmetic grammar.js + metadata.ts → DocumentIndex + index builder → 7 LSP services → grammar compiler → end-to-end validation with generated artifacts → Chevrotain deletion. The compiler is intentionally built after the full pipeline is validated end-to-end with a hand-written reference.
- `web-tree-sitter` requires an async initialization step (`Language.load()`). This must complete before any document can be parsed. The service container initialization must be made async-aware in the WASM Loader design.
- The TypeFox blog post ("XText/Langium — What's Next?") confirms that eliminating the CST in favor of token metadata is the direction the original authors are pursuing. This PRD aligns with that direction.
- The hand-written arithmetic `grammar.js` + `metadata.ts` serve a dual purpose: they validate the full pipeline before the compiler exists, and they become the ground-truth regression fixture for the compiler once it is built.
