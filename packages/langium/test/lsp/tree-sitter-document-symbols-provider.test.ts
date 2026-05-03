/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { SymbolKind } from 'vscode-languageserver-types';
import type { Range } from 'vscode-languageserver-types';
import { DefaultTreeSitterDocumentSymbolsProvider } from 'langium/lsp';
import { URI } from 'langium';
import type { DeclarationInfo, DocumentIndex } from 'langium';

const TEST_URI = 'file:///test.arith';

function emptyIndex(): DocumentIndex {
    return {
        declarations: new Map(),
        references: new Map(),
        diagnostics: []
    };
}

function range(line: number, startChar: number, endChar: number): Range {
    return { start: { line, character: startChar }, end: { line, character: endChar } };
}

function decl(name: string, line = 0, startChar = 0, endChar?: number): DeclarationInfo {
    return {
        name,
        nodeType: 'Definition',
        range: range(line, startChar, endChar ?? startChar + name.length),
        uri: URI.parse(TEST_URI)
    };
}

describe('DefaultTreeSitterDocumentSymbolsProvider', () => {

    const provider = new DefaultTreeSitterDocumentSymbolsProvider();

    test('returns three DocumentSymbols when the index has three declarations', () => {
        const index = emptyIndex();
        index.declarations.set('a', [decl('a', 0, 4, 5)]);
        index.declarations.set('b', [decl('b', 1, 4, 5)]);
        index.declarations.set('c', [decl('c', 2, 4, 5)]);
        const result = provider.getSymbols(index);
        expect(result).toHaveLength(3);
        expect(result.map(s => s.name).sort()).toEqual(['a', 'b', 'c']);
    });

    test('returns an empty array when the index has no declarations', () => {
        const result = provider.getSymbols(emptyIndex());
        expect(result).toEqual([]);
    });

    test('default kind is SymbolKind.Variable', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        const [symbol] = provider.getSymbols(index);
        expect(symbol.kind).toBe(SymbolKind.Variable);
    });

    test('symbol name and range come from the DeclarationInfo', () => {
        const index = emptyIndex();
        const declaration = decl('foo', 2, 8, 11);
        index.declarations.set('foo', [declaration]);
        const [symbol] = provider.getSymbols(index);
        expect(symbol.name).toBe('foo');
        expect(symbol.range).toEqual(declaration.range);
    });

    test('selectionRange equals range when only the declaration name range is known', () => {
        const index = emptyIndex();
        const declaration = decl('foo', 2, 8, 11);
        index.declarations.set('foo', [declaration]);
        const [symbol] = provider.getSymbols(index);
        expect(symbol.selectionRange).toEqual(symbol.range);
    });

    test('emits one symbol per declaration when a name has more than one declaration', () => {
        const index = emptyIndex();
        const first = decl('foo', 0, 4, 7);
        const second = decl('foo', 5, 4, 7);
        index.declarations.set('foo', [first, second]);
        const result = provider.getSymbols(index);
        expect(result).toHaveLength(2);
        expect(result[0].range).toEqual(first.range);
        expect(result[1].range).toEqual(second.range);
        expect(result.every(s => s.name === 'foo')).toBe(true);
    });

    test('does not include references in the symbols list', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [{ name: 'foo', range: range(3, 10, 13) }]);
        index.references.set('bar', [{ name: 'bar', range: range(4, 10, 13) }]);
        const result = provider.getSymbols(index);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('foo');
    });

    test('iterates declarations in Map insertion order', () => {
        const index = emptyIndex();
        index.declarations.set('z', [decl('z', 9, 4, 5)]);
        index.declarations.set('a', [decl('a', 0, 4, 5)]);
        index.declarations.set('m', [decl('m', 5, 4, 5)]);
        const result = provider.getSymbols(index);
        expect(result.map(s => s.name)).toEqual(['z', 'a', 'm']);
    });
});
