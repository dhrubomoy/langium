/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { FoldingRange } from 'vscode-languageserver-types';
import type { Node as SyntaxNode } from 'web-tree-sitter';

/**
 * Language-specific service that produces Folding Ranges from a tree-sitter
 * syntax tree.
 *
 * Distinct from the Chevrotain-era {@link import('./folding-range-provider.js').FoldingRangeProvider},
 * which walks a `LangiumDocument`. The tree-sitter pipeline does not yet flow
 * through the standard `DocumentBuilder`, so this provider walks a
 * tree-sitter {@link SyntaxNode} root directly. It does not need the
 * {@link import('../workspace/document-index.js').DocumentIndex} because
 * folding is purely structural.
 */
export interface TreeSitterFoldingRangeProvider {
    /**
     * Walk the given tree-sitter root node and emit a {@link FoldingRange} for
     * every named node that spans more than one line.
     *
     * `startLine` / `endLine` are taken directly from the node's
     * `startPosition.row` / `endPosition.row` (zero-based, matching the LSP
     * folding-range spec).
     */
    getFoldingRanges(tree: SyntaxNode): FoldingRange[];
}

/**
 * Default {@link TreeSitterFoldingRangeProvider} implementation. Stateless
 * recursive walk over the syntax tree.
 */
export class DefaultTreeSitterFoldingRangeProvider implements TreeSitterFoldingRangeProvider {

    getFoldingRanges(tree: SyntaxNode): FoldingRange[] {
        const result: FoldingRange[] = [];
        this.walk(tree, result);
        return result;
    }

    protected walk(node: SyntaxNode, result: FoldingRange[]): void {
        if (node.isNamed && node.endPosition.row > node.startPosition.row) {
            result.push({
                startLine: node.startPosition.row,
                endLine: node.endPosition.row
            });
        }
        for (const child of node.children) {
            if (child) {
                this.walk(child, result);
            }
        }
    }
}
