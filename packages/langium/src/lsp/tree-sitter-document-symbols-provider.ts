/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { SymbolKind } from 'vscode-languageserver-types';
import type { DocumentSymbol } from 'vscode-languageserver-types';
import type { DocumentIndex } from '../workspace/document-index.js';

/**
 * Language-specific service that produces a Document Symbols outline from a
 * tree-sitter-driven {@link DocumentIndex}.
 *
 * Distinct from the Chevrotain-era {@link import('./document-symbol-provider.js').DocumentSymbolProvider},
 * which walks a `LangiumDocument` AST. The tree-sitter pipeline does not yet
 * flow through the standard `DocumentBuilder`, so this provider works directly
 * off the per-document index produced by the IndexBuilder.
 */
export interface TreeSitterDocumentSymbolsProvider {
    /**
     * Build a flat list of {@link DocumentSymbol}s, one entry per
     * {@link import('../workspace/document-index.js').DeclarationInfo} found
     * in `index.declarations`. Every symbol gets the default
     * {@link SymbolKind.Variable}; both `range` and `selectionRange` are set
     * to the declaration's name range (the index does not retain the wider
     * declaration body range).
     */
    getSymbols(index: DocumentIndex): DocumentSymbol[];
}

/**
 * Default {@link TreeSitterDocumentSymbolsProvider} implementation. Pure
 * function over {@link DocumentIndex}: no I/O, no document state.
 */
export class DefaultTreeSitterDocumentSymbolsProvider implements TreeSitterDocumentSymbolsProvider {

    getSymbols(index: DocumentIndex): DocumentSymbol[] {
        const result: DocumentSymbol[] = [];
        for (const declarations of index.declarations.values()) {
            for (const declaration of declarations) {
                result.push({
                    name: declaration.name,
                    kind: SymbolKind.Variable,
                    range: declaration.range,
                    selectionRange: declaration.range
                });
            }
        }
        return result;
    }
}
