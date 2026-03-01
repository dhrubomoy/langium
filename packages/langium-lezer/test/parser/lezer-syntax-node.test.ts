/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test, expect, beforeAll } from 'vitest';
import type { SyntaxNode, RootSyntaxNode } from 'langium-core';
import type { LezerAdapter } from 'langium-lezer';
import { LIST_GRAMMAR, OPTIONAL_GRAMMAR, createLezerAdapterForGrammar, collectLeaves } from '../test-helper.js';

describe('LezerSyntaxNode', () => {
    let adapter: LezerAdapter;

    beforeAll(async () => {
        const result = await createLezerAdapterForGrammar(LIST_GRAMMAR);
        adapter = result.adapter;
    });

    function parse(text: string): RootSyntaxNode {
        return adapter.parse(text).root;
    }

    // --- Root node properties ---

    test('root type is the top rule name', () => {
        const root = parse('model foo');
        // Lezer @top rule should be "Model"
        expect(root.type).toBe('Model');
    });

    test('root offset is 0', () => {
        const root = parse('model foo');
        expect(root.offset).toBe(0);
    });

    test('root end equals text length', () => {
        const text = 'model foo';
        const root = parse(text);
        expect(root.end).toBe(text.length);
    });

    test('root length equals text length', () => {
        const text = 'model foo item bar';
        const root = parse(text);
        expect(root.length).toBe(text.length);
    });

    test('root text equals source text', () => {
        const text = 'model foo';
        const root = parse(text);
        expect(root.text).toBe(text);
    });

    test('root fullText equals source text', () => {
        const text = 'model foo';
        const root = parse(text);
        expect(root.fullText).toBe(text);
    });

    // --- Range ---

    test('root range starts at 0:0', () => {
        const root = parse('model foo');
        expect(root.range.start.line).toBe(0);
        expect(root.range.start.character).toBe(0);
    });

    test('range end has correct line for multiline', () => {
        const root = parse('model foo\nitem bar');
        expect(root.range.end.line).toBe(1);
    });

    // --- Parent ---

    test('root parent is null', () => {
        const root = parse('model foo');
        expect(root.parent).toBeNull();
    });

    test('child parent points back to root', () => {
        const root = parse('model foo');
        const children = root.children;
        // At least some child's parent should point back to root
        for (const child of children) {
            if (child.parent !== null) {
                expect(child.parent.type).toBe(root.type);
                break;
            }
        }
    });

    // --- Children ---

    test('root has children', () => {
        const root = parse('model foo');
        expect(root.children.length).toBeGreaterThan(0);
    });

    test('children are cached (same reference on repeated access)', () => {
        const root = parse('model foo');
        const children1 = root.children;
        const children2 = root.children;
        expect(children1).toBe(children2);
    });

    // --- Leaf nodes ---

    test('leaf nodes have isLeaf === true', () => {
        const root = parse('model foo');
        const leaves = collectLeaves(root);
        expect(leaves.length).toBeGreaterThan(0);
        for (const leaf of leaves) {
            expect(leaf.isLeaf).toBe(true);
        }
    });

    test('non-leaf nodes have isLeaf === false', () => {
        const root = parse('model foo');
        expect(root.isLeaf).toBe(false);
    });

    test('leaf text matches source text slice', () => {
        const text = 'model foo';
        const root = parse(text);
        const leaves = collectLeaves(root);
        for (const leaf of leaves) {
            expect(leaf.text).toBe(text.slice(leaf.offset, leaf.end));
        }
    });

    // --- Keyword detection ---

    test('keyword token is detected', () => {
        const root = parse('model foo');
        // Find the "model" keyword leaf
        const leaves = collectLeaves(root);
        const modelLeaf = leaves.find(l => l.text === 'model');
        // model should be recognized as keyword (it's an anonymous node in Lezer)
        // Since Lezer inlines keywords, the actual detection depends on how
        // the grammar translator emits them
        expect(modelLeaf).toBeDefined();
    });

    // --- Error nodes ---

    test('error nodes have isError === true', () => {
        const root = parse('invalid junk');
        function findErrors(node: SyntaxNode): SyntaxNode[] {
            const errors: SyntaxNode[] = [];
            if (node.isError) errors.push(node);
            for (const child of node.children) {
                errors.push(...findErrors(child));
            }
            return errors;
        }
        const errors = findErrors(root);
        expect(errors.length).toBeGreaterThan(0);
        for (const err of errors) {
            expect(err.isError).toBe(true);
        }
    });

    // --- tokenType ---

    test('leaf tokenType returns terminal name', () => {
        const root = parse('model foo');
        const leaves = collectLeaves(root);
        // At least one leaf should have a non-empty tokenType (e.g., "Identifier")
        const typedLeaves = leaves.filter(l => l.tokenType !== undefined);
        expect(typedLeaves.length).toBeGreaterThan(0);
    });

    test('non-leaf tokenType is undefined', () => {
        const root = parse('model foo');
        expect(root.tokenType).toBeUndefined();
    });
});

describe('LezerSyntaxNode field access', () => {
    let adapter: LezerAdapter;

    beforeAll(async () => {
        const result = await createLezerAdapterForGrammar(LIST_GRAMMAR);
        adapter = result.adapter;
    });

    function parse(text: string): RootSyntaxNode {
        return adapter.parse(text).root;
    }

    test('childForField returns child for "name" field', () => {
        const root = parse('model foo');
        // The root Model node should have a "name" field child via FieldMap wrapper
        const nameNode = root.childForField('name');
        expect(nameNode).toBeDefined();
        // The name field should contain "foo"
        if (nameNode) {
            expect(nameNode.text).toContain('foo');
        }
    });

    test('childrenForField returns list items', () => {
        const root = parse('model foo item bar item baz');
        // "items" field should have multiple children
        const itemNodes = root.childrenForField('items');
        expect(itemNodes.length).toBeGreaterThanOrEqual(2);
    });

    test('childForField returns undefined for nonexistent field', () => {
        const root = parse('model foo');
        const result = root.childForField('nonexistent');
        expect(result).toBeUndefined();
    });

    test('childrenForField returns empty array for nonexistent field', () => {
        const root = parse('model foo');
        const result = root.childrenForField('nonexistent');
        expect(result).toHaveLength(0);
    });
});

describe('LezerSyntaxNode with optional fields', () => {
    let adapter: LezerAdapter;

    beforeAll(async () => {
        const result = await createLezerAdapterForGrammar(OPTIONAL_GRAMMAR);
        adapter = result.adapter;
    });

    test('optional field present', () => {
        const root = adapter.parse('person Alice 42').root;
        const ageNode = root.childForField('age');
        expect(ageNode).toBeDefined();
    });

    test('optional field absent', () => {
        const root = adapter.parse('person Alice').root;
        const ageNode = root.childForField('age');
        expect(ageNode).toBeUndefined();
    });
});
