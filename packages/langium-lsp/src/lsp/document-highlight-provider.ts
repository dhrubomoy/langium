/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { DocumentHighlightParams } from 'vscode-languageserver';
import type { GrammarConfig, NameProvider, FindReferencesOptions, References, AstNode, MaybePromise, ReferenceDescription, LangiumDocument } from 'langium-core';
import type { LangiumServices } from './lsp-services.js';
import { DocumentHighlight } from 'vscode-languageserver';
import { AstUtils, Cancellation, SyntaxNodeUtils, UriUtils } from 'langium-core';

/**
 * Language-specific service for handling document highlight requests.
 */
export interface DocumentHighlightProvider {
    /**
     * Handle a document highlight request.
     *
     * @param document The document in which the request was received.
     * @param params The parameters of the document highlight request.
     * @param cancelToken A cancellation token that can be used to cancel the request.
     * @returns The document highlights or `undefined` if no highlights are available.
     * @throws `OperationCancelled` if cancellation is detected during execution
     * @throws `ResponseError` if an error is detected that should be sent as response to the client
     */
    getDocumentHighlight(document: LangiumDocument, params: DocumentHighlightParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<DocumentHighlight[] | undefined>;
}

export class DefaultDocumentHighlightProvider implements DocumentHighlightProvider {
    protected readonly references: References;
    protected readonly nameProvider: NameProvider;
    protected readonly grammarConfig: GrammarConfig;

    constructor(services: LangiumServices) {
        this.references = services.references.References;
        this.nameProvider = services.references.NameProvider;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    getDocumentHighlight(document: LangiumDocument, params: DocumentHighlightParams, _cancelToken?: Cancellation.CancellationToken): MaybePromise<DocumentHighlight[] | undefined> {
        const rootSyntaxNode = document.parseResult.value.$syntaxNode;
        if (!rootSyntaxNode) {
            return undefined;
        }
        const offset = document.textDocument.offsetAt(params.position);
        const selectedSyntaxNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(rootSyntaxNode, offset, this.grammarConfig.nameRegexp);
        if (!selectedSyntaxNode) {
            return undefined;
        }
        const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(selectedSyntaxNode);
        if (!astNode) {
            return undefined;
        }
        return this.collectHighlights(document, this.references.findDeclarationsSN(astNode, selectedSyntaxNode));
    }

    protected collectHighlights(document: LangiumDocument, targets: Iterable<AstNode>): DocumentHighlight[] {
        const highlights: DocumentHighlight[] = [];
        for (const target of targets) {
            const includeDeclaration = UriUtils.equals(AstUtils.getDocument(target).uri, document.uri);
            const options: FindReferencesOptions = { documentUri: document.uri, includeDeclaration: includeDeclaration };
            const references = this.references.findReferences(target, options);
            highlights.push(...references.map(ref => this.createDocumentHighlight(ref)).toArray());
        }
        return highlights;
    }

    /**
    * Override this method to determine the highlight kind of the given reference.
    */
    protected createDocumentHighlight(reference: ReferenceDescription): DocumentHighlight {
        return DocumentHighlight.create(reference.segment.range);
    }
}
