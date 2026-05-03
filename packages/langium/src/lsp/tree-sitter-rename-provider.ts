/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { TextEdit } from 'vscode-languageserver-types';
import type { Position, Range, WorkspaceEdit } from 'vscode-languageserver-types';
import type { RenameParams } from 'vscode-languageserver-protocol';
import type { DocumentIndex } from '../workspace/document-index.js';

/**
 * Language-specific service that resolves a Rename request against a
 * tree-sitter-driven {@link DocumentIndex}.
 *
 * Distinct from the Chevrotain-era {@link import('./rename-provider.js').RenameProvider},
 * which operates on `LangiumDocument` and CST nodes. The tree-sitter pipeline
 * does not yet flow through the standard `DocumentBuilder`, so this provider
 * works directly off the per-document index produced by the IndexBuilder.
 */
export interface TreeSitterRenameProvider {
    /**
     * Build a {@link WorkspaceEdit} that replaces every occurrence of the
     * symbol at `params.position` with `params.newName`.
     *
     * The lookup determines the symbol name by checking, at the position,
     * first the entries in `index.references` and then those in
     * `index.declarations`. Once a name is identified, every matching
     * {@link import('../workspace/document-index.js').DeclarationInfo} and
     * {@link import('../workspace/document-index.js').ReferenceInfo} is
     * mapped to a {@link TextEdit} that replaces its range with the new name.
     *
     * Returns `null` when no symbol is at the position.
     */
    rename(index: DocumentIndex, params: RenameParams): WorkspaceEdit | null;
}

/**
 * Default {@link TreeSitterRenameProvider} implementation. Pure function over
 * {@link DocumentIndex}: no I/O, no document state.
 */
export class DefaultTreeSitterRenameProvider implements TreeSitterRenameProvider {

    rename(index: DocumentIndex, params: RenameParams): WorkspaceEdit | null {
        const name = this.findNameAtPosition(index, params.position);
        if (name === undefined) {
            return null;
        }
        const documentUri = params.textDocument.uri;
        const changes: Record<string, TextEdit[]> = {};
        const declarations = index.declarations.get(name);
        if (declarations) {
            for (const decl of declarations) {
                const uri = decl.uri.toString();
                pushEdit(changes, uri, TextEdit.replace(decl.range, params.newName));
            }
        }
        const references = index.references.get(name);
        if (references) {
            for (const reference of references) {
                pushEdit(changes, documentUri, TextEdit.replace(reference.range, params.newName));
            }
        }
        return { changes };
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

function pushEdit(changes: Record<string, TextEdit[]>, uri: string, edit: TextEdit): void {
    const existing = changes[uri];
    if (existing) {
        existing.push(edit);
    } else {
        changes[uri] = [edit];
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
