/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { DocumentSymbol, DocumentSymbolParams } from 'vscode-languageserver-protocol';
import type { NameProvider, AstNode, SyntaxNode, MaybePromise, LangiumDocument } from 'langium-core';
import { AstUtils, Cancellation } from 'langium-core';
import type { LangiumServices } from './lsp-services.js';
import type { NodeKindProvider } from './node-kind-provider.js';

/**
 * Language-specific service for handling document symbols requests.
 */
export interface DocumentSymbolProvider {
    /**
     * Handle a document symbols request.
     *
     * @param document The document in the workspace.
     * @param params The parameters of the request.
     * @param cancelToken A cancellation token that migh be used to cancel the request.
     * @returns The symbols for the given document.
     *
     * @throws `OperationCancelled` if cancellation is detected during execution
     * @throws `ResponseError` if an error is detected that should be sent as response to the client
     */
    getSymbols(document: LangiumDocument, params: DocumentSymbolParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<DocumentSymbol[]>;
}

export class DefaultDocumentSymbolProvider implements DocumentSymbolProvider {

    protected readonly nameProvider: NameProvider;
    protected readonly nodeKindProvider: NodeKindProvider;

    constructor(services: LangiumServices) {
        this.nameProvider = services.references.NameProvider;
        this.nodeKindProvider = services.shared.lsp.NodeKindProvider;
    }

    getSymbols(document: LangiumDocument, _params: DocumentSymbolParams, _cancelToken?: Cancellation.CancellationToken): MaybePromise<DocumentSymbol[]> {
        return this.getSymbol(document, document.parseResult.value);
    }

    protected getSymbol(document: LangiumDocument, astNode: AstNode): DocumentSymbol[] {
        const nameNode = this.nameProvider.getNameSyntaxNode(astNode);
        if (nameNode && astNode.$syntaxNode) {
            const computedName = this.nameProvider.getName(astNode);
            return [ this.createSymbol(document, astNode, astNode.$syntaxNode, nameNode, computedName) ];
        } else {
            return this.getChildSymbols(document, astNode) || [];
        }
    }

    protected createSymbol(document: LangiumDocument, astNode: AstNode, syntaxNode: SyntaxNode, nameNode: SyntaxNode, computedName?: string): DocumentSymbol {
        return {
            kind: this.nodeKindProvider.getSymbolKind(astNode),
            name: computedName || nameNode.text,
            range: syntaxNode.range,
            selectionRange: nameNode.range,
            children: this.getChildSymbols(document, astNode)
        };
    }

    protected getChildSymbols(document: LangiumDocument, astNode: AstNode): DocumentSymbol[] | undefined {
        const children: DocumentSymbol[] = [];

        for (const child of AstUtils.streamContents(astNode)) {
            const result = this.getSymbol(document, child);
            children.push(...result);
        }
        if (children.length > 0) {
            return children;
        }
        return undefined;
    }
}
