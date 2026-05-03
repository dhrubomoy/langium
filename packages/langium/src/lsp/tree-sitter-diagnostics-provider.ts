/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Diagnostic } from 'vscode-languageserver-types';
import type { DocumentIndex } from '../workspace/document-index.js';

/**
 * Language-specific service that produces LSP {@link Diagnostic} entries
 * derived from a tree-sitter-driven {@link DocumentIndex}.
 *
 * The provider is intentionally a thin pass-through: the {@link DocumentIndex}
 * already carries the parse-error diagnostics produced by the IndexBuilder
 * (ERROR / MISSING tree-sitter nodes). LSP adapters call this provider rather
 * than reading `index.diagnostics` directly so that future filtering or
 * grouping logic has a single place to live.
 */
export interface ParseErrorDiagnosticsProvider {
    /**
     * Return the parse-error diagnostics for a single document, given that
     * document's {@link DocumentIndex}.
     */
    getDiagnostics(index: DocumentIndex): Diagnostic[];
}

/**
 * Default {@link ParseErrorDiagnosticsProvider} implementation. Returns the
 * diagnostics produced by the IndexBuilder verbatim.
 */
export class DefaultParseErrorDiagnosticsProvider implements ParseErrorDiagnosticsProvider {

    getDiagnostics(index: DocumentIndex): Diagnostic[] {
        return index.diagnostics;
    }
}
