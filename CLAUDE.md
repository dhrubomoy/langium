# Langium-X: Parser-Agnostic Langium Fork

Langium-X decouples Langium (TypeScript DSL framework with LSP support) from its Chevrotain parser,
enabling Lezer and Tree-sitter backends with incremental parsing. Full design: [DESIGN.md](DESIGN.md).
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
  generator-langium/       # Yeoman project generator
examples/
  arithmetics/             # Example: arithmetic expressions DSL
  domainmodel/             # Example: domain model DSL
  requirements/            # Example: requirements DSL
  statemachine/            # Example: state machine DSL
```

Future packages (not yet created): `langium-lezer`, `langium-tree-sitter`.

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
- Build-time grammar compilation for all backends (no runtime grammar interpretation for Lezer/TS)
- External tokenizer modules are platform-specific (TS for Chevrotain/Lezer, C for Tree-sitter)
- `$syntaxNode` replaces `$cstNode` on AstNode (with backward-compat alias)
- GrammarRegistry replaces per-node grammarSource pointers (O(1) lookup by type string)
- Infix rules (Langium 4) handle binary operator precedence — no changes needed
- New grammar syntax: `@precMarker`, `external tokens`, `conflicts`, `specialize`/`extend`, `local tokens`

## Current Phase

**Phase 1: Foundation — SyntaxNode + Chevrotain Adapter**
Phase file: [docs/phases/PHASE-1.md](docs/phases/PHASE-1.md)

## Implementation Progress

### Phase 1: SyntaxNode + Chevrotain Adapter
- [x] Define SyntaxNode, ParserAdapter, GrammarTranslator interfaces
- [x] Create GrammarRegistry service (DefaultGrammarRegistry)
- [x] Implement ChevrotainSyntaxNode wrapping CstNode
- [x] Implement ChevrotainAdapter wrapping LangiumParser
- [x] Migrate DocumentBuilder/DocumentFactory to use $syntaxNode
- [x] Add $syntaxNode to AstNode, deprecate $cstNode
- [x] AST builder sets $syntaxNode via lazy getter (cst-node-builder.ts)
- [x] Migrate LSP services from CstNode to SyntaxNode:
  - [x] Hover provider
  - [x] Document highlight provider
  - [x] Completion provider
  - [x] Formatter (minimal Phase 1 — entry points + DefaultNodeFormatter use SyntaxNode)
  - [x] Definition/GoTo provider
  - [x] References provider
  - [x] Rename provider
  - [x] Semantic token provider
  - [x] Folding range provider
  - [x] Document symbol provider
  - [x] Signature help provider
  - [x] Call hierarchy provider
  - [x] Type hierarchy/provider/implementation providers
- [x] Set up monorepo split (langium-core, langium-chevrotain, langium-lsp)
- [x] Run full test suite — 1264 passed, 2 pre-existing failures (fs.rmdirSync deprecation)

### Phase 2: Lezer Adapter + Incremental Parsing
- [ ] Implement LezerGrammarTranslator
- [ ] CLI integration: langium generate --backend=lezer
- [ ] Implement LezerSyntaxNode (cursor-based, zero-copy)
- [ ] Implement LezerAdapter (full + incremental parsing)
- [ ] Implement Lezer completion (parse state analysis)
- [ ] Cross-backend conformance tests

### Phase 3: Tree-sitter Adapter
- [ ] Implement TreeSitterGrammarTranslator
- [ ] CLI integration: langium generate --backend=tree-sitter
- [ ] Implement TreeSitterSyntaxNode
- [ ] Implement TreeSitterAdapter (full + incremental)
- [ ] Cross-backend conformance tests

### Phase 4: Grammar Extensions
- [ ] Extend grammar parser (precedence blocks, external tokens, conflicts, specialize/extend, local tokens)
- [ ] Extend Grammar AST types
- [ ] Implement translation per feature per backend
- [ ] Diagnostics for unsupported feature+backend combos

### Phase 5: Polish
- [ ] Performance benchmarks
- [ ] Migration guide
- [ ] Example project with all three backends
- [ ] Documentation

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
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/)
- [Chevrotain](https://chevrotain.io/docs/)
