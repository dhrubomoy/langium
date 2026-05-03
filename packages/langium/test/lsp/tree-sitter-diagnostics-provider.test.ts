/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Diagnostic } from 'vscode-languageserver-types';
import { DefaultParseErrorDiagnosticsProvider } from 'langium/lsp';
import type { DocumentIndex } from 'langium';

function emptyIndex(diagnostics: Diagnostic[] = []): DocumentIndex {
    return {
        declarations: new Map(),
        references: new Map(),
        diagnostics
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
