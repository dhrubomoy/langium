/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { Location } from 'vscode-languageserver-types';
import type { Position, Range } from 'vscode-languageserver-types';
import type { TextDocumentPositionParams } from 'vscode-languageserver-protocol';
import type { DocumentIndex } from '../workspace/document-index.js';

/**
 * Language-specific service that resolves a Go-to-definition request against
 * a tree-sitter-driven {@link DocumentIndex}.
 *
 * Distinct from the Chevrotain-era {@link import('./definition-provider.js').DefinitionProvider},
 * which operates on `LangiumDocument` and CST nodes. The tree-sitter pipeline
 * does not yet flow through the standard `DocumentBuilder`, so this provider
 * works directly off the per-document index produced by the IndexBuilder.
 */
export interface TreeSitterDefinitionProvider {
    /**
     * Find the {@link Location} of the declaration that the cursor position
     * refers to, if any.
     *
     * The lookup walks `index.references` for a `ReferenceInfo` whose range
     * contains `params.position`; if found, the reference name is looked up
     * in `index.declarations` and the first matching declaration is returned
     * as a {@link Location}.
     *
     * Returns `null` when no reference covers the position, or when the
     * referenced name has no declaration in the index.
     */
    getDefinition(index: DocumentIndex, params: TextDocumentPositionParams): Location | null;
}

/**
 * Default {@link TreeSitterDefinitionProvider} implementation. Pure function
 * over {@link DocumentIndex}: no I/O, no document state.
 */
export class DefaultTreeSitterDefinitionProvider implements TreeSitterDefinitionProvider {

    getDefinition(index: DocumentIndex, params: TextDocumentPositionParams): Location | null {
        const position = params.position;
        for (const [name, refs] of index.references) {
            for (const ref of refs) {
                if (!rangeContains(ref.range, position)) {
                    continue;
                }
                const declarations = index.declarations.get(name);
                if (!declarations || declarations.length === 0) {
                    return null;
                }
                const target = declarations[0];
                return Location.create(target.uri.toString(), target.range);
            }
        }
        return null;
    }
}

function rangeContains(range: Range, position: Position): boolean {
    if (position.line < range.start.line || position.line > range.end.line) {
        return false;
    }
    if (position.line === range.start.line && position.character < range.start.character) {
        return false;
    }
    if (position.line === range.end.line && position.character > range.end.character) {
        return false;
    }
    return true;
}
