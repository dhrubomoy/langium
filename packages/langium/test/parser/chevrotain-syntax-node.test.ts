/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test, expect, beforeAll } from 'vitest';
import type { AstNode, SyntaxNode } from 'langium';
import { wrapCstNode, wrapRootCstNode } from 'langium';

import { createServicesForGrammar } from 'langium/grammar';
import { parseHelper } from 'langium/test';

const grammar = `
    grammar Test
    entry Model: 'model' name=ID items+=Item*;
    Item: 'item' name=ID value=INT?;
    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
    terminal INT returns number: /[0-9]+/;
`;

interface Model extends AstNode {
    name: string;
    items: Item[];
}

interface Item extends AstNode {
    name: string;
    value?: number;
}

/** Duck-type check for ChevrotainSyntaxNode (avoids module resolution issues in tests) */
function isChevrotainSyntaxNode(node: SyntaxNode): boolean {
    return 'underlyingCstNode' in node;
}

describe('ChevrotainSyntaxNode', () => {
    let parse: ReturnType<typeof parseHelper<Model>>;

    beforeAll(async () => {
        const services = await createServicesForGrammar({ grammar });
        parse = parseHelper<Model>(services);
    });

    test('$syntaxNode is populated on parsed AstNode', async () => {
        const doc = await parse('model foo');
        const root = doc.parseResult.value;
        expect(root.$syntaxNode).toBeDefined();
        expect(isChevrotainSyntaxNode(root.$syntaxNode!)).toBe(true);
    });

    test('root SyntaxNode wraps the AST node CstNode', async () => {
        const doc = await parse('model foo');
        const root = doc.parseResult.value;
        const rootSyntaxNode = root.$syntaxNode;
        expect(rootSyntaxNode).toBeDefined();
        // $syntaxNode wraps $cstNode; positional data should be present
        expect(rootSyntaxNode!.offset).toBeGreaterThanOrEqual(0);
        expect(rootSyntaxNode!.text).toContain('model');
    });

    test('wrapCstNode returns same instance for same CstNode (identity)', async () => {
        const doc = await parse('model foo');
        const cstNode = doc.parseResult.value.$cstNode!;
        const a = wrapCstNode(cstNode);
        const b = wrapCstNode(cstNode);
        expect(a).toBe(b);
    });

    test('positional data matches underlying CstNode', async () => {
        const doc = await parse('model foo');
        const cstNode = doc.parseResult.value.$cstNode!;
        const syntaxNode = wrapCstNode(cstNode);
        expect(syntaxNode.offset).toBe(cstNode.offset);
        expect(syntaxNode.end).toBe(cstNode.end);
        expect(syntaxNode.length).toBe(cstNode.length);
        expect(syntaxNode.text).toBe(cstNode.text);
        expect(syntaxNode.range).toEqual(cstNode.range);
    });

    test('children are lazily computed and cached', async () => {
        const doc = await parse('model foo item bar');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        const children1 = rootSyntaxNode.children;
        const children2 = rootSyntaxNode.children;
        expect(children1).toBe(children2); // same reference (cached)
        expect(children1.length).toBeGreaterThan(0);
    });

    test('isLeaf returns true for token nodes', async () => {
        const doc = await parse('model foo');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        const leaves = findLeaves(rootSyntaxNode);
        expect(leaves.length).toBeGreaterThan(0);
        for (const leaf of leaves) {
            expect(leaf.isLeaf).toBe(true);
            expect(leaf.children.length).toBe(0);
        }
    });

    test('isLeaf returns false for composite nodes', async () => {
        const doc = await parse('model foo');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        expect(rootSyntaxNode.isLeaf).toBe(false);
    });

    test('isKeyword returns true for keyword tokens', async () => {
        const doc = await parse('model foo');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        const leaves = findLeaves(rootSyntaxNode);
        const modelKeyword = leaves.find(l => l.text === 'model');
        expect(modelKeyword).toBeDefined();
        expect(modelKeyword!.isKeyword).toBe(true);
    });

    test('isKeyword returns false for non-keyword tokens', async () => {
        const doc = await parse('model foo');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        const leaves = findLeaves(rootSyntaxNode);
        const idToken = leaves.find(l => l.text === 'foo');
        expect(idToken).toBeDefined();
        expect(idToken!.isKeyword).toBe(false);
    });

    test('tokenType returns token name for leaf nodes', async () => {
        const doc = await parse('model foo');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        const leaves = findLeaves(rootSyntaxNode);
        const idToken = leaves.find(l => l.text === 'foo');
        expect(idToken).toBeDefined();
        expect(idToken!.tokenType).toBe('ID');
    });

    test('tokenType returns undefined for composite nodes', async () => {
        const doc = await parse('model foo');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        expect(rootSyntaxNode.tokenType).toBeUndefined();
    });

    test('parent is correctly set', async () => {
        const doc = await parse('model foo');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        for (const child of rootSyntaxNode.children) {
            expect(child.parent).toBeDefined();
        }
    });

    test('type is derived from grammarSource', async () => {
        const doc = await parse('model foo');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        expect(typeof rootSyntaxNode.type).toBe('string');
    });

    test('childForField returns node for assignment', async () => {
        const doc = await parse('model foo');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        const nameNode = rootSyntaxNode.childForField('name');
        expect(nameNode).toBeDefined();
        expect(nameNode!.text).toBe('foo');
    });

    test('childrenForField returns nodes for list assignment', async () => {
        const doc = await parse('model foo item bar item baz');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        const itemNodes = rootSyntaxNode.childrenForField('items');
        expect(itemNodes.length).toBe(2);
    });

    test('childForField returns undefined for non-existent field', async () => {
        const doc = await parse('model foo');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        const node = rootSyntaxNode.childForField('nonExistent');
        expect(node).toBeUndefined();
    });

    test('childrenForField returns empty for leaf nodes', async () => {
        const doc = await parse('model foo');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        const leaves = findLeaves(rootSyntaxNode);
        expect(leaves[0].childrenForField('anything')).toEqual([]);
    });

    test('underlyingCstNode provides bridge access', async () => {
        const doc = await parse('model foo');
        const rootSyntaxNode = doc.parseResult.value.$syntaxNode!;
        expect(isChevrotainSyntaxNode(rootSyntaxNode)).toBe(true);
        const underlyingCst = (rootSyntaxNode as any).underlyingCstNode;
        expect(underlyingCst).toBeDefined();
        expect(underlyingCst).toBe(doc.parseResult.value.$cstNode);
    });
});

describe('ChevrotainRootSyntaxNode', () => {
    let parse: ReturnType<typeof parseHelper<Model>>;

    beforeAll(async () => {
        const services = await createServicesForGrammar({ grammar });
        parse = parseHelper<Model>(services);
    });

    test('diagnostics default to empty', async () => {
        const doc = await parse('model foo');
        const rootCstNode = doc.parseResult.value.$cstNode!.root;
        const rootSyntaxNode = wrapRootCstNode(rootCstNode);
        expect(rootSyntaxNode.diagnostics).toEqual([]);
    });

    test('fullText matches root CstNode fullText', async () => {
        const text = 'model foo item bar';
        const doc = await parse(text);
        const rootCstNode = doc.parseResult.value.$cstNode!.root;
        const rootSyntaxNode = wrapRootCstNode(rootCstNode);
        expect(rootSyntaxNode.fullText).toBe(text);
    });

    test('setDiagnostics populates diagnostics', async () => {
        const doc = await parse('model foo');
        const rootCstNode = doc.parseResult.value.$cstNode!.root;
        const rootSyntaxNode = wrapRootCstNode(rootCstNode);
        rootSyntaxNode.setDiagnostics([
            { message: 'test error', offset: 0, length: 5, severity: 'error', source: 'parser' }
        ]);
        expect(rootSyntaxNode.diagnostics).toHaveLength(1);
        expect(rootSyntaxNode.diagnostics[0].message).toBe('test error');
    });
});

/** Utility: find all leaf SyntaxNodes in a tree */
function findLeaves(node: SyntaxNode): SyntaxNode[] {
    if (node.isLeaf) return [node];
    const leaves: SyntaxNode[] = [];
    for (const child of node.children) {
        leaves.push(...findLeaves(child));
    }
    return leaves;
}
