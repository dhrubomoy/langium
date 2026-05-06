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
