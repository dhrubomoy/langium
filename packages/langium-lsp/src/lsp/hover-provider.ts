/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Hover, HoverParams } from 'vscode-languageserver';
import type { GrammarConfig, GrammarRegistry, References, AstNode, MaybePromise, LangiumDocument, DocumentationProvider } from 'langium-core';
import type { LangiumServices } from './lsp-services.js';
import { Cancellation, SyntaxNodeUtils, isJSDoc, parseJSDoc, isAstNodeWithComment, CstUtils, isLeafCstNode } from 'langium-core';

/**
 * Language-specific service for handling hover requests.
 */
export interface HoverProvider {
    /**
     * Handle a hover request.
     *
     * @throws `OperationCancelled` if cancellation is detected during execution
     * @throws `ResponseError` if an error is detected that should be sent as response to the client
     */
    getHoverContent(document: LangiumDocument, params: HoverParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<Hover | undefined>;
}

export abstract class AstNodeHoverProvider implements HoverProvider {

    protected readonly references: References;
    protected readonly grammarConfig: GrammarConfig;
    protected readonly grammarRegistry: GrammarRegistry;

    constructor(services: LangiumServices) {
        this.references = services.references.References;
        this.grammarConfig = services.parser.GrammarConfig;
        this.grammarRegistry = services.grammar.GrammarRegistry;
    }

    async getHoverContent(document: LangiumDocument, params: HoverParams): Promise<Hover | undefined> {
        const rootSyntaxNode = document.parseResult?.value?.$syntaxNode;
        if (rootSyntaxNode) {
            const offset = document.textDocument.offsetAt(params.position);
            const syntaxNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(rootSyntaxNode, offset, this.grammarConfig.nameRegexp);
            if (syntaxNode && syntaxNode.offset + syntaxNode.length > offset) {
                // Use SyntaxNode-based findDeclarationsSN
                const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(syntaxNode);
                if (astNode) {
                    const contents: string[] = [];
                    const targetNodes = this.references.findDeclarationsSN(astNode, syntaxNode);
                    for (const targetNode of targetNodes) {
                        const content = await this.getAstNodeHoverContent(targetNode);
                        if (typeof content === 'string') {
                            contents.push(content);
                        }
                    }
                    if (contents.length > 0) {
                        return {
                            contents: {
                                kind: 'markdown',
                                value: contents.join(' ')
                            }
                        };
                    }
                }

                // Keyword hover: identify the exact grammar Keyword element
                if (syntaxNode.isKeyword) {
                    // CstNode path: grammarSource identifies the exact keyword instance
                    const parentAstNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(syntaxNode);
                    const parentCstNode = parentAstNode?.$cstNode;
                    if (parentCstNode) {
                        const leafCstNode = CstUtils.findDeclarationNodeAtOffset(parentCstNode, offset, this.grammarConfig.nameRegexp);
                        if (leafCstNode && isLeafCstNode(leafCstNode) && leafCstNode.grammarSource) {
                            const result = this.getKeywordHoverContent(leafCstNode.grammarSource);
                            if (result) {
                                return result;
                            }
                        }
                    }
                    // Fallback for non-CstNode backends: try all matching keyword elements
                    const keywordElements = this.grammarRegistry.getKeywordElements(syntaxNode.text);
                    for (const keywordElement of keywordElements) {
                        const result = this.getKeywordHoverContent(keywordElement);
                        if (result) {
                            return result;
                        }
                    }
                }
            }
        }
        return undefined;
    }

    protected abstract getAstNodeHoverContent(node: AstNode): MaybePromise<string | undefined>;

    protected getKeywordHoverContent(node: AstNode): MaybePromise<Hover | undefined> {
        let comment = isAstNodeWithComment(node) ? node.$comment : undefined;
        if (!comment) {
            comment = CstUtils.findCommentNode(node.$cstNode, ['ML_COMMENT'])?.text;
        }
        if (comment && isJSDoc(comment)) {
            const content = parseJSDoc(comment).toMarkdown();
            if (content) {
                return {
                    contents: {
                        kind: 'markdown',
                        value: content
                    }
                };
            }
        }
        return undefined;
    }
}

export class MultilineCommentHoverProvider extends AstNodeHoverProvider {

    protected readonly documentationProvider: DocumentationProvider;

    constructor(services: LangiumServices) {
        super(services);
        this.documentationProvider = services.documentation.DocumentationProvider;
    }

    protected getAstNodeHoverContent(node: AstNode): MaybePromise<string | undefined> {
        const content = this.documentationProvider.getDocumentation(node);

        if (content) {
            return content;
        }
        return undefined;
    }
}
