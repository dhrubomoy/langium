/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { DiagnosticSeverity } from 'vscode-languageserver-types';
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

/**
 * Language-specific service that produces LSP {@link Diagnostic} entries
 * for unresolved cross-references in a tree-sitter-driven {@link DocumentIndex}.
 *
 * For each {@link ReferenceInfo} in `index.references`, the provider checks
 * whether a {@link DeclarationInfo} with the same name exists in
 * `index.declarations`. If not, an error-severity diagnostic is emitted at
 * the reference's range.
 *
 * The provider does **not** push into `index.diagnostics` — that field is
 * owned by the IndexBuilder. Top-level adapters concatenate the parse-error
 * diagnostics with the cross-reference diagnostics returned here.
 */
export interface CrossRefDiagnosticsProvider {
    /**
     * Return diagnostics for unresolved cross-references in the given index.
     */
    getDiagnostics(index: DocumentIndex): Diagnostic[];
}

/**
 * Default {@link CrossRefDiagnosticsProvider} implementation. Emits one
 * `Unresolved reference: <name>` error per reference whose name has no
 * matching declaration entry in the same document index.
 */
export class DefaultCrossRefDiagnosticsProvider implements CrossRefDiagnosticsProvider {

    getDiagnostics(index: DocumentIndex): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        for (const [name, refs] of index.references) {
            if (index.declarations.has(name)) {
                continue;
            }
            for (const ref of refs) {
                diagnostics.push({
                    range: ref.range,
                    severity: DiagnosticSeverity.Error,
                    message: `Unresolved reference: ${name}`
                });
            }
        }
        return diagnostics;
    }
}
