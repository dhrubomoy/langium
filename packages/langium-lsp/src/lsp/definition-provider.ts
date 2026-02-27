/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { DefinitionParams } from 'vscode-languageserver';
import type { GrammarConfig, NameProvider, References, SyntaxNode, MaybePromise, LangiumDocument } from 'langium-core';
import type { LangiumServices } from './lsp-services.js';
import { LocationLink } from 'vscode-languageserver';
import { AstUtils, Cancellation, CstUtils, SyntaxNodeUtils, wrapCstNode } from 'langium-core';

/**
 * Language-specific service for handling go to definition requests.
 */
export interface DefinitionProvider {
    /**
     * Handle a go to definition request.
     *
     * @param document The document in which the request was triggered.
     * @param params The parameters of the request.
     * @param cancelToken A cancellation token that can be used to cancel the request.
     * @returns A list of location links to the definition(s) of the symbol at the given position.
     *
     * @throws `OperationCancelled` if cancellation is detected during execution
     * @throws `ResponseError` if an error is detected that should be sent as response to the client
     */
    getDefinition(document: LangiumDocument, params: DefinitionParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<LocationLink[] | undefined>;
}

export interface GoToLink {
    source: SyntaxNode
    target: SyntaxNode
    targetDocument: LangiumDocument
}

export class DefaultDefinitionProvider implements DefinitionProvider {

    protected readonly nameProvider: NameProvider;
    protected readonly references: References;
    protected readonly grammarConfig: GrammarConfig;

    constructor(services: LangiumServices) {
        this.nameProvider = services.references.NameProvider;
        this.references = services.references.References;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    getDefinition(document: LangiumDocument, params: DefinitionParams, _cancelToken?: Cancellation.CancellationToken): MaybePromise<LocationLink[] | undefined> {
        const rootNode = document.parseResult.value;
        const rootSyntaxNode = rootNode.$syntaxNode;
        if (rootSyntaxNode) {
            const offset = document.textDocument.offsetAt(params.position);
            const sourceSyntaxNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(rootSyntaxNode, offset, this.grammarConfig.nameRegexp);
            if (sourceSyntaxNode) {
                return this.collectLocationLinks(sourceSyntaxNode, params);
            }
        }
        return undefined;
    }

    protected collectLocationLinks(sourceSyntaxNode: SyntaxNode, _params: DefinitionParams): MaybePromise<LocationLink[] | undefined> {
        const goToLinks = this.findLinks(sourceSyntaxNode);
        if (goToLinks.length > 0) {
            return goToLinks.map(link => {
                const targetAstNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(link.target);
                const targetRange = targetAstNode?.$syntaxNode?.range ?? link.target.range;
                return LocationLink.create(
                    link.targetDocument.textDocument.uri,
                    targetRange,
                    link.target.range,
                    link.source.range
                );
            });
        }
        return undefined;
    }

    protected findLinks(source: SyntaxNode): GoToLink[] {
        const datatypeSourceNode = SyntaxNodeUtils.getDatatypeSyntaxNode(source) ?? source;
        // Bridge: references.findDeclarationNodes still requires CstNode
        const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(source);
        if (!astNode?.$cstNode) {
            return [];
        }
        const sourceCstNode = CstUtils.findDeclarationNodeAtOffset(astNode.$cstNode, source.offset, this.grammarConfig.nameRegexp);
        if (!sourceCstNode) {
            return [];
        }
        const targets = this.references.findDeclarationNodes(sourceCstNode);
        const links: GoToLink[] = [];
        for (const target of targets) {
            const targetDocument = AstUtils.getDocument(target.astNode);
            if (targets && targetDocument) {
                links.push({
                    source: datatypeSourceNode,
                    target: wrapCstNode(target),
                    targetDocument
                });
            }
        }
        return links;
    }
}
