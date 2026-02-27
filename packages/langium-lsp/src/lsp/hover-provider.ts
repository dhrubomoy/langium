/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Hover, HoverParams } from 'vscode-languageserver';
import type { GrammarConfig, References, AstNode, MaybePromise, LangiumDocument, DocumentationProvider } from 'langium-core';
import type { LangiumServices } from './lsp-services.js';
import { Cancellation, CstUtils, SyntaxNodeUtils, isJSDoc, parseJSDoc, isAstNodeWithComment } from 'langium-core';

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

    constructor(services: LangiumServices) {
        this.references = services.references.References;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    async getHoverContent(document: LangiumDocument, params: HoverParams): Promise<Hover | undefined> {
        const rootSyntaxNode = document.parseResult?.value?.$syntaxNode;
        const rootNode = document.parseResult?.value?.$cstNode;
        if (rootSyntaxNode) {
            const offset = document.textDocument.offsetAt(params.position);
            const syntaxNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(rootSyntaxNode, offset, this.grammarConfig.nameRegexp);
            if (syntaxNode && syntaxNode.offset + syntaxNode.length > offset) {
                // Use CstNode-based findDeclarations for backward compatibility
                // (references.findDeclarations still expects CstNode)
                const cstNode = rootNode ? CstUtils.findDeclarationNodeAtOffset(rootNode, offset, this.grammarConfig.nameRegexp) : undefined;
                if (cstNode) {
                    const contents: string[] = [];
                    const targetNodes = this.references.findDeclarations(cstNode);
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

                // Add support for documentation on keywords
                // Use SyntaxNode.isKeyword instead of grammarSource check
                // But pass the grammar Keyword element (via CstNode bridge) for comment lookup
                if (syntaxNode.isKeyword && cstNode) {
                    return this.getKeywordHoverContent(cstNode.grammarSource as AstNode);
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
