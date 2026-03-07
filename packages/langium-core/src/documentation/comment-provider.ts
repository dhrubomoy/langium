/******************************************************************************
 * Copyright 2023 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { GrammarConfig } from '../languages/grammar-config.js';
import { isAstNodeWithComment } from '../serializer/json-serializer.js';
import type { LangiumCoreServices } from '../services.js';
import type { AstNode } from '../syntax-tree.js';
import { findCommentNode } from '../utils/cst-utils.js';
import { findCommentSyntaxNode } from '../utils/syntax-node-utils.js';

/**
 * Provides comments for AST nodes.
 */
export interface CommentProvider {
    /**
     * Returns the comment associated with the specified AST node.
     * @param node The AST node to get the comment for.
     * @returns The comment associated with the specified AST node or `undefined` if there is no comment.
     */
    getComment(node: AstNode): string | undefined;
}

export class DefaultCommentProvider implements CommentProvider {
    protected readonly grammarConfig: () => GrammarConfig;
    constructor(services: LangiumCoreServices) {
        this.grammarConfig = () => services.parser.GrammarConfig;
    }
    getComment(node: AstNode): string | undefined {
        if(isAstNodeWithComment(node)) {
            return node.$comment;
        }
        const commentRules = this.grammarConfig().multilineCommentRules;
        // Prefer SyntaxNode path; fall back to CstNode for backward compat
        return findCommentSyntaxNode(node.$syntaxNode, commentRules)?.text
            ?? findCommentNode(node.$cstNode, commentRules)?.text;
    }
}
