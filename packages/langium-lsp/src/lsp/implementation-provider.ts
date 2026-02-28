/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { ImplementationParams, LocationLink } from 'vscode-languageserver';
import type { GrammarConfig, References, AstNode, MaybePromise, LangiumDocument } from 'langium-core';
import type { LangiumServices } from './lsp-services.js';
import { Cancellation, SyntaxNodeUtils } from 'langium-core';

/**
 * Language-specific service for handling go to implementation requests.
 */
export interface ImplementationProvider {
    /**
     * Handles a go to implementation request.
     */
    getImplementation(document: LangiumDocument, params: ImplementationParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<LocationLink[] | undefined>;
}

export abstract class AbstractGoToImplementationProvider implements ImplementationProvider {
    protected readonly references: References;
    protected readonly grammarConfig: GrammarConfig;

    constructor(services: LangiumServices) {
        this.references = services.references.References;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    async getImplementation(document: LangiumDocument<AstNode>, params: ImplementationParams, cancelToken = Cancellation.CancellationToken.None): Promise<LocationLink[] | undefined> {
        const rootNode = document.parseResult.value;
        const rootSyntaxNode = rootNode.$syntaxNode;
        if (rootSyntaxNode) {
            const sourceSyntaxNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(rootSyntaxNode, document.textDocument.offsetAt(params.position), this.grammarConfig.nameRegexp);
            if (sourceSyntaxNode) {
                const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(sourceSyntaxNode);
                if (!astNode) return undefined;
                const nodeDeclarations = this.references.findDeclarationsSN(astNode, sourceSyntaxNode);
                const links: LocationLink[] = [];
                for (const node of nodeDeclarations) {
                    const location = await this.collectGoToImplementationLocationLinks(node, cancelToken);
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

    abstract collectGoToImplementationLocationLinks(element: AstNode, cancelToken: Cancellation.CancellationToken): MaybePromise<LocationLink[] | undefined>;
}
