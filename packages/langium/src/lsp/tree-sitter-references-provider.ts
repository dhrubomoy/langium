/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { Location } from 'vscode-languageserver-types';
import type { Position, Range } from 'vscode-languageserver-types';
import type { ReferenceParams } from 'vscode-languageserver-protocol';
import type { DocumentIndex } from '../workspace/document-index.js';

/**
 * Language-specific service that resolves a Find-all-references request against
 * a tree-sitter-driven {@link DocumentIndex}.
 *
 * Distinct from the Chevrotain-era {@link import('./references-provider.js').ReferencesProvider},
 * which operates on `LangiumDocument` and CST nodes. The tree-sitter pipeline
 * does not yet flow through the standard `DocumentBuilder`, so this provider
 * works directly off the per-document index produced by the IndexBuilder.
 */
export interface TreeSitterReferencesProvider {
    /**
     * Find every {@link Location} that references the symbol named at
     * `params.position`.
     *
     * The lookup determines the symbol name by checking, at the position,
     * first the entries in `index.references` and then those in
     * `index.declarations`. Once a name is identified, every entry in
     * `index.references` for that name is returned as a {@link Location}.
     * When `params.context.includeDeclaration` is `true`, all matching
     * declarations are also included.
     *
     * Returns an empty array when no symbol is at the position.
     */
    findReferences(index: DocumentIndex, params: ReferenceParams): Location[];
}

/**
 * Default {@link TreeSitterReferencesProvider} implementation. Pure function
 * over {@link DocumentIndex}: no I/O, no document state.
 */
export class DefaultTreeSitterReferencesProvider implements TreeSitterReferencesProvider {

    findReferences(index: DocumentIndex, params: ReferenceParams): Location[] {
        const name = this.findNameAtPosition(index, params.position);
        if (name === undefined) {
            return [];
        }
        const documentUri = params.textDocument.uri;
        const result: Location[] = [];
        if (params.context?.includeDeclaration) {
            const declarations = index.declarations.get(name);
            if (declarations) {
                for (const decl of declarations) {
                    result.push(Location.create(decl.uri.toString(), decl.range));
                }
            }
        }
        const references = index.references.get(name);
        if (references) {
            for (const reference of references) {
                result.push(Location.create(documentUri, reference.range));
            }
        }
        return result;
    }

    protected findNameAtPosition(index: DocumentIndex, position: Position): string | undefined {
        for (const [name, refs] of index.references) {
            for (const reference of refs) {
                if (rangeContains(reference.range, position)) {
                    return name;
                }
            }
        }
        for (const [name, decls] of index.declarations) {
            for (const declaration of decls) {
                if (rangeContains(declaration.range, position)) {
                    return name;
                }
            }
        }
        return undefined;
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
