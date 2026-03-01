/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Position, Range, RenameParams, TextDocumentPositionParams, WorkspaceEdit } from 'vscode-languageserver-protocol';
import type { GrammarConfig, NameProvider, References, SyntaxNode, MaybePromise, LangiumDocument } from 'langium-core';
import type { LangiumServices } from './lsp-services.js';
import { TextEdit } from 'vscode-languageserver-types';
import { Cancellation, SyntaxNodeUtils, isNamed } from 'langium-core';

/**
 * Language-specific service for handling rename requests and prepare rename requests.
 */
export interface RenameProvider {
    /**
     * Handle a rename request.
     *
     * @param document The document in which the rename request was triggered.
     * @param params The rename parameters.
     * @param cancelToken A cancellation token that can be used to cancel the request.
     * @returns A workspace edit that describes the changes to be applied to the workspace.
     *
     * @throws `OperationCancelled` if cancellation is detected during execution
     * @throws `ResponseError` if an error is detected that should be sent as response to the client
     */
    rename(document: LangiumDocument, params: RenameParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<WorkspaceEdit | undefined>;

    /**
     * Handle a prepare rename request.
     *
     * @param document The document in which the prepare rename request was triggered.
     * @param params The prepare rename parameters.
     * @param cancelToken A cancellation token that can be used to cancel the request.
     * @returns A range that describes the range of the symbol to be renamed.
     *
     * @throws `OperationCancelled` if cancellation is detected during execution
     * @throws `ResponseError` if an error is detected that should be sent as response to the client
     */
    prepareRename(document: LangiumDocument, params: TextDocumentPositionParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<Range | undefined>;
}

export class DefaultRenameProvider implements RenameProvider {

    protected readonly references: References;
    protected readonly nameProvider: NameProvider;
    protected readonly grammarConfig: GrammarConfig;

    constructor(services: LangiumServices) {
        this.references = services.references.References;
        this.nameProvider = services.references.NameProvider;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    async rename(document: LangiumDocument, params: RenameParams, _cancelToken?: Cancellation.CancellationToken): Promise<WorkspaceEdit | undefined> {
        const changes: Record<string, TextEdit[]> = {};
        const rootSyntaxNode = document.parseResult.value.$syntaxNode;
        if (!rootSyntaxNode) {
            return undefined;
        }
        const offset = document.textDocument.offsetAt(params.position);
        const leafSyntaxNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(rootSyntaxNode, offset, this.grammarConfig.nameRegexp);
        if (!leafSyntaxNode) {
            return undefined;
        }
        const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(leafSyntaxNode);
        if (!astNode) {
            return undefined;
        }
        const targetNodes = this.references.findDeclarationsSN(astNode, leafSyntaxNode);
        if (targetNodes.length === 0) {
            return undefined;
        }
        // We only need to find the references to a single target node
        // All other nodes should be found via `findReferences` if done correctly
        const targetNode = targetNodes[0];
        const options = { onlyLocal: false, includeDeclaration: true };
        const references = this.references.findReferences(targetNode, options);
        for (const ref of references) {
            const change = TextEdit.replace(ref.segment.range, params.newName);
            const uri = ref.sourceUri.toString();
            if (changes[uri]) {
                changes[uri].push(change);
            } else {
                changes[uri] = [change];
            }
        }
        return { changes };
    }

    prepareRename(document: LangiumDocument, params: TextDocumentPositionParams, _cancelToken?: Cancellation.CancellationToken): MaybePromise<Range | undefined> {
        return this.renameNodeRange(document, params.position);
    }

    protected renameNodeRange(doc: LangiumDocument, position: Position): Range | undefined {
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode;
        const offset = doc.textDocument.offsetAt(position);
        if (rootSyntaxNode) {
            const leafSyntaxNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(rootSyntaxNode, offset, this.grammarConfig.nameRegexp);
            if (!leafSyntaxNode) {
                return undefined;
            }
            const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(leafSyntaxNode);
            if (!astNode) {
                return undefined;
            }
            const isCrossRef = this.references.findDeclarationsSN(astNode, leafSyntaxNode).length > 0;
            // return range if selected SyntaxNode is the name node or it is a crosslink which points to a declaration
            if (isCrossRef || this.isNameNode(leafSyntaxNode)) {
                return leafSyntaxNode.range;
            }
        }
        return undefined;
    }

    protected isNameNode(leafNode: SyntaxNode | undefined): boolean | undefined {
        if (!leafNode) return undefined;
        const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(leafNode);
        return astNode && isNamed(astNode) && leafNode === this.nameProvider.getNameSyntaxNode(astNode);
    }
}
