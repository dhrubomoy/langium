/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import type { Range, TextEdit, WorkspaceEdit } from 'vscode-languageserver-types';
import type { RenameParams } from 'vscode-languageserver-protocol';
import { DefaultTreeSitterRenameProvider } from 'langium/lsp';
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

function decl(name: string, line = 0, startChar = 0, endChar?: number, uri = TEST_URI): DeclarationInfo {
    return {
        name,
        nodeType: 'Definition',
        range: range(line, startChar, endChar ?? startChar + name.length),
        uri: URI.parse(uri)
    };
}

function ref(name: string, line: number, startChar: number, endChar?: number): ReferenceInfo {
    return {
        name,
        range: range(line, startChar, endChar ?? startChar + name.length)
    };
}

function params(line: number, character: number, newName: string): RenameParams {
    return {
        textDocument: { uri: TEST_URI },
        position: { line, character },
        newName
    };
}

function editsFor(result: WorkspaceEdit, uri = TEST_URI): TextEdit[] {
    return result.changes?.[uri] ?? [];
}

describe('DefaultTreeSitterRenameProvider', () => {

    const provider = new DefaultTreeSitterRenameProvider();

    test('returns three edits for one declaration plus two references when cursor is on the declaration', () => {
        const index = emptyIndex();
        const declaration = decl('foo', 0, 4, 7);
        index.declarations.set('foo', [declaration]);
        const refA = ref('foo', 3, 10, 13);
        const refB = ref('foo', 5, 0, 3);
        index.references.set('foo', [refA, refB]);
        const result = provider.rename(index, params(0, 5, 'bar'));
        expect(result).not.toBeNull();
        const edits = editsFor(result!);
        expect(edits).toHaveLength(3);
        expect(edits[0]).toEqual({ range: declaration.range, newText: 'bar' });
        expect(edits[1]).toEqual({ range: refA.range, newText: 'bar' });
        expect(edits[2]).toEqual({ range: refB.range, newText: 'bar' });
    });

    test('returns three edits when cursor is on a reference', () => {
        const index = emptyIndex();
        const declaration = decl('foo', 0, 4, 7);
        index.declarations.set('foo', [declaration]);
        const refA = ref('foo', 3, 10, 13);
        const refB = ref('foo', 5, 0, 3);
        index.references.set('foo', [refA, refB]);
        const result = provider.rename(index, params(3, 11, 'bar'));
        expect(result).not.toBeNull();
        const edits = editsFor(result!);
        expect(edits).toHaveLength(3);
        expect(edits.map(e => e.range)).toEqual([declaration.range, refA.range, refB.range]);
        expect(edits.every(e => e.newText === 'bar')).toBe(true);
    });

    test('returns null when no symbol covers the cursor position', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const result = provider.rename(index, params(9, 0, 'bar'));
        expect(result).toBeNull();
    });

    test('returns null for an empty index', () => {
        const result = provider.rename(emptyIndex(), params(0, 0, 'bar'));
        expect(result).toBeNull();
    });

    test('returns only edits for the matched name and does not leak others', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.declarations.set('bar', [decl('bar', 1, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 0, 3)]);
        index.references.set('bar', [ref('bar', 4, 0, 3)]);
        const result = provider.rename(index, params(0, 5, 'baz'));
        const edits = editsFor(result!);
        expect(edits).toHaveLength(2);
        expect(edits[0].range).toEqual(range(0, 4, 7));
        expect(edits[1].range).toEqual(range(3, 0, 3));
    });

    test('renames a declaration with no references', () => {
        const index = emptyIndex();
        const declaration = decl('foo', 0, 4, 7);
        index.declarations.set('foo', [declaration]);
        const result = provider.rename(index, params(0, 5, 'bar'));
        const edits = editsFor(result!);
        expect(edits).toHaveLength(1);
        expect(edits[0]).toEqual({ range: declaration.range, newText: 'bar' });
    });

    test('renames every declaration when more than one shares the same name', () => {
        const index = emptyIndex();
        const first = decl('foo', 0, 4, 7);
        const second = decl('foo', 5, 4, 7);
        index.declarations.set('foo', [first, second]);
        index.references.set('foo', [ref('foo', 9, 0, 3)]);
        const result = provider.rename(index, params(9, 1, 'bar'));
        const edits = editsFor(result!);
        expect(edits).toHaveLength(3);
        expect(edits[0].range).toEqual(first.range);
        expect(edits[1].range).toEqual(second.range);
        expect(edits[2].range).toEqual(range(9, 0, 3));
    });

    test('reference position match is inclusive on both ends', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        const r = ref('foo', 3, 10, 13);
        index.references.set('foo', [r]);
        const startResult = provider.rename(index, params(3, 10, 'bar'));
        const endResult = provider.rename(index, params(3, 13, 'bar'));
        expect(editsFor(startResult!)).toHaveLength(2);
        expect(editsFor(endResult!)).toHaveLength(2);
    });

    test('declaration position match is inclusive on both ends', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const startResult = provider.rename(index, params(0, 4, 'bar'));
        const endResult = provider.rename(index, params(0, 7, 'bar'));
        expect(editsFor(startResult!)).toHaveLength(2);
        expect(editsFor(endResult!)).toHaveLength(2);
    });

    test('uses params.textDocument.uri as the change-map key for reference edits', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const customParams: RenameParams = {
            textDocument: { uri: 'file:///other.arith' },
            position: { line: 0, character: 5 },
            newName: 'bar'
        };
        const result = provider.rename(index, customParams);
        expect(result).not.toBeNull();
        const sameDocEdits = editsFor(result!, TEST_URI);
        const otherDocEdits = editsFor(result!, 'file:///other.arith');
        expect(sameDocEdits).toHaveLength(1);
        expect(sameDocEdits[0].range).toEqual(range(0, 4, 7));
        expect(otherDocEdits).toHaveLength(1);
        expect(otherDocEdits[0].range).toEqual(range(3, 10, 13));
    });

    test('groups declaration and reference edits under their respective URIs', () => {
        const otherUri = 'file:///other.arith';
        const index = emptyIndex();
        const declaration = decl('foo', 0, 4, 7, otherUri);
        index.declarations.set('foo', [declaration]);
        index.references.set('foo', [ref('foo', 3, 10, 13)]);
        const result = provider.rename(index, params(3, 11, 'bar'));
        expect(result).not.toBeNull();
        expect(editsFor(result!, otherUri)).toHaveLength(1);
        expect(editsFor(result!, otherUri)[0].range).toEqual(declaration.range);
        expect(editsFor(result!, TEST_URI)).toHaveLength(1);
        expect(editsFor(result!, TEST_URI)[0].range).toEqual(range(3, 10, 13));
    });

    test('newName is propagated to every TextEdit', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo', 0, 4, 7)]);
        index.references.set('foo', [ref('foo', 3, 10, 13), ref('foo', 5, 0, 3)]);
        const result = provider.rename(index, params(0, 5, 'renamed_id'));
        const edits = editsFor(result!);
        expect(edits.map(e => e.newText)).toEqual(['renamed_id', 'renamed_id', 'renamed_id']);
    });
});
