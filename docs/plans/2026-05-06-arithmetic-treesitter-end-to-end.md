# Phase 1 Completion: Arithmetic Example End-to-End via Tree-Sitter

## Context

All PRD user stories (US-033–US-050) are done. The CLI generates `grammar.js`, `metadata.ts`, and `grammar.wasm` from `.langium` grammars. The runtime already has:

- `WasmLoader` + `DefaultTreeSitterDocumentParser` → `document.treeSitterTree`
- `DefaultIndexBuilder` → `document.documentIndex` (declarations + references + diagnostics)
- Seven tree-sitter LSP providers implemented and registered in `default-lsp-module.ts`
- Arithmetic `metadata.ts` and `grammar.wasm` committed; `ArithmeticsModule` wires `GrammarWasmPath` and `GrammarMetadataProvider`

**Two gaps remain:**

1. `main.ts` never calls `WasmLoader.init()` — so `document.treeSitterTree` and `document.documentIndex` are NEVER built in a real language server run.
2. `language-server.ts` dispatches all 6 LSP handlers only to Chevrotain-era providers — tree-sitter providers are never invoked.

**Goal:** Fix both gaps so that for the arithmetic example, all user-visible LSP behaviour (go-to-definition, find-references, document symbols, folding, rename, diagnostics) comes exclusively from tree-sitter. Other Langium-based languages continue to use Chevrotain unaffected.

**The key invariant:** once `WasmLoader.init()` has resolved, `document.documentIndex` is always set for arithmetic documents. So the tree-sitter branch in each handler is ALWAYS taken for arithmetic, and the Chevrotain fallback is NEVER reached.

---

## Files to Modify

| File | What changes |
|---|---|
| `examples/arithmetics/src/language-server/main.ts` | Call `WasmLoader.init()` before starting the language server |
| `packages/langium/src/lsp/language-server.ts` | Modify 6 handler functions to prefer tree-sitter when index/tree is set |
| `examples/arithmetics/test/arithmetics-treesitter.test.ts` | Expand with 5 end-to-end provider tests |

---

## Provider signatures (quick reference)

```typescript
// All take index or tree as first arg, params second
TreeSitterDefinitionProvider.getDefinition(index: DocumentIndex, params: TextDocumentPositionParams): Location | null
TreeSitterReferencesProvider.findReferences(index: DocumentIndex, params: ReferenceParams): Location[]
TreeSitterDocumentSymbolsProvider.getSymbols(index: DocumentIndex): DocumentSymbol[]
TreeSitterFoldingRangeProvider.getFoldingRanges(rootNode: SyntaxNode): FoldingRange[]   // NOT index — takes rootNode
TreeSitterRenameProvider.rename(index: DocumentIndex, params: RenameParams): WorkspaceEdit | null
ParseErrorDiagnosticsProvider.getDiagnostics(index: DocumentIndex): Diagnostic[]
CrossRefDiagnosticsProvider.getDiagnostics(index: DocumentIndex): Diagnostic[]
```

The arithmetic metadata has `PrimaryExpression.func` with `isRef: true` (function calls), so cross-references ARE indexed. `def b: a();` makes `a` a reference to the definition of `a`.

---

## Task 1: Initialize WasmLoader at language server startup

**File:** `examples/arithmetics/src/language-server/main.ts`

Without this, `wasmLoader.isInitialized()` is always `false` in the real language server, so `parseTreeSitter` is skipped, and `documentIndex` is never built.

- [ ] **Step 1: Replace the body of `main.ts`**

```typescript
/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';
import { createArithmeticsServices } from './arithmetics-module.js';

const connection = createConnection(ProposedFeatures.all);
const { shared, arithmetics } = createArithmeticsServices({ connection, ...NodeFileSystem });

arithmetics.parser.WasmLoader.init()
    .then(() => startLanguageServer(shared))
    .catch(err => {
        console.error('[arithmetics] Failed to initialize tree-sitter WASM:', err);
        process.exit(1);
    });
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc -p examples/arithmetics/tsconfig.src.json --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add examples/arithmetics/src/language-server/main.ts
git commit -m "feat: initialize tree-sitter WasmLoader before starting arithmetic language server"
```

---

## Task 2: Wire definition, references, symbols, and rename handlers

**File:** `packages/langium/src/lsp/language-server.ts`

The serviceCall lambdas inside `createRequestHandler` receive `services: LangiumCoreAndPartialLSPServices` (the per-language services) and `document: LangiumDocument`. Check `document.documentIndex` first; fall back to the Chevrotain provider only when index is absent (i.e., for non-tree-sitter languages).

- [ ] **Step 1: Update `addGotoDefinitionHandler` (line 423)**

```typescript
export function addGotoDefinitionHandler(connection: Connection, services: LangiumSharedServices, requiredState: ServiceRequirement = DocumentState.Linked): void {
    connection.onDefinition(createRequestHandler(
        (services, document, params, cancelToken) => {
            const index = document.documentIndex;
            if (index) {
                return services.lsp?.TreeSitterDefinitionProvider?.getDefinition(index, params) ?? undefined;
            }
            return services.lsp?.DefinitionProvider?.getDefinition(document, params, cancelToken);
        },
        services,
        requiredState
    ));
}
```

- [ ] **Step 2: Update `addFindReferencesHandler` (line 399)**

```typescript
export function addFindReferencesHandler(connection: Connection, services: LangiumSharedServices, requiredState: ServiceRequirement = WorkspaceState.IndexedReferences): void {
    connection.onReferences(createRequestHandler(
        (services, document, params, cancelToken) => {
            const index = document.documentIndex;
            if (index) {
                return services.lsp?.TreeSitterReferencesProvider?.findReferences(index, params) ?? undefined;
            }
            return services.lsp?.ReferencesProvider?.findReferences(document, params, cancelToken);
        },
        services,
        requiredState
    ));
}
```

- [ ] **Step 3: Update `addDocumentSymbolHandler` (line 415)**

```typescript
export function addDocumentSymbolHandler(connection: Connection, services: LangiumSharedServices, requiredState: ServiceRequirement = DocumentState.Parsed): void {
    connection.onDocumentSymbol(createRequestHandler(
        (services, document, params, cancelToken) => {
            const index = document.documentIndex;
            if (index) {
                return services.lsp?.TreeSitterDocumentSymbolsProvider?.getSymbols(index) ?? undefined;
            }
            return services.lsp?.DocumentSymbolProvider?.getSymbols(document, params, cancelToken);
        },
        services,
        requiredState
    ));
}
```

- [ ] **Step 4: Update `addRenameHandler` (line 497)**

Only `onRenameRequest` is redirected. `onPrepareRename` stays Chevrotain-only — both parsers run on arithmetic docs, so the Chevrotain CST is still valid for prepare.

```typescript
export function addRenameHandler(connection: Connection, services: LangiumSharedServices, requiredState: ServiceRequirement = WorkspaceState.IndexedReferences): void {
    connection.onRenameRequest(createRequestHandler(
        (services, document, params, cancelToken) => {
            const index = document.documentIndex;
            if (index) {
                return services.lsp?.TreeSitterRenameProvider?.rename(index, params) ?? undefined;
            }
            return services.lsp?.RenameProvider?.rename(document, params, cancelToken);
        },
        services,
        requiredState
    ));
    connection.onPrepareRename(createRequestHandler(
        (services, document, params, cancelToken) => services.lsp?.RenameProvider?.prepareRename(document, params, cancelToken),
        services,
        requiredState
    ));
}
```

- [ ] **Step 5: Run typecheck**

```bash
npx tsc -p packages/langium/tsconfig.json --noEmit
```
Expected: no output.

- [ ] **Step 6: Run tests**

```bash
npx vitest run packages/langium/test/lsp/
```
Expected: 17 test files, all passing (existing provider tests use mock DocumentIndex and are unaffected).

- [ ] **Step 7: Commit**

```bash
git add packages/langium/src/lsp/language-server.ts
git commit -m "feat: dispatch definition/references/symbols/rename to tree-sitter providers when documentIndex is set"
```

---

## Task 3: Wire folding ranges handler

**File:** `packages/langium/src/lsp/language-server.ts` (line 471)

Folding is different: `TreeSitterFoldingRangeProvider.getFoldingRanges` takes `tree.rootNode` (a `SyntaxNode`), not `DocumentIndex`. Check `document.treeSitterTree`.

- [ ] **Step 1: Update `addFoldingRangeHandler` (line 471)**

```typescript
export function addFoldingRangeHandler(connection: Connection, services: LangiumSharedServices, requiredState: ServiceRequirement = DocumentState.Parsed): void {
    connection.onFoldingRanges(createRequestHandler(
        (services, document, params, cancelToken) => {
            const tree = document.treeSitterTree;
            if (tree) {
                return services.lsp?.TreeSitterFoldingRangeProvider?.getFoldingRanges(tree.rootNode) ?? undefined;
            }
            return services.lsp?.FoldingRangeProvider?.getFoldingRanges(document, params, cancelToken);
        },
        services,
        requiredState
    ));
}
```

- [ ] **Step 2: Run typecheck and tests**

```bash
npx tsc -p packages/langium/tsconfig.json --noEmit && npx vitest run packages/langium/test/lsp/
```
Expected: clean typecheck, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/langium/src/lsp/language-server.ts
git commit -m "feat: dispatch folding ranges to tree-sitter provider when treeSitterTree is set"
```

---

## Task 4: Wire diagnostics handler

**File:** `packages/langium/src/lsp/language-server.ts` (line 369)

Diagnostics is event-driven, not request/response. Currently it hooks `DocumentState.Validated` and sends `document.diagnostics` (Chevrotain validators). When `documentIndex` is set, we send tree-sitter diagnostics (parse errors + cross-ref errors) instead.

Per-language services are obtained via `services.ServiceRegistry` — the pattern already used in `createRequestHandler`.

- [ ] **Step 1: Update `addDiagnosticsHandler` (line 369)**

```typescript
export function addDiagnosticsHandler(connection: Connection, services: LangiumSharedServices): void {
    const documentBuilder = services.workspace.DocumentBuilder;
    const serviceRegistry = services.ServiceRegistry;
    documentBuilder.onUpdate(async (_, deleted) => {
        for (const uri of deleted) {
            connection.sendDiagnostics({ uri: uri.toString(), diagnostics: [] });
        }
    });
    documentBuilder.onDocumentPhase(DocumentState.Validated, async (document) => {
        const index = document.documentIndex;
        if (index && serviceRegistry.hasServices(document.uri)) {
            const lang = serviceRegistry.getServices(document.uri);
            const parseErrors = lang.lsp?.ParseErrorDiagnosticsProvider?.getDiagnostics(index) ?? [];
            const crossRefErrors = lang.lsp?.CrossRefDiagnosticsProvider?.getDiagnostics(index) ?? [];
            connection.sendDiagnostics({
                uri: document.uri.toString(),
                diagnostics: [...parseErrors, ...crossRefErrors]
            });
        } else if (document.diagnostics) {
            connection.sendDiagnostics({
                uri: document.uri.toString(),
                diagnostics: document.diagnostics
            });
        }
    });
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc -p packages/langium/tsconfig.json --noEmit
```
Expected: no output.

- [ ] **Step 3: Run full langium test suite**

```bash
npx vitest run packages/langium
```
Expected: all tests pass (existing diagnostics tests use mock documents without `documentIndex`, so they hit the `else if` branch unchanged).

- [ ] **Step 4: Commit**

```bash
git add packages/langium/src/lsp/language-server.ts
git commit -m "feat: dispatch diagnostics to tree-sitter providers when documentIndex is set"
```

---

## Task 5: Integration tests for the arithmetic tree-sitter pipeline

**File:** `examples/arithmetics/test/arithmetics-treesitter.test.ts`

Add 5 tests verifying each provider produces results from a real parsed document.

Grammar note: `PrimaryExpression.func` (with `isRef: true` in metadata) is what indexes function-call cross-references. `def b: a();` creates a reference to `a`.

- [ ] **Step 1: Replace the file contents**

```typescript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { DefaultCrossRefDiagnosticsProvider } from 'langium/lsp';
import { describe, expect, test } from 'vitest';
import { createArithmeticsServices } from '../src/language-server/arithmetics-module.js';
import type { Module } from '../src/language-server/generated/ast.js';

describe('Arithmetics tree-sitter pipeline activation', () => {

    test('parsing a document populates document.documentIndex with declarations', async () => {
        const { arithmetics } = createArithmeticsServices(EmptyFileSystem);
        await arithmetics.parser.WasmLoader.init();
        const parse = parseHelper<Module>(arithmetics);
        const document = await parse('module sample\ndef a: 1;\ndef b: a + 2;');
        expect(document.treeSitterTree, 'tree-sitter parse should produce a Tree').toBeDefined();
        expect(document.documentIndex, 'document index should be populated').toBeDefined();
        expect(document.documentIndex!.declarations.size, 'at least one declaration should be indexed')
            .toBeGreaterThan(0);
    });

    test('TreeSitterDocumentSymbolsProvider returns a symbol per declaration', async () => {
        const { arithmetics } = createArithmeticsServices(EmptyFileSystem);
        await arithmetics.parser.WasmLoader.init();
        const parse = parseHelper<Module>(arithmetics);
        const document = await parse('module sample\ndef a: 1;\ndef b: a();');
        const index = document.documentIndex!;
        const provider = arithmetics.lsp.TreeSitterDocumentSymbolsProvider!;
        const symbols = provider.getSymbols(index);
        expect(symbols.length).toBeGreaterThan(0);
        expect(symbols.map(s => s.name)).toContain('a');
    });

    test('TreeSitterFoldingRangeProvider returns ranges spanning multiple lines', async () => {
        const { arithmetics } = createArithmeticsServices(EmptyFileSystem);
        await arithmetics.parser.WasmLoader.init();
        const parse = parseHelper<Module>(arithmetics);
        const document = await parse('module sample\ndef a: 1;\ndef b: a();');
        const tree = document.treeSitterTree!;
        const provider = arithmetics.lsp.TreeSitterFoldingRangeProvider!;
        const ranges = provider.getFoldingRanges(tree.rootNode);
        expect(ranges.length).toBeGreaterThan(0);
        expect(ranges[0].startLine).toBeLessThan(ranges[0].endLine);
    });

    test('TreeSitterDefinitionProvider resolves a function-call reference to its declaration', async () => {
        const { arithmetics } = createArithmeticsServices(EmptyFileSystem);
        await arithmetics.parser.WasmLoader.init();
        const parse = parseHelper<Module>(arithmetics);
        // 'a()' on line 2 — PrimaryExpression.func has isRef:true in metadata
        const document = await parse('module sample\ndef a: 1;\ndef b: a();');
        const index = document.documentIndex!;
        const firstRef = [...index.references.values()][0]?.[0];
        expect(firstRef, 'index should contain at least one cross-reference').toBeDefined();
        const provider = arithmetics.lsp.TreeSitterDefinitionProvider!;
        const location = provider.getDefinition(index, {
            textDocument: { uri: document.textDocument.uri },
            position: firstRef!.range.start
        });
        expect(location, 'go-to-definition should resolve to a location').not.toBeNull();
        expect(location!.uri).toBe(document.textDocument.uri);
    });

    test('CrossRefDiagnosticsProvider reports unresolved function-call reference', async () => {
        const { arithmetics } = createArithmeticsServices(EmptyFileSystem);
        await arithmetics.parser.WasmLoader.init();
        const parse = parseHelper<Module>(arithmetics);
        // undefined() is a function call to a definition that does not exist
        const document = await parse('module sample\ndef b: undefined();');
        const index = document.documentIndex!;
        const provider = new DefaultCrossRefDiagnosticsProvider();
        const diagnostics = provider.getDiagnostics(index);
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics[0].message).toContain('undefined');
    });

    test('ParseErrorDiagnosticsProvider returns no diagnostics for a valid document', async () => {
        const { arithmetics } = createArithmeticsServices(EmptyFileSystem);
        await arithmetics.parser.WasmLoader.init();
        const parse = parseHelper<Module>(arithmetics);
        const document = await parse('module sample\ndef a: 1;');
        const index = document.documentIndex!;
        const provider = arithmetics.lsp.ParseErrorDiagnosticsProvider!;
        expect(provider.getDiagnostics(index)).toHaveLength(0);
    });

});
```

- [ ] **Step 2: Run the new tests**

```bash
npx vitest run examples/arithmetics/test/arithmetics-treesitter.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 3: Run the full arithmetic test suite for regressions**

```bash
npx vitest run examples/arithmetics
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add examples/arithmetics/test/arithmetics-treesitter.test.ts
git commit -m "test: add end-to-end tree-sitter LSP provider tests for arithmetic example"
```

---

## Final Verification

```bash
# Typecheck
npx tsc -p packages/langium/tsconfig.json --noEmit
npx tsc -p examples/arithmetics/tsconfig.src.json --noEmit

# All tests
npx vitest run packages/langium
npx vitest run packages/langium-cli
npx vitest run examples/arithmetics
```

All pass. At this point, the arithmetic example is end-to-end on tree-sitter:
- `WasmLoader.init()` runs before the language server starts → `documentIndex` is always built for arithmetic docs
- Go-to-definition, find-references, document symbols, folding, rename → all dispatched to tree-sitter providers
- Diagnostics (parse errors + unresolved cross-references) → from tree-sitter index
- The Chevrotain fallback in each handler exists for other Langium languages but is never reached for arithmetic
