# Langium-X: Parser-Agnostic Langium Fork

Langium-X decouples Langium (TypeScript DSL framework with LSP support) from its Chevrotain parser,
enabling a Lezer backend with incremental parsing. Full design: [DESIGN.md](DESIGN.md).
Branch: `parser-agnostic-langium`.

## Monorepo Structure

```
packages/
  langium-core/            # Parser-agnostic core (DI, grammar, utils, workspace, validation)
  langium-chevrotain/      # Chevrotain parser backend (LangiumParser, Lexer, TokenBuilder, Hydrator)
  langium-lsp/             # LSP services (completion, hover, rename, etc.) + grammar module
  langium/                 # Meta-package re-exporting all three for backward compatibility
  langium-cli/             # CLI for grammar generation (langium generate)
  langium-vscode/          # VS Code extension
  langium-railroad/        # Railroad diagram generator
  langium-sprotty/         # Sprotty visualization integration
  langium-lezer/           # Lezer parser backend (incremental parsing, zero-copy SyntaxNode)
  generator-langium/       # Yeoman project generator
examples/
  arithmetics/             # Example: arithmetic expressions DSL
  domainmodel/             # Example: domain model DSL
  requirements/            # Example: requirements DSL
  statemachine/            # Example: state machine DSL
```

## Key Interfaces

**SyntaxNode** (`packages/langium/src/parser/syntax-node.ts`): Backend-agnostic parse tree node
replacing CstNode. No AST back-pointer, no grammarSource pointer. Key: `type`, `offset`, `end`,
`text`, `children`, `isLeaf`, `isKeyword`, `childForField(name)`, `childrenForField(name)`.

**ParserAdapter** (`packages/langium/src/parser/parser-adapter.ts`): Backend plugin interface.
`configure(grammar)`, `parse(text)`, `parseIncremental?(...)`, `getExpectedTokens(text, offset)`.
Chevrotain implementation: `ChevrotainAdapter` in same directory.

**GrammarTranslator** (`packages/langium/src/parser/grammar-translator.ts`): Build-time grammar
compilation interface. `validate(grammar)`, `translate(grammar, outputDir)`. One impl per backend.

**GrammarRegistry** (`packages/langium/src/grammar/grammar-registry.ts`): O(1) grammar introspection
by node type name, replacing grammarSource back-pointers. `getRuleByName(type)`, `isKeyword(type)`,
`getAlternatives(rule)`, `getAssignment(parent, child)`.

## Key Design Decisions

- CST eliminated for new backends; SyntaxNode wraps each backend's native tree (zero copy)
- Build-time grammar compilation for all backends (no runtime grammar interpretation for Lezer)
- External tokenizer modules are TypeScript for both Chevrotain and Lezer
- `$syntaxNode` replaces `$cstNode` on AstNode (with backward-compat alias)
- GrammarRegistry replaces per-node grammarSource pointers (O(1) lookup by type string)
- Infix rules (Langium 4) handle binary operator precedence — no changes needed
- New grammar syntax: `@precMarker`, `external tokens`, `conflicts`, `specialize`/`extend`, `local tokens`
- Terminal rules support regex body (`/pattern/` — portable) and string body (`'native'` — backend-specific verbatim passthrough)

## Current Phase

**Blocked: Lezer backend integration gaps (Phase 1/2 incomplete items)**

The Lezer backend works at the parser level (SyntaxNode trees, incremental parsing) but
**cannot produce ASTs or run LSP services**. See DESIGN.md §11 for full gap analysis.

Phase file: [docs/phases/PHASE-2.md](docs/phases/PHASE-2.md)

## Implementation Progress

### Phase 1: SyntaxNode + Chevrotain Adapter
- [x] Define SyntaxNode, ParserAdapter, GrammarTranslator interfaces
- [x] Create GrammarRegistry service (DefaultGrammarRegistry)
- [x] Implement ChevrotainSyntaxNode wrapping CstNode
- [x] Implement ChevrotainAdapter wrapping LangiumParser
- [x] Migrate DocumentBuilder/DocumentFactory to use $syntaxNode
- [x] Add $syntaxNode to AstNode, deprecate $cstNode
- [x] AST builder sets $syntaxNode via lazy getter (cst-node-builder.ts)
- [ ] **INCOMPLETE: Migrate LSP services from CstNode to SyntaxNode** — all 10 LSP service files
  in langium-lsp still use `$cstNode` and `CstUtils` as primary path, with SyntaxNode only at
  entry points. With Lezer backend, `$cstNode` is always undefined so all LSP features return
  empty results. Files: hover-provider, definition-provider, references-provider, rename-provider,
  document-highlight-provider, call-hierarchy-provider, type-hierarchy-provider, type-provider,
  implementation-provider, formatter.
- [ ] **INCOMPLETE: Migrate core services from CstNode to SyntaxNode** — CommentProvider,
  NameProvider.getNameNode(), AstDescriptions, DocumentValidator.getDiagnosticRange(),
  JsonSerializer all use `$cstNode` directly.
- [ ] **INCOMPLETE: References service API still CstNode-typed** — `findDeclarations(CstNode)`
  and `findDeclarationNodes(CstNode)` need SyntaxNode overloads.
- [x] Set up monorepo split (langium-core, langium-chevrotain, langium-lsp)
- [x] Run full test suite — 1264 passed, 2 pre-existing failures (fs.rmdirSync deprecation)

### Phase 2: Lezer Adapter + Incremental Parsing
- [x] Create langium-lezer package (package.json, tsconfig, workspace wiring)
- [x] Implement FieldMap data structure (field-map.ts)
- [x] Implement regex-to-lezer converter (regex-to-lezer.ts)
- [x] Implement LezerGrammarTranslator (Grammar AST → .grammar → parse tables)
- [x] Implement LezerSyntaxNode (cursor-based, zero-copy, WeakMap cached)
- [x] Implement LezerAdapter (full + incremental parsing via TreeFragment)
- [x] Implement Lezer completion (parse state analysis)
- [x] Create DI module (LezerModule) and service types (LangiumLezerServices)
- [x] CLI integration: langium generate --backend=lezer (config + CLI flag)
- [x] Wire into root workspace/tsconfig.build.json — full build passes
- [x] Cross-backend conformance tests (parser-level only)
- [x] Incremental parsing correctness + performance tests
- [ ] **INCOMPLETE: SyntaxNode → AST builder** — No generic AST builder exists. `DocumentFactory.parse()`
  calls `LangiumParser.parse()` (Chevrotain-specific). Need a backend-agnostic AST builder that walks
  a SyntaxNode tree and constructs typed AstNodes. (See DESIGN.md §11.1 Gap 1)
- [ ] **INCOMPLETE: SyntaxNode → AstNode positional mapping** — `findAstNodeForSyntaxNode()` in
  syntax-node-utils.ts returns `undefined` for Lezer SyntaxNodes. (See DESIGN.md §11.1 Gap 2)
- [ ] **INCOMPLETE: Linker $refNode** — `Linker.buildReference()` takes CstNode for `$refNode`.
  With Lezer, all Reference.$refNode will be undefined. (See DESIGN.md §11.4)
- [ ] **INCOMPLETE: DefaultAsyncParser** — Directly accesses `services.parser.LangiumParser`.
- [ ] **INCOMPLETE: Dual-backend LSP tests** — LSP tests only run against Chevrotain. Test helper
  `lezer-test-helper.ts` exists in `packages/langium/test/` but tests fail because Lezer cannot
  produce ASTs through the document pipeline.

### Phase 3: Grammar Extensions
- [x] Extend grammar parser (precedence blocks, external tokens, conflicts, specialize/extend, local tokens)
- [x] Extend Grammar AST types (11 new interfaces, Grammar + AbstractElement extended)
- [x] Implement Lezer translation (precedence, external tokens/context, specialize/extend, conflicts, dynamic precedence, local tokens)
- [x] Validation diagnostics (undefined precMarker, duplicate levels, multiple contexts, duplicate mappings)
- [x] Chevrotain backend diagnostics for unsupported features

### Phase 4: Polish
- [x] Performance benchmarks (packages/langium-lezer/test/benchmark/parse-benchmark.test.ts)
- [x] Migration guide (docs/MIGRATION.md)
- [x] Example project with both backends (examples/dual-backend/) — parser-level only
- [x] Documentation (docs/ARCHITECTURE.md, docs/GRAMMAR-EXTENSIONS.md)

## Conventions

- TypeScript strict mode, ESM imports with `.js` extensions
- Vitest for testing; test files mirror source at `test/` within each package
- Dependency injection via Langium's DI system (`Module`, `inject`, `createDefaultModule`)
- New services registered in `default-module.ts`, types declared in `services.ts`
- Prefer `readonly` on interface properties; use WeakMap for caching wrapper objects
- SyntaxNode implementations must be lazy (children computed on access, not construction)
- Bridge utilities in `syntax-node-utils.ts` for gradual CstNode→SyntaxNode migration

## Commands

```bash
npm run build                  # Full build (tsc -b tsconfig.build.json)
npm run build:clean            # Clean + rebuild
npm test                       # Run all tests (vitest run)
npm run test:watch             # Watch mode
npm run lint                   # ESLint
npm run lint:fix               # ESLint --fix
npm run langium:generate       # Regenerate Langium grammar artifacts
npm run clean                  # Remove build artifacts
```

Single-package test: `npx vitest run packages/langium/test/parser/chevrotain-syntax-node.test.ts`

## References

- [DESIGN.md](DESIGN.md) — full design document (read specific sections with §N.N notation)
- [docs/phases/PHASE-1.md](docs/phases/PHASE-1.md) — Phase 1 implementation details
- [Langium upstream](https://github.com/eclipse-langium/langium)
- [Lezer](https://lezer.codemirror.net/) / [Lezer guide](https://lezer.codemirror.net/docs/guide/)
- [Chevrotain](https://chevrotain.io/docs/)
