/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import type { Range } from 'vscode-languageserver-types';
import type { TextDocumentPositionParams } from 'vscode-languageserver-protocol';
import { DefaultTreeSitterDefinitionProvider } from 'langium/lsp';
import { URI } from 'langium';
import type { DeclarationInfo, DocumentIndex, ReferenceInfo } from 'langium';

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

function ref(name: string, line: number, startChar: number, endChar?: number): ReferenceInfo {
    return {
        name,
        range: range(line, startChar, endChar ?? startChar + name.length)
    };
}

function params(line: number, character: number): TextDocumentPositionParams {
    return {
        textDocument: { uri: TEST_URI },
        position: { line, character }
    };
}

describe('DefaultTreeSitterDefinitionProvider', () => {

    const provider = new DefaultTreeSitterDefinitionProvider();

    test('returns the declaration Location for a reference covering the position', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const result = provider.getDefinition(index, params(3, 11));
        expect(result).not.toBeNull();
        expect(result!.uri).toBe(TEST_URI);
        expect(result!.range).toEqual(range(0, 4, 7));
    });

    test('matches a position at the inclusive start of the reference range', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const result = provider.getDefinition(index, params(3, 10));
        expect(result).not.toBeNull();
        expect(result!.range).toEqual(range(0, 4, 7));
    });

    test('matches a position at the inclusive end of the reference range', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const result = provider.getDefinition(index, params(3, 13));
        expect(result).not.toBeNull();
        expect(result!.range).toEqual(range(0, 4, 7));
    });

    test('returns null when no reference covers the position', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const result = provider.getDefinition(index, params(3, 0));
        expect(result).toBeNull();
    });

    test('returns null when a reference covers the position but no declaration matches', () => {
        const index = emptyIndex();
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const result = provider.getDefinition(index, params(3, 11));
        expect(result).toBeNull();
    });

    test('returns null when the index is empty', () => {
        const result = provider.getDefinition(emptyIndex(), params(0, 0));
        expect(result).toBeNull();
    });

    test('returns the matching declaration when multiple references share the position line', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.declarations.set('bar', [decl('bar', 1, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 0, 3)]);
        index.references.set('bar', [ref('bar', 3, 8, 11)]);
        const result = provider.getDefinition(index, params(3, 9));
        expect(result).not.toBeNull();
        expect(result!.range).toEqual(range(1, 4, 7));
    });

    test('returns the first declaration when more than one declaration shares the name', () => {
        const index = emptyIndex();
        const first = decl('foo', 0, 4, 7);
        const second = decl('foo', 5, 4, 7);
        index.declarations.set('foo', [first, second]);
        index.references.set('foo', [ref('foo', 9, 0, 3)]);
        const result = provider.getDefinition(index, params(9, 1));
        expect(result).not.toBeNull();
        expect(result!.range).toEqual(first.range);
    });

    test('handles multi-line reference ranges', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        const multilineRef: ReferenceInfo = {
            name: 'foo',
            range: { start: { line: 2, character: 5 }, end: { line: 4, character: 2 } }
        };
        index.references.set('foo', [multilineRef]);
        const result = provider.getDefinition(index, params(3, 0));
        expect(result).not.toBeNull();
        expect(result!.range).toEqual(range(0, 4, 7));
    });

    test('returns null when the position lies just before the reference start on the same line', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const result = provider.getDefinition(index, params(3, 9));
        expect(result).toBeNull();
    });
});
