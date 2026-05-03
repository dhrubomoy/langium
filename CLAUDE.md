# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install          # Install all workspace dependencies
npm run build        # Full build: tsc + all workspace builds
npm run watch        # Watch mode for all packages (tsc + workspace vite builds)
npm run watch:tsc    # Watch just TypeScript compilation
npm run clean        # Remove all build artifacts
npm run lint         # Run ESLint across the entire monorepo
npm run lint:fix     # Run ESLint with auto-fix
npm test             # Run all tests via vitest
npm run test:watch   # Vitest in watch mode
npm run coverage     # Generate coverage report
npm run langium:generate  # Regenerate code from .langium grammar files
```

Run a single test file:
```sh
npx vitest run packages/langium/test/grammar/grammar-util.test.ts
```

For developing Langium packages locally alongside a consumer project:
```sh
npm run dev-build    # Links all packages globally via npm link
npm run dev-clean    # Unlinks and cleans up
```

## Architecture

### Monorepo Structure

This is an npm workspaces project. Core packages under `packages/`:

- **`langium`** — Core runtime library. Parser, scoping, linking, validation, workspace management, LSP, code generation utilities.
- **`langium-cli`** — CLI tool (`langium generate`) that compiles `.langium` grammar files into TypeScript AST types, modules, and reflection objects.
- **`langium-vscode`** — VSCode extension providing language support for `.langium` files.
- **`langium-railroad`** — Generates railroad syntax diagrams from grammars.
- **`langium-sprotty`** — Sprotty diagram integration for Langium languages.
- **`generator-langium`** — Yeoman generator for scaffolding new Langium language projects.

Examples are in `examples/` (arithmetics, domainmodel, statemachine, requirements).

### Dependency Injection

Langium uses a custom, type-safe DI system (not InversifyJS). Key concepts:

- **`Module<I, T>`** (`dependency-injection.ts`) — A descriptor whose leaf values are factory functions `(injector: I) => T[K]`. Modules can be merged with `Module.merge()`.
- **`inject(...modules)`** — Creates a lazily-evaluated service container. Services are instantiated on first access and cached. Cyclic dependencies throw unless broken with a provider function `() => T`.
- **`eagerLoad(container)`** — Forces eager instantiation (used for services that register event listeners in constructors).

Each language has its own service container, which includes a reference to the shared container. Customization works by merging an override module on top of the default one.

### Service Groups

Defined in `packages/langium/src/services.ts`:

- **`LangiumCoreServices`** (per-language): `parser`, `documentation`, `references`, `serializer`, `validation`, `workspace` (node locator, descriptions).
- **`LangiumSharedCoreServices`** (shared across all languages): `workspace` (DocumentBuilder, WorkspaceManager, IndexManager, LangiumDocuments), `AstReflection`, `ServiceRegistry`.
- **`LangiumLSPServices`** — Optional LSP layer added on top of core services; all providers (completion, hover, references, formatting, etc.) live here.

Default implementations live in `default-module.ts` and `lsp/default-lsp-module.ts`.

### Document Lifecycle

Documents progress through ordered states (`DocumentState` enum in `workspace/documents.ts`):

1. **`Changed`** — File changed, not yet processed.
2. **`Parsed`** — CST and AST built by the Chevrotain-powered parser.
3. **`ComputedScopes`** — Local scope tree computed by `ScopeComputation`.
4. **`Linked`** — Cross-references resolved by `Linker` using `ScopeProvider` + `IndexManager`.
5. **`Indexed`** — Exported symbol descriptions written to `IndexManager`.
6. **`Validated`** — All `ValidationRegistry` checks run.

`DocumentBuilder` (shared service) orchestrates this pipeline. It is cancellation-aware and handles incremental rebuilds.

### Scoping and Linking

- **`ScopeComputation`** — Computes local scopes (what names a node exports to its parent, and what names are visible within it). Called in the `ComputedScopes` phase.
- **`ScopeProvider`** — Given a `ReferenceInfo`, returns a `Scope` (an iterable of `AstNodeDescription`). The default implementation walks the scope tree, then falls back to the global index.
- **`IndexManager`** — Shared cross-document index of exported symbol descriptions. Queried during linking and completion.
- **`Linker`** — Resolves `Reference<T>` objects lazily (first access) using `ScopeProvider`.

### Grammar Files and Code Generation

Grammars are written in `.langium` files. `langium-cli generate` reads them (configured via `langium-config.json` or the `langium` key in `package.json`) and produces:

- `src/languages/generated/ast.ts` — TypeScript interfaces for every grammar rule, plus `AstReflection`.
- `src/languages/generated/grammar.ts` — Serialized grammar object (embedded at runtime).
- `src/languages/generated/module.ts` — DI module wiring the generated parser and reflection.

**Never edit generated files manually.** Re-run `npm run langium:generate` after changing a `.langium` file. Langium's own grammar files are at `packages/langium/src/grammar/langium-grammar.langium` and `langium-types.langium`.

### Code Generation API (`langium/generate`)

For building code generators on top of Langium, the `langium/generate` entry point provides a tree-based approach:

- `expandToNode` / `expandToString` — Template-literal helpers that handle indentation and whitespace normalization.
- `joinToNode` — Joins an iterable of generated nodes with separators.
- `CompositeGeneratorNode` / `NL` / `BLOCK_OPEN` / `BLOCK_CLOSE` — Primitives for building a source tree before serializing to string.

### Export Entry Points

The `langium` package uses multiple conditional exports; import from the appropriate entry:

| Import path | Contents |
|---|---|
| `langium` | Core types and services |
| `langium/generate` | Code generation utilities |
| `langium/grammar` | Grammar AST types, grammar services, type inference |
| `langium/lsp` | LSP service interfaces and providers |
| `langium/node` | Node.js file system provider, worker-thread async parser |
| `langium/test` | `parseHelper`, `expectError`, virtual file system for unit tests |

### Testing Patterns

Tests use Vitest. Grammar/language tests typically:

1. Call `createLangiumGrammarServices(EmptyFileSystem)` or create a language-specific service container.
2. Use `parseHelper<RootAstType>(services)` from `langium/test` to parse a string and get a typed `ParseResult`.
3. Assert on the AST, diagnostics, or resolved references.

`EmptyFileSystem` (from `langium/node`) provides a no-op file system suitable for in-memory tests. `VirtualFileSystem` is available in `langium/test` for tests that require file-based workspace behavior.

### ESLint and Headers

All source files must have the Eclipse copyright header (enforced by `eslint-plugin-header`). The header format is:
```
/******************************************************************************
 * Copyright YYYY TypeFox GmbH
 * ...
 ******************************************************************************/
```

The ESLint config (`eslint.config.mjs`) also enforces import ordering, unused imports, and stylistic rules via `@stylistic/eslint-plugin`.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the root. See `docs/agents/domain.md`.
