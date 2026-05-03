/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import { DefaultTreeSitterFoldingRangeProvider } from 'langium/lsp';

interface MockNodeSpec {
    type: string;
    isNamed?: boolean;
    startPosition?: { row: number, column: number };
    endPosition?: { row: number, column: number };
    children?: MockNodeSpec[];
}

function mockNode(spec: MockNodeSpec): SyntaxNode {
    const children = (spec.children ?? []).map(child => mockNode(child));
    const node = {
        type: spec.type,
        isNamed: spec.isNamed ?? true,
        startPosition: spec.startPosition ?? { row: 0, column: 0 },
        endPosition: spec.endPosition ?? { row: 0, column: 0 },
        children
    };
    return node as unknown as SyntaxNode;
}

describe('DefaultTreeSitterFoldingRangeProvider', () => {

    const provider = new DefaultTreeSitterFoldingRangeProvider();

    test('emits one FoldingRange for a multi-line named node and skips a single-line node (AC)', () => {
        const root = mockNode({
            type: 'source_file',
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 5, column: 0 },
            children: [
                {
                    type: 'Definition',
                    startPosition: { row: 1, column: 0 },
                    endPosition: { row: 5, column: 0 }
                },
                {
                    type: 'NumberLiteral',
                    startPosition: { row: 6, column: 0 },
                    endPosition: { row: 6, column: 5 }
                }
            ]
        });
        const result = provider.getFoldingRanges(root);
        const inner = result.filter(r => !(r.startLine === 0 && r.endLine === 5));
        expect(inner).toHaveLength(1);
        expect(inner[0]).toEqual({ startLine: 1, endLine: 5 });
    });

    test('skips named nodes that span exactly one line', () => {
        const root = mockNode({
            type: 'source_file',
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 0, column: 10 },
            children: [
                {
                    type: 'Inline',
                    startPosition: { row: 0, column: 1 },
                    endPosition: { row: 0, column: 9 }
                }
            ]
        });
        const result = provider.getFoldingRanges(root);
        expect(result).toEqual([]);
    });

    test('skips anonymous (unnamed) nodes even when multi-line', () => {
        const root = mockNode({
            type: 'source_file',
            isNamed: false,
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 4, column: 0 },
            children: [
                {
                    type: 'punctuation',
                    isNamed: false,
                    startPosition: { row: 1, column: 0 },
                    endPosition: { row: 3, column: 0 }
                }
            ]
        });
        const result = provider.getFoldingRanges(root);
        expect(result).toEqual([]);
    });

    test('emits FoldingRanges for nested named nodes', () => {
        const root = mockNode({
            type: 'source_file',
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 10, column: 0 },
            children: [
                {
                    type: 'Outer',
                    startPosition: { row: 1, column: 0 },
                    endPosition: { row: 8, column: 0 },
                    children: [
                        {
                            type: 'Inner',
                            startPosition: { row: 2, column: 0 },
                            endPosition: { row: 5, column: 0 }
                        }
                    ]
                }
            ]
        });
        const result = provider.getFoldingRanges(root);
        expect(result).toContainEqual({ startLine: 0, endLine: 10 });
        expect(result).toContainEqual({ startLine: 1, endLine: 8 });
        expect(result).toContainEqual({ startLine: 2, endLine: 5 });
        expect(result).toHaveLength(3);
    });

    test('uses node.startPosition.row and node.endPosition.row directly (zero-based, no off-by-one)', () => {
        const root = mockNode({
            type: 'X',
            startPosition: { row: 3, column: 7 },
            endPosition: { row: 9, column: 2 }
        });
        const [range] = provider.getFoldingRanges(root);
        expect(range.startLine).toBe(3);
        expect(range.endLine).toBe(9);
    });

    test('walks anonymous parent nodes to find named multi-line children', () => {
        const root = mockNode({
            type: 'wrapper',
            isNamed: false,
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 5, column: 0 },
            children: [
                {
                    type: 'NamedChild',
                    isNamed: true,
                    startPosition: { row: 1, column: 0 },
                    endPosition: { row: 4, column: 0 }
                }
            ]
        });
        const result = provider.getFoldingRanges(root);
        expect(result).toEqual([{ startLine: 1, endLine: 4 }]);
    });

    test('returns an empty array when the only node is single-line', () => {
        const root = mockNode({
            type: 'X',
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 0, column: 10 }
        });
        expect(provider.getFoldingRanges(root)).toEqual([]);
    });

    test('emits multiple sibling FoldingRanges in walk order', () => {
        const root = mockNode({
            type: 'source_file',
            isNamed: false,
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 20, column: 0 },
            children: [
                {
                    type: 'A',
                    startPosition: { row: 0, column: 0 },
                    endPosition: { row: 4, column: 0 }
                },
                {
                    type: 'B',
                    startPosition: { row: 5, column: 0 },
                    endPosition: { row: 9, column: 0 }
                },
                {
                    type: 'C',
                    startPosition: { row: 10, column: 0 },
                    endPosition: { row: 14, column: 0 }
                }
            ]
        });
        const result = provider.getFoldingRanges(root);
        expect(result).toEqual([
            { startLine: 0, endLine: 4 },
            { startLine: 5, endLine: 9 },
            { startLine: 10, endLine: 14 }
        ]);
    });

    test('tolerates null entries in the children array', () => {
        const root = mockNode({
            type: 'source_file',
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 5, column: 0 },
            children: [
                {
                    type: 'Definition',
                    startPosition: { row: 1, column: 0 },
                    endPosition: { row: 4, column: 0 }
                }
            ]
        });
        // tree-sitter children can include null entries — splice one in to verify the walker tolerates it.
        (root as unknown as { children: Array<SyntaxNode | null> }).children.unshift(null);
        const result = provider.getFoldingRanges(root);
        expect(result).toContainEqual({ startLine: 0, endLine: 5 });
        expect(result).toContainEqual({ startLine: 1, endLine: 4 });
    });
});
