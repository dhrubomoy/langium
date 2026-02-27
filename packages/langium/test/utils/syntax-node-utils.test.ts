/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test, expect, beforeAll } from 'vitest';
import type { AstNode } from 'langium';
import { SyntaxNodeUtils, CstUtils, GrammarUtils } from 'langium';

import { createServicesForGrammar } from 'langium/grammar';
import { parseHelper } from 'langium/test';

const {
    streamSyntaxTree,
    flattenSyntaxTree,
    findLeafSyntaxNodeAtOffset,
    findLeafSyntaxNodeBeforeOffset,
    findDeclarationSyntaxNodeAtOffset,
    findCommentSyntaxNode,
    isCommentSyntaxNode,
    getPreviousSyntaxNode,
    getNextSyntaxNode,
    findNodesForPropertySN,
    findNodeForPropertySN,
    findNodesForKeywordSN,
    findNodeForKeywordSN,
    findAssignmentSN,
    findAstNodeForSyntaxNode
} = SyntaxNodeUtils;
const { findLeafNodeAtOffset } = CstUtils;
const { findNodeForProperty, findNodesForProperty, findNodesForKeyword } = GrammarUtils;


const grammar = `
    grammar Test
    entry Model:
        (items+=Item)*;
    Item:
        'item' name=ID value=INT?;
    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
    terminal INT returns number: /[0-9]+/;
    hidden terminal ML_COMMENT: /\\/\\*[\\s\\S]*?\\*\\//;
`;

interface Model extends AstNode {
    items: Item[];
}

interface Item extends AstNode {
    name: string;
    value?: number;
}

describe('SyntaxNode utility functions', () => {
    let parse: ReturnType<typeof parseHelper<Model>>;

    beforeAll(async () => {
        const services = await createServicesForGrammar({ grammar });
        parse = parseHelper<Model>(services);
    });

    describe('streamSyntaxTree', () => {
        test('streams all nodes including root', async () => {
            const doc = await parse('item foo');
            const syntaxNode = doc.parseResult.value.$syntaxNode!;
            const nodes = streamSyntaxTree(syntaxNode).toArray();
            expect(nodes.length).toBeGreaterThan(0);
            expect(nodes[0]).toBe(syntaxNode); // root is first
        });

        test('includes leaf nodes', async () => {
            const doc = await parse('item foo');
            const syntaxNode = doc.parseResult.value.$syntaxNode!;
            const nodes = streamSyntaxTree(syntaxNode).toArray();
            const leaves = nodes.filter(n => n.isLeaf);
            expect(leaves.length).toBeGreaterThan(0);
        });
    });

    describe('flattenSyntaxTree', () => {
        test('returns only leaf nodes', async () => {
            const doc = await parse('item foo 42');
            const syntaxNode = doc.parseResult.value.$syntaxNode!;
            const leaves = flattenSyntaxTree(syntaxNode).toArray();
            expect(leaves.length).toBeGreaterThan(0);
            for (const leaf of leaves) {
                expect(leaf.isLeaf).toBe(true);
            }
        });
    });

    describe('findLeafSyntaxNodeAtOffset', () => {
        test('finds leaf at exact offset', async () => {
            const doc = await parse('item foo');
            const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
            // 'item' starts at offset 0
            const node = findLeafSyntaxNodeAtOffset(rootSyntaxNode, 0);
            expect(node).toBeDefined();
            expect(node!.text).toBe('item');
        });

        test('finds leaf for ID token', async () => {
            const doc = await parse('item foo');
            const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
            // 'foo' starts at offset 5
            const node = findLeafSyntaxNodeAtOffset(rootSyntaxNode, 5);
            expect(node).toBeDefined();
            expect(node!.text).toBe('foo');
        });

        test('returns same result as CstNode-based function', async () => {
            const doc = await parse('item foo 42');
            const rootCstNode = doc.parseResult.value.$cstNode!;
            const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;

            for (let offset = 0; offset < 11; offset++) {
                const cstResult = findLeafNodeAtOffset(rootCstNode, offset);
                const snResult = findLeafSyntaxNodeAtOffset(rootSyntaxNode, offset);
                if (cstResult) {
                    expect(snResult).toBeDefined();
                    expect(snResult!.text).toBe(cstResult.text);
                    expect(snResult!.offset).toBe(cstResult.offset);
                }
            }
        });
    });

    describe('findLeafSyntaxNodeBeforeOffset', () => {
        test('finds leaf before offset', async () => {
            const doc = await parse('item foo');
            const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
            // offset 5 is start of 'foo', before should be 'item' or whitespace
            const node = findLeafSyntaxNodeBeforeOffset(rootSyntaxNode, 5);
            expect(node).toBeDefined();
        });
    });

    describe('findDeclarationSyntaxNodeAtOffset', () => {
        test('finds node at declaration offset', async () => {
            const doc = await parse('item foo');
            const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
            const node = findDeclarationSyntaxNodeAtOffset(rootSyntaxNode, 5);
            expect(node).toBeDefined();
            expect(node!.text).toBe('foo');
        });

        test('returns undefined for undefined input', () => {
            const node = findDeclarationSyntaxNodeAtOffset(undefined, 0);
            expect(node).toBeUndefined();
        });
    });

    describe('findNodesForPropertySN', () => {
        test('finds nodes for single-value property', async () => {
            const doc = await parse('item foo');
            const item = doc.parseResult.value.items[0];
            const nodes = findNodesForPropertySN(item.$syntaxNode, 'name');
            expect(nodes.length).toBe(1);
            expect(nodes[0].text).toBe('foo');
        });

        test('matches CstNode-based function', async () => {
            const doc = await parse('item foo 42');
            const item = doc.parseResult.value.items[0];

            const cstResults = findNodesForProperty(item.$cstNode, 'name');
            const snResults = findNodesForPropertySN(item.$syntaxNode, 'name');
            expect(snResults.length).toBe(cstResults.length);
            for (let i = 0; i < cstResults.length; i++) {
                expect(snResults[i].text).toBe(cstResults[i].text);
                expect(snResults[i].offset).toBe(cstResults[i].offset);
            }
        });

        test('returns empty for undefined node', () => {
            expect(findNodesForPropertySN(undefined, 'name')).toEqual([]);
        });

        test('returns empty for undefined property', async () => {
            const doc = await parse('item foo');
            const item = doc.parseResult.value.items[0];
            expect(findNodesForPropertySN(item.$syntaxNode, undefined)).toEqual([]);
        });
    });

    describe('findNodeForPropertySN', () => {
        test('finds single node for property', async () => {
            const doc = await parse('item foo');
            const item = doc.parseResult.value.items[0];
            const node = findNodeForPropertySN(item.$syntaxNode, 'name');
            expect(node).toBeDefined();
            expect(node!.text).toBe('foo');
        });

        test('matches CstNode-based function', async () => {
            const doc = await parse('item foo');
            const item = doc.parseResult.value.items[0];

            const cstResult = findNodeForProperty(item.$cstNode, 'name');
            const snResult = findNodeForPropertySN(item.$syntaxNode, 'name');
            expect(snResult).toBeDefined();
            expect(cstResult).toBeDefined();
            expect(snResult!.text).toBe(cstResult!.text);
            expect(snResult!.offset).toBe(cstResult!.offset);
        });

        test('returns undefined for undefined node', () => {
            expect(findNodeForPropertySN(undefined, 'name')).toBeUndefined();
        });
    });

    describe('findNodesForKeywordSN', () => {
        test('finds keyword nodes within same AST scope', async () => {
            const doc = await parse('item foo item bar');
            // Keyword search is scoped to the same AST node.
            // 'item' keywords belong to Item AST nodes, not Model.
            const item = doc.parseResult.value.items[0];
            const nodes = findNodesForKeywordSN(item.$syntaxNode, 'item');
            expect(nodes.length).toBe(1);
            expect(nodes[0].text).toBe('item');
            expect(nodes[0].isKeyword).toBe(true);
        });

        test('matches CstNode-based function', async () => {
            const doc = await parse('item foo item bar');
            const item = doc.parseResult.value.items[0];

            const cstResults = findNodesForKeyword(item.$cstNode!, 'item');
            const snResults = findNodesForKeywordSN(item.$syntaxNode, 'item');
            expect(snResults.length).toBe(cstResults.length);
            for (let i = 0; i < cstResults.length; i++) {
                expect(snResults[i].text).toBe(cstResults[i].text);
                expect(snResults[i].offset).toBe(cstResults[i].offset);
            }
        });

        test('returns empty for undefined node', () => {
            expect(findNodesForKeywordSN(undefined, 'item')).toEqual([]);
        });
    });

    describe('findNodeForKeywordSN', () => {
        test('finds keyword within AST scope', async () => {
            const doc = await parse('item foo');
            const item = doc.parseResult.value.items[0];
            const node = findNodeForKeywordSN(item.$syntaxNode, 'item');
            expect(node).toBeDefined();
            expect(node!.text).toBe('item');
        });

        test('returns undefined for non-existent keyword', async () => {
            const doc = await parse('item foo');
            const item = doc.parseResult.value.items[0];
            expect(findNodeForKeywordSN(item.$syntaxNode, 'nonExistent')).toBeUndefined();
        });
    });

    describe('findAssignmentSN', () => {
        test('finds assignment for property node', async () => {
            const doc = await parse('item foo');
            const item = doc.parseResult.value.items[0];
            const nameNode = findNodeForPropertySN(item.$syntaxNode, 'name');
            expect(nameNode).toBeDefined();
            const assignment = findAssignmentSN(nameNode!);
            expect(assignment).toBeDefined();
            expect(assignment!.feature).toBe('name');
        });
    });

    describe('findAstNodeForSyntaxNode', () => {
        test('maps SyntaxNode back to AstNode', async () => {
            const doc = await parse('item foo');
            const item = doc.parseResult.value.items[0];
            const syntaxNode = item.$syntaxNode!;
            const astNode = findAstNodeForSyntaxNode(syntaxNode);
            expect(astNode).toBeDefined();
            expect(astNode).toBe(item);
        });

        test('returns undefined for unlinked nodes', () => {
            // A synthetic ChevrotainSyntaxNode wrapping a CstNode without astNode
            // would return undefined via the try/catch
            expect(findAstNodeForSyntaxNode({
                type: 'test',
                offset: 0,
                end: 0,
                length: 0,
                text: '',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                parent: null,
                children: [],
                isLeaf: true,
                isHidden: false,
                isError: false,
                isKeyword: false,
                tokenType: undefined,
                childForField: () => undefined,
                childrenForField: () => []
            })).toBeUndefined();
        });
    });

    describe('comment functions', () => {
        test('findCommentSyntaxNode finds comment before node', async () => {
            const doc = await parse('/* hello */ item foo');
            const item = doc.parseResult.value.items[0];
            const commentNode = findCommentSyntaxNode(item.$syntaxNode, ['ML_COMMENT']);
            expect(commentNode).toBeDefined();
            expect(commentNode!.text).toBe('/* hello */');
        });

        test('isCommentSyntaxNode identifies comment tokens', async () => {
            const doc = await parse('/* hello */ item foo');
            const item = doc.parseResult.value.items[0];
            const commentNode = findCommentSyntaxNode(item.$syntaxNode, ['ML_COMMENT']);
            expect(commentNode).toBeDefined();
            expect(isCommentSyntaxNode(commentNode!, ['ML_COMMENT'])).toBe(true);
        });

        test('findCommentSyntaxNode returns undefined when no comment', async () => {
            const doc = await parse('item foo');
            const item = doc.parseResult.value.items[0];
            const commentNode = findCommentSyntaxNode(item.$syntaxNode, ['ML_COMMENT']);
            expect(commentNode).toBeUndefined();
        });

        test('returns undefined for undefined input', () => {
            expect(findCommentSyntaxNode(undefined, ['ML_COMMENT'])).toBeUndefined();
        });
    });

    describe('navigation functions', () => {
        test('getPreviousSyntaxNode finds previous sibling', async () => {
            const doc = await parse('item foo');
            const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
            const leaves = flattenSyntaxTree(rootSyntaxNode).toArray();
            // Find 'foo' leaf and get previous
            const fooLeaf = leaves.find(l => l.text === 'foo');
            expect(fooLeaf).toBeDefined();
            const prev = getPreviousSyntaxNode(fooLeaf!);
            expect(prev).toBeDefined();
        });

        test('getNextSyntaxNode finds next sibling', async () => {
            const doc = await parse('item foo 42');
            const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
            const leaves = flattenSyntaxTree(rootSyntaxNode).toArray();
            const fooLeaf = leaves.find(l => l.text === 'foo');
            expect(fooLeaf).toBeDefined();
            const next = getNextSyntaxNode(fooLeaf!);
            expect(next).toBeDefined();
        });
    });
});
