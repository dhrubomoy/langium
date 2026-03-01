/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { SyntaxNode, TextDocument } from 'langium-core';
import type { GrammarRegistry } from 'langium-core';
import type { LangiumServices } from '../lsp-services.js';
import type { CompletionBacktrackingInformation } from './completion-provider.js';
import type { NextFeature } from './follow-element-computation.js';
import { SyntaxNodeUtils, GrammarUtils } from 'langium-core';
import { AbstractCompletionProvider } from './completion-provider.js';
import { findNextFeatures } from './follow-element-computation.js';

/**
 * Completion provider for the Lezer parser backend.
 *
 * Uses the existing parse tree (SyntaxNode) to derive completion context
 * instead of Chevrotain's dedicated completion parser and lexer.
 *
 * Algorithm:
 * 1. Extract leaf tokens from the parse tree before the cursor offset
 * 2. Map leaf nodes to FollowElementToken format (keyword → text, terminal → type name)
 * 3. Feed tokens through `findNextFeatures` starting from the entry rule
 * 4. Build CompletionItems for the resulting keywords and cross-references
 */
export class LezerCompletionProvider extends AbstractCompletionProvider {

    protected readonly grammarRegistry: GrammarRegistry;

    constructor(services: LangiumServices) {
        super(services);
        this.grammarRegistry = services.grammar.GrammarRegistry;
    }

    // ---- Backend-specific implementations ----

    protected findFeaturesAt(root: SyntaxNode, _textDocument: TextDocument, offset: number): NextFeature[] {
        // Collect non-hidden leaf nodes before the offset
        const leaves = this.collectLeaves(root).filter(l => l.end <= offset);

        // Convert leaves to the token format expected by findNextFeatures
        const tokens = leaves.map(leaf => ({
            image: leaf.text,
            tokenType: { name: leaf.isKeyword ? leaf.text : leaf.type }
        }));

        const parserRule = GrammarUtils.getEntryRule(this.grammar);
        if (!parserRule) {
            return [];
        }

        const syntheticCall = this.buildSyntheticEntryRuleCall(parserRule);
        return findNextFeatures([[syntheticCall]], tokens);
    }

    protected findTokenBoundaries(root: SyntaxNode, _text: string, offset: number): CompletionBacktrackingInformation {
        const leaves = this.collectLeaves(root);

        if (leaves.length === 0) {
            return { nextTokenStart: offset, nextTokenEnd: offset };
        }

        let previousLeaf: SyntaxNode | undefined;
        for (const leaf of leaves) {
            if (leaf.offset >= offset) {
                return {
                    nextTokenStart: offset,
                    nextTokenEnd: offset,
                    previousTokenStart: previousLeaf?.offset,
                    previousTokenEnd: previousLeaf?.end,
                };
            }
            if (leaf.end >= offset) {
                return {
                    nextTokenStart: leaf.offset,
                    nextTokenEnd: leaf.end,
                    previousTokenStart: previousLeaf?.offset,
                    previousTokenEnd: previousLeaf?.end,
                };
            }
            previousLeaf = leaf;
        }

        return {
            nextTokenStart: offset,
            nextTokenEnd: offset,
            previousTokenStart: previousLeaf?.offset,
            previousTokenEnd: previousLeaf?.end,
        };
    }

    protected findDataTypeRuleStart(root: SyntaxNode, offset: number): [number, number] | undefined {
        const leaf = SyntaxNodeUtils.findLeafSyntaxNodeAtOffset(root, offset)
            ?? SyntaxNodeUtils.findLeafSyntaxNodeBeforeOffset(root, offset);
        if (!leaf) {
            return undefined;
        }
        let current: SyntaxNode | null = leaf;
        while (current) {
            if (current.type && this.grammarRegistry.isDataTypeRule(current.type)) {
                return [current.offset, current.end];
            }
            current = current.parent;
        }
        return undefined;
    }

    // ---- Lezer-specific helpers ----

    /**
     * Collect all non-hidden, non-error leaf nodes from the parse tree in document order.
     */
    protected collectLeaves(root: SyntaxNode): SyntaxNode[] {
        const result: SyntaxNode[] = [];
        this.collectLeavesRecursive(root, result);
        return result;
    }

    private collectLeavesRecursive(node: SyntaxNode, result: SyntaxNode[]): void {
        if (node.isLeaf) {
            // Include leaf if it's not hidden, not an error placeholder, and has a meaningful type.
            // Lezer creates empty error leaf nodes as placeholders for missing tokens —
            // these must be excluded or they break grammar token matching in findNextFeatures.
            if (!node.isHidden && !node.isError && (node.isKeyword || node.type !== '')) {
                result.push(node);
            }
            return;
        }
        for (const child of node.children) {
            this.collectLeavesRecursive(child, result);
        }
    }
}
