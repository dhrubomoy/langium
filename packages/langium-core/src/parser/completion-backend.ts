/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { AstNode } from '../syntax-tree.js';
import type { AbstractElement, Assignment, Grammar } from '../languages/generated/ast.js';
import type { GrammarRegistry } from '../grammar/grammar-registry.js';
import type { SyntaxNode } from './syntax-node.js';

/**
 * A backend-agnostic completion feature representing a grammar element
 * that could be completed at the cursor position.
 *
 * Each parser backend produces these; the `CompletionProvider` (in langium-lsp)
 * converts them to LSP `CompletionItem` objects.
 */
export interface CompletionFeature {
    kind: 'keyword' | 'crossReference' | 'terminal';
    /** For keywords: the keyword value. For cross-references and terminals: empty string. */
    value: string;
    /** The grammar AST element (Keyword, CrossReference, or RuleCall node). */
    grammarElement: AbstractElement;
    /** For cross-references and terminal assignments: the containing Assignment node. */
    assignment?: Assignment;
    /**
     * The parser rule type name for cross-reference context.
     * Set when we've entered a new rule (for synthetic node creation).
     */
    type?: string;
    /** The container property name (for synthetic node creation). */
    property?: string;
}

/**
 * Parameters passed to a parser backend for computing completion features.
 */
export interface CompletionRequest {
    /** The root syntax node of the document's parse tree. */
    rootSyntaxNode: SyntaxNode;
    /** The full document text. */
    text: string;
    /** The cursor offset. */
    offset: number;
    /** The language grammar. */
    grammar: Grammar;
    /** Grammar registry for O(1) lookups. */
    grammarRegistry: GrammarRegistry;
}

/**
 * A single completion context returned by a parser backend.
 * Multiple results may be returned (e.g. previous-token context, next-token context).
 */
export interface CompletionResult {
    /** The completion features expected at this context. */
    features: CompletionFeature[];
    /** The AST node near the cursor (used for scope resolution). */
    contextNode?: AstNode;
    /** Start offset of the token being completed (for text edit range). */
    tokenOffset: number;
    /** End offset of the token being completed (for text edit range). */
    tokenEndOffset: number;
    /** The cursor offset. */
    offset: number;
}
