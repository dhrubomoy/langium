/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { LocationLink, TypeDefinitionParams } from 'vscode-languageserver';
import type { References, AstNode, MaybePromise, LangiumDocument } from 'langium-core';
import type { LangiumServices } from './lsp-services.js';
import { Cancellation, SyntaxNodeUtils } from 'langium-core';

/**
 * Language-specific service for handling go to type requests.
 */
export interface TypeDefinitionProvider {
    /**
     * Handles a go to type definition request.
     */
    getTypeDefinition(document: LangiumDocument, params: TypeDefinitionParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<LocationLink[] | undefined>;
}

export abstract class AbstractTypeDefinitionProvider implements TypeDefinitionProvider {

    protected readonly references: References;

    constructor(services: LangiumServices) {
        this.references = services.references.References;
    }

    async getTypeDefinition(document: LangiumDocument, params: TypeDefinitionParams, cancelToken = Cancellation.CancellationToken.None): Promise<LocationLink[] | undefined> {
        const rootNode = document.parseResult.value;
        const rootSyntaxNode = rootNode.$syntaxNode;
        if (rootSyntaxNode) {
            const sourceSyntaxNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(rootSyntaxNode, document.textDocument.offsetAt(params.position));
            if (sourceSyntaxNode) {
                const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(sourceSyntaxNode);
                if (!astNode) return undefined;
                const nodeDeclarations = this.references.findDeclarationsSN(astNode, sourceSyntaxNode);
                const links: LocationLink[] = [];
                for (const node of nodeDeclarations) {
                    const location = await this.collectGoToTypeLocationLinks(node, cancelToken);
                    if (location) {
                        links.push(...location);
                    }
                }
                if (links.length > 0) {
                    return links;
                }
            }
        }
        return undefined;
    }

    /**
     * Override this method to implement the logic to generate the expected LocationLink[] for a go to type request for your language.
     */
    abstract collectGoToTypeLocationLinks(element: AstNode, cancelToken: Cancellation.CancellationToken): MaybePromise<LocationLink[] | undefined>;
}
