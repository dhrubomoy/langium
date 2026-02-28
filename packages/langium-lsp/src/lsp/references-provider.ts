/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { ReferenceParams } from 'vscode-languageserver';
import type { NameProvider, References, AstNode, SyntaxNode, MaybePromise, LangiumDocument, GrammarConfig } from 'langium-core';
import type { LangiumServices } from './lsp-services.js';
import { Location } from 'vscode-languageserver';
import { Cancellation, SyntaxNodeUtils } from 'langium-core';

/**
 * Language-specific service for handling find references requests.
 */
export interface ReferencesProvider {
    /**
     * Handle a find references request.
     *
     * @param document The document in which to search for references.
     * @param params The parameters of the find references request.
     * @param cancelToken A cancellation token that can be used to cancel the request.
     * @returns The locations of the references.
     *
     * @throws `OperationCancelled` if cancellation is detected during execution
     * @throws `ResponseError` if an error is detected that should be sent as response to the client
     */
    findReferences(document: LangiumDocument, params: ReferenceParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<Location[]>;
}

export class DefaultReferencesProvider implements ReferencesProvider {
    protected readonly nameProvider: NameProvider;
    protected readonly references: References;
    protected readonly grammarConfig: GrammarConfig;

    constructor(services: LangiumServices) {
        this.nameProvider = services.references.NameProvider;
        this.references = services.references.References;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    findReferences(document: LangiumDocument, params: ReferenceParams, _cancelToken?: Cancellation.CancellationToken): MaybePromise<Location[]> {
        const rootNode = document.parseResult.value;
        const rootSyntaxNode = rootNode.$syntaxNode;
        if (!rootSyntaxNode) {
            return [];
        }
        const offset = document.textDocument.offsetAt(params.position);
        const selectedSyntaxNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(rootSyntaxNode, offset, this.grammarConfig.nameRegexp);
        if (!selectedSyntaxNode) {
            return [];
        }
        const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(selectedSyntaxNode);
        if (!astNode) {
            return [];
        }
        return this.getReferences(astNode, selectedSyntaxNode, params);
    }

    protected getReferences(astNode: AstNode, syntaxNode: SyntaxNode, params: ReferenceParams): Location[] {
        const locations: Location[] = [];
        const targetAstNodes = this.references.findDeclarationsSN(astNode, syntaxNode);
        for (const target of targetAstNodes) {
            const options = { includeDeclaration: params.context.includeDeclaration };
            this.references.findReferences(target, options).forEach(reference => {
                locations.push(Location.create(reference.sourceUri.toString(), reference.segment.range));
            });
        }
        return locations;
    }
}
