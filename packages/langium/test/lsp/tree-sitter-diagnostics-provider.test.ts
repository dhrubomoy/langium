/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Diagnostic, Range } from 'vscode-languageserver-types';
import { DefaultCrossRefDiagnosticsProvider, DefaultParseErrorDiagnosticsProvider } from 'langium/lsp';
import { URI } from 'langium';
import type { DeclarationInfo, DocumentIndex, ReferenceInfo } from 'langium';

function emptyIndex(diagnostics: Diagnostic[] = []): DocumentIndex {
    return {
        declarations: new Map(),
        references: new Map(),
        diagnostics
    };
}

function range(line: number, startChar: number, endChar: number): Range {
    return { start: { line, character: startChar }, end: { line, character: endChar } };
}

function decl(name: string, line = 0, startChar = 0, endChar = 0): DeclarationInfo {
    return {
        name,
        nodeType: 'Definition',
        range: range(line, startChar, endChar || startChar + name.length),
        uri: URI.parse('file:///test.arith')
    };
}

function ref(name: string, line: number, startChar: number, endChar?: number): ReferenceInfo {
    return {
        name,
        range: range(line, startChar, endChar ?? startChar + name.length)
    };
}

describe('DefaultParseErrorDiagnosticsProvider', () => {

    const provider = new DefaultParseErrorDiagnosticsProvider();

    test('returns the single diagnostic from the index unchanged', () => {
        const diagnostic: Diagnostic = {
            range: { start: { line: 2, character: 4 }, end: { line: 2, character: 5 } },
            severity: DiagnosticSeverity.Error,
            message: 'Syntax error at 2:4'
        };
        const result = provider.getDiagnostics(emptyIndex([diagnostic]));
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(diagnostic);
    });

    test('returns all diagnostics in the same order they were collected', () => {
        const first: Diagnostic = {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: DiagnosticSeverity.Error,
            message: 'Syntax error at 0:0'
        };
        const second: Diagnostic = {
            range: { start: { line: 1, character: 5 }, end: { line: 1, character: 6 } },
            severity: DiagnosticSeverity.Error,
            message: 'Syntax error at 1:5'
        };
        const result = provider.getDiagnostics(emptyIndex([first, second]));
        expect(result).toHaveLength(2);
        expect(result[0]).toBe(first);
        expect(result[1]).toBe(second);
    });

    test('returns an empty array when the index has no diagnostics', () => {
        const result = provider.getDiagnostics(emptyIndex());
        expect(result).toEqual([]);
    });
});

describe('DefaultCrossRefDiagnosticsProvider', () => {

    const provider = new DefaultCrossRefDiagnosticsProvider();

    test('emits one error diagnostic for an unresolved reference', () => {
        const index = emptyIndex();
        index.references.set('foo', [ref('foo', 3, 10)]);
        const result = provider.getDiagnostics(index);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            range: range(3, 10, 13),
            severity: DiagnosticSeverity.Error,
            message: 'Unresolved reference: foo'
        });
    });

    test('emits no diagnostics when the reference resolves to a declaration', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo')]);
        index.references.set('foo', [ref('foo', 3, 10)]);
        const result = provider.getDiagnostics(index);
        expect(result).toEqual([]);
    });

    test('emits one diagnostic per occurrence of an unresolved name', () => {
        const index = emptyIndex();
        index.references.set('bar', [ref('bar', 1, 0), ref('bar', 2, 4)]);
        const result = provider.getDiagnostics(index);
        expect(result).toHaveLength(2);
        expect(result.every(d => d.message === 'Unresolved reference: bar')).toBe(true);
        expect(result.every(d => d.severity === DiagnosticSeverity.Error)).toBe(true);
    });

    test('separates resolved from unresolved references in the same index', () => {
        const index = emptyIndex();
        index.declarations.set('foo', [decl('foo')]);
        index.references.set('foo', [ref('foo', 1, 0)]);
        index.references.set('baz', [ref('baz', 2, 0)]);
        const result = provider.getDiagnostics(index);
        expect(result).toHaveLength(1);
        expect(result[0].message).toBe('Unresolved reference: baz');
    });

    test('returns an empty array when the index has no references', () => {
        const result = provider.getDiagnostics(emptyIndex());
        expect(result).toEqual([]);
    });

    test('does not push into index.diagnostics', () => {
        const index = emptyIndex();
        index.references.set('foo', [ref('foo', 0, 0)]);
        provider.getDiagnostics(index);
        expect(index.diagnostics).toEqual([]);
    });
});
