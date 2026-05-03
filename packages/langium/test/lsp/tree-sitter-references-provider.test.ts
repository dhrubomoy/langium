/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import type { Range } from 'vscode-languageserver-types';
import type { ReferenceParams } from 'vscode-languageserver-protocol';
import { DefaultTreeSitterReferencesProvider } from 'langium/lsp';
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

function params(line: number, character: number, includeDeclaration = false): ReferenceParams {
    return {
        textDocument: { uri: TEST_URI },
        position: { line, character },
        context: { includeDeclaration }
    };
}

describe('DefaultTreeSitterReferencesProvider', () => {

    const provider = new DefaultTreeSitterReferencesProvider();

    test('returns two Locations when a name has two references and the cursor is on the declaration', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        const refA = ref('foo', 3, 10, 13);
        const refB = ref('foo', 5, 0, 3);
        index.references.set('foo', [refA, refB]);
        const result = provider.findReferences(index, params(0, 5));
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ uri: TEST_URI, range: refA.range });
        expect(result[1]).toEqual({ uri: TEST_URI, range: refB.range });
    });

    test('returns all references when the cursor is on one of the references', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        const refA = ref('foo', 3, 10, 13);
        const refB = ref('foo', 5, 0, 3);
        index.references.set('foo', [refA, refB]);
        const result = provider.findReferences(index, params(3, 11));
        expect(result).toHaveLength(2);
        expect(result.map(r => r.range)).toEqual([refA.range, refB.range]);
    });

    test('includes the declaration Location when includeDeclaration is true', () => {
        const index = emptyIndex();
        const declaration = decl('foo', 0, 4, 7);
        index.declarations.set('foo', [declaration]);
        const refA = ref('foo', 3, 10, 13);
        index.references.set('foo', [refA]);
        const result = provider.findReferences(index, params(0, 5, true));
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ uri: TEST_URI, range: declaration.range });
        expect(result[1]).toEqual({ uri: TEST_URI, range: refA.range });
    });

    test('omits the declaration Location when includeDeclaration is false', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const result = provider.findReferences(index, params(0, 5, false));
        expect(result).toHaveLength(1);
        expect(result[0].range).toEqual(range(3, 10, 13));
    });

    test('returns an empty array when no symbol covers the cursor position', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const result = provider.findReferences(index, params(9, 0));
        expect(result).toEqual([]);
    });

    test('returns an empty array when the index is empty', () => {
        const result = provider.findReferences(emptyIndex(), params(0, 0));
        expect(result).toEqual([]);
    });

    test('returns only references for the matched name (does not leak other names)', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.declarations.set('bar', [decl('bar', 1, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 0, 3)]);
        index.references.set('bar', [ref('bar', 4, 0, 3)]);
        const result = provider.findReferences(index, params(0, 5));
        expect(result).toHaveLength(1);
        expect(result[0].range).toEqual(range(3, 0, 3));
    });

    test('returns an empty array when the matched name has no references and includeDeclaration is false', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        const result = provider.findReferences(index, params(0, 5, false));
        expect(result).toEqual([]);
    });

    test('returns just the declaration when there are no references but includeDeclaration is true', () => {
        const index = emptyIndex();
        const declaration = decl('foo', 0, 4, 7);
        index.declarations.set('foo', [declaration]);
        const result = provider.findReferences(index, params(0, 5, true));
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ uri: TEST_URI, range: declaration.range });
    });

    test('uses params.textDocument.uri for reference Locations', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const customParams: ReferenceParams = {
            textDocument: { uri: 'file:///other.arith' },
            position: { line: 0, character: 5 },
            context: { includeDeclaration: false }
        };
        const result = provider.findReferences(index, customParams);
        expect(result).toHaveLength(1);
        expect(result[0].uri).toBe('file:///other.arith');
    });

    test('returns multiple declaration Locations when more than one declaration shares a name', () => {
        const index = emptyIndex();
        const first = decl('foo', 0, 4, 7);
        const second = decl('foo', 5, 4, 7);
        index.declarations.set('foo', [first, second]);
        index.references.set('foo', [ref('foo', 9, 0, 3)]);
        const result = provider.findReferences(index, params(9, 1, true));
        expect(result).toHaveLength(3);
        expect(result[0].range).toEqual(first.range);
        expect(result[1].range).toEqual(second.range);
        expect(result[2].range).toEqual(range(9, 0, 3));
    });

    test('reference position match is inclusive on both ends', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        const r = ref('foo', 3, 10, 13);
        index.references.set('foo', [r]);
        const start = provider.findReferences(index, params(3, 10));
        const end = provider.findReferences(index, params(3, 13));
        expect(start).toHaveLength(1);
        expect(end).toHaveLength(1);
    });

    test('declaration position match is inclusive on both ends', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const start = provider.findReferences(index, params(0, 4));
        const end = provider.findReferences(index, params(0, 7));
        expect(start).toHaveLength(1);
        expect(end).toHaveLength(1);
    });
});
