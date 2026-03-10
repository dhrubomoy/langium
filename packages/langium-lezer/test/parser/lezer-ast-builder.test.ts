/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { isReference, URI } from 'langium-core';
import type { GenericAstNode, Reference, LangiumDocument, LangiumSharedCoreServices } from 'langium-core';
import {
    createLezerServicesForGrammar,
    SIMPLE_GRAMMAR,
    LIST_GRAMMAR,
    ALTERNATIVES_GRAMMAR,
    ALTERNATIVE_RULE_GRAMMAR,
    CROSS_REF_GRAMMAR,
    OPTIONAL_GRAMMAR,
    INFER_ACTION_GRAMMAR,
    CHAINING_ACTION_GRAMMAR,
    INFIX_RULE_GRAMMAR,
    LEAF_NODE_FIX_GRAMMAR
} from '../test-helper.js';

/**
 * Tests for the SyntaxNodeAstBuilder — verifies that the Lezer backend
 * produces correct ASTs via the post-parse AST builder pipeline.
 */
describe('SyntaxNodeAstBuilder via Lezer', () => {

    test('simple grammar: Model with name', async () => {
        const { shared } = await createLezerServicesForGrammar(SIMPLE_GRAMMAR);
        const doc = await parseDocument(shared, 'model foo');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(ast.$type).toBe('Model');
        expect(ast.name).toBe('foo');
        expect(ast.$syntaxNode).toBeDefined();
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(doc.parseResult.lexerErrors).toHaveLength(0);
    });

    test('list grammar: Model with items', async () => {
        const { shared } = await createLezerServicesForGrammar(LIST_GRAMMAR);
        const doc = await parseDocument(shared, 'model myModel item a item b item c');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(ast.$type).toBe('Model');
        expect(ast.name).toBe('myModel');
        expect(Array.isArray(ast.items)).toBe(true);
        const items = ast.items as GenericAstNode[];
        expect(items).toHaveLength(3);
        expect(items[0].$type).toBe('Item');
        expect(items[0].name).toBe('a');
        expect(items[1].name).toBe('b');
        expect(items[2].name).toBe('c');
    });

    test('list grammar: container properties set correctly', async () => {
        const { shared } = await createLezerServicesForGrammar(LIST_GRAMMAR);
        const doc = await parseDocument(shared, 'model myModel item a item b');
        const ast = doc.parseResult.value as GenericAstNode;

        const items = ast.items as GenericAstNode[];
        expect(items[0].$container).toBe(ast);
        expect(items[0].$containerProperty).toBe('items');
        expect(items[0].$containerIndex).toBe(0);
        expect(items[1].$containerIndex).toBe(1);
    });

    test('optional grammar: present optional', async () => {
        const { shared } = await createLezerServicesForGrammar(OPTIONAL_GRAMMAR);
        const doc = await parseDocument(shared, 'person Alice 30');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(ast.$type).toBe('Person');
        expect(ast.name).toBe('Alice');
        expect(ast.age).toBe(30); // INT should be converted to number
    });

    test('optional grammar: absent optional', async () => {
        const { shared } = await createLezerServicesForGrammar(OPTIONAL_GRAMMAR);
        const doc = await parseDocument(shared, 'person Bob');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(ast.$type).toBe('Person');
        expect(ast.name).toBe('Bob');
        expect(ast.age).toBeUndefined();
    });

    test('cross-reference grammar: Reference created', async () => {
        const { shared } = await createLezerServicesForGrammar(CROSS_REF_GRAMMAR);
        const doc = await parseDocument(shared, 'entity Base entity Child extends Base');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(ast.$type).toBe('Model');
        const entities = ast.entities as GenericAstNode[];
        expect(entities).toHaveLength(2);

        expect(entities[0].name).toBe('Base');
        expect(entities[1].name).toBe('Child');

        // superType should be a Reference
        const ref = entities[1].superType;
        expect(isReference(ref)).toBe(true);
        expect((ref as Reference).$refText).toBe('Base');
        expect((ref as Reference).$refSyntaxNode).toBeDefined();
    });

    test('$syntaxNode set on all AstNodes', async () => {
        const { shared } = await createLezerServicesForGrammar(LIST_GRAMMAR);
        const doc = await parseDocument(shared, 'model test item x');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(ast.$syntaxNode).toBeDefined();
        const items = ast.items as GenericAstNode[];
        expect(items[0].$syntaxNode).toBeDefined();
    });

    test('alternatives in assignment: correct $type per element', async () => {
        const { shared } = await createLezerServicesForGrammar(ALTERNATIVES_GRAMMAR);
        const doc = await parseDocument(shared, 'a foo b 42 a bar');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(ast.$type).toBe('Root');
        const elements = ast.elements as GenericAstNode[];
        expect(elements).toHaveLength(3);
        expect(elements[0].$type).toBe('A');
        expect(elements[0].name).toBe('foo');
        expect(elements[1].$type).toBe('B');
        expect(elements[1].value).toBe(42);
        expect(elements[2].$type).toBe('A');
        expect(elements[2].name).toBe('bar');
    });

    test('pure alternative rule: Element: Person | Greeting', async () => {
        const { shared } = await createLezerServicesForGrammar(ALTERNATIVE_RULE_GRAMMAR);
        const doc = await parseDocument(shared, 'person Alice hello Bob !');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(ast.$type).toBe('Model');
        const elements = ast.elements as GenericAstNode[];
        expect(elements).toHaveLength(2);

        // First element should be a Person (through Element alternative)
        expect(elements[0].$type).toBe('Person');
        expect(elements[0].name).toBe('Alice');

        // Second element should be a Greeting (through Element alternative)
        expect(elements[1].$type).toBe('Greeting');
        expect(elements[1].target).toBe('Bob');
    });

    test('pure alternative rule: $syntaxNode and $container set correctly', async () => {
        const { shared } = await createLezerServicesForGrammar(ALTERNATIVE_RULE_GRAMMAR);
        const doc = await parseDocument(shared, 'person Alice');
        const ast = doc.parseResult.value as GenericAstNode;

        const elements = ast.elements as GenericAstNode[];
        expect(elements[0].$type).toBe('Person');
        expect(elements[0].$syntaxNode).toBeDefined();
        expect(elements[0].$container).toBe(ast);
        expect(elements[0].$containerProperty).toBe('elements');
    });

    test('pure alternative rule: findAstNode maps child SyntaxNode correctly', async () => {
        const { shared, parser } = await createLezerServicesForGrammar(ALTERNATIVE_RULE_GRAMMAR);
        const doc = await parseDocument(shared, 'person Alice');
        const ast = doc.parseResult.value as GenericAstNode;

        const elements = ast.elements as GenericAstNode[];
        const person = elements[0];
        // The SyntaxNode should map back to the correct AstNode
        const astBuilder = parser.parser.SyntaxNodeAstBuilder;
        const foundNode = astBuilder.findAstNode(person.$syntaxNode!);
        expect(foundNode).toBe(person);
    });

    test('empty items array for list rule with no items', async () => {
        const { shared } = await createLezerServicesForGrammar(LIST_GRAMMAR);
        const doc = await parseDocument(shared, 'model empty');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(ast.$type).toBe('Model');
        expect(ast.name).toBe('empty');
        expect(Array.isArray(ast.items)).toBe(true);
        expect(ast.items).toHaveLength(0);
    });
});

/**
 * Tests for {infer X} type-only actions — verifies that the builder
 * resolves the correct $type based on populated fields.
 */
describe('Infer action type resolution', () => {

    test('{infer TypeA} with name and value', async () => {
        const { shared } = await createLezerServicesForGrammar(INFER_ACTION_GRAMMAR);
        const doc = await parseDocument(shared, 'a foo 42');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const elements = ast.elements as GenericAstNode[];
        expect(elements).toHaveLength(1);
        expect(elements[0].$type).toBe('TypeA');
        expect(elements[0].name).toBe('foo');
        expect(elements[0].value).toBe(42);
    });

    test('{infer TypeB} with name only', async () => {
        const { shared } = await createLezerServicesForGrammar(INFER_ACTION_GRAMMAR);
        const doc = await parseDocument(shared, 'b bar');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const elements = ast.elements as GenericAstNode[];
        expect(elements).toHaveLength(1);
        expect(elements[0].$type).toBe('TypeB');
        expect(elements[0].name).toBe('bar');
    });

    test('{infer TypeC} keyword-only alternative', async () => {
        const { shared } = await createLezerServicesForGrammar(INFER_ACTION_GRAMMAR);
        const doc = await parseDocument(shared, 'c');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const elements = ast.elements as GenericAstNode[];
        expect(elements).toHaveLength(1);
        expect(elements[0].$type).toBe('TypeC');
    });

    test('multiple infer alternatives in same document', async () => {
        const { shared } = await createLezerServicesForGrammar(INFER_ACTION_GRAMMAR);
        const doc = await parseDocument(shared, 'a x 1 b y c');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const elements = ast.elements as GenericAstNode[];
        expect(elements).toHaveLength(3);
        expect(elements[0].$type).toBe('TypeA');
        expect(elements[1].$type).toBe('TypeB');
        expect(elements[2].$type).toBe('TypeC');
    });
});

/**
 * Tests for {infer X.prop=current} chaining actions — verifies that
 * flat Lezer nodes are restructured into nested chains.
 */
describe('Chaining action support', () => {

    test('single element: no chaining needed', async () => {
        const { shared } = await createLezerServicesForGrammar(CHAINING_ACTION_GRAMMAR);
        const doc = await parseDocument(shared, 'foo');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const refs = ast.refs as GenericAstNode[];
        expect(refs).toHaveLength(1);
        expect(refs[0].$type).toBe('QualifiedRef');
        expect(refs[0].element).toBe('foo');
        expect(refs[0].previous).toBeUndefined();
    });

    test('two elements: one level of chaining', async () => {
        const { shared } = await createLezerServicesForGrammar(CHAINING_ACTION_GRAMMAR);
        const doc = await parseDocument(shared, 'a.b');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const refs = ast.refs as GenericAstNode[];
        expect(refs).toHaveLength(1);

        const outer = refs[0];
        expect(outer.$type).toBe('QualifiedRef');
        expect(outer.element).toBe('b');
        expect(outer.previous).toBeDefined();

        const inner = outer.previous as GenericAstNode;
        expect(inner.$type).toBe('QualifiedRef');
        expect(inner.element).toBe('a');
        expect(inner.previous).toBeUndefined();
    });

    test('three elements: two levels of chaining', async () => {
        const { shared } = await createLezerServicesForGrammar(CHAINING_ACTION_GRAMMAR);
        const doc = await parseDocument(shared, 'x.y.z');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const refs = ast.refs as GenericAstNode[];
        expect(refs).toHaveLength(1);

        const outer = refs[0];
        expect(outer.$type).toBe('QualifiedRef');
        expect(outer.element).toBe('z');

        const middle = outer.previous as GenericAstNode;
        expect(middle.$type).toBe('QualifiedRef');
        expect(middle.element).toBe('y');

        const inner = middle.previous as GenericAstNode;
        expect(inner.$type).toBe('QualifiedRef');
        expect(inner.element).toBe('x');
        expect(inner.previous).toBeUndefined();
    });

    test('container properties set correctly on chain', async () => {
        const { shared } = await createLezerServicesForGrammar(CHAINING_ACTION_GRAMMAR);
        const doc = await parseDocument(shared, 'a.b');
        const ast = doc.parseResult.value as GenericAstNode;

        const refs = ast.refs as GenericAstNode[];
        const outer = refs[0];
        const inner = outer.previous as GenericAstNode;

        expect(inner.$container).toBe(outer);
        expect(inner.$containerProperty).toBe('previous');
    });
});

/**
 * Tests for infix rule support — verifies that binary expressions are built
 * with operators extracted from source text.
 */
describe('Infix rule support', () => {

    test('simple binary expression: 1 + 2', async () => {
        const { shared } = await createLezerServicesForGrammar(INFIX_RULE_GRAMMAR);
        const doc = await parseDocument(shared, '1 + 2');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const expr = ast.expr as GenericAstNode;
        expect(expr.$type).toBe('BinaryExpression');
        expect(expr.operator).toBe('+');

        const left = expr.left as GenericAstNode;
        expect(left.$type).toBe('Primary');
        expect(left.value).toBe(1);

        const right = expr.right as GenericAstNode;
        expect(right.$type).toBe('Primary');
        expect(right.value).toBe(2);
    });

    test('precedence: 1 + 2 * 3', async () => {
        const { shared } = await createLezerServicesForGrammar(INFIX_RULE_GRAMMAR);
        const doc = await parseDocument(shared, '1 + 2 * 3');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const expr = ast.expr as GenericAstNode;
        expect(expr.$type).toBe('BinaryExpression');
        expect(expr.operator).toBe('+');

        // Left is 1 (Primary)
        const left = expr.left as GenericAstNode;
        expect(left.$type).toBe('Primary');
        expect(left.value).toBe(1);

        // Right is 2 * 3 (BinaryExpression with higher precedence)
        const right = expr.right as GenericAstNode;
        expect(right.$type).toBe('BinaryExpression');
        expect(right.operator).toBe('*');
    });

    test('single value: no binary expression', async () => {
        const { shared } = await createLezerServicesForGrammar(INFIX_RULE_GRAMMAR);
        const doc = await parseDocument(shared, '42');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const expr = ast.expr as GenericAstNode;
        // Single value should pass through to Primary via inlining
        expect(expr.$type).toBe('Primary');
        expect(expr.value).toBe(42);
    });

    test('container properties set on binary expression children', async () => {
        const { shared } = await createLezerServicesForGrammar(INFIX_RULE_GRAMMAR);
        const doc = await parseDocument(shared, '1 + 2');
        const ast = doc.parseResult.value as GenericAstNode;

        const expr = ast.expr as GenericAstNode;
        const left = expr.left as GenericAstNode;
        const right = expr.right as GenericAstNode;

        expect(left.$container).toBe(expr);
        expect(left.$containerProperty).toBe('left');
        expect(right.$container).toBe(expr);
        expect(right.$containerProperty).toBe('right');
    });
});

/**
 * Tests for the leaf node fix — verifies that Lezer nodes with only
 * anonymous children are correctly treated as composite nodes.
 */
describe('Leaf node fix', () => {

    test('keyword-only rule treated as composite node', async () => {
        const { shared } = await createLezerServicesForGrammar(LEAF_NODE_FIX_GRAMMAR);
        const doc = await parseDocument(shared, '*');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const item = ast.item as GenericAstNode;
        // Should be an AllStar node, not a raw string "*"
        expect(typeof item).toBe('object');
        expect(item.$type).toBe('AllStar');
    });

    test('named alternative works normally', async () => {
        const { shared } = await createLezerServicesForGrammar(LEAF_NODE_FIX_GRAMMAR);
        const doc = await parseDocument(shared, 'foo');
        const ast = doc.parseResult.value as GenericAstNode;

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const item = ast.item as GenericAstNode;
        expect(typeof item).toBe('object');
        expect(item.$type).toBe('Named');
        expect(item.name).toBe('foo');
    });
});

// --- Helpers ---

async function parseDocument(shared: LangiumSharedCoreServices, text: string): Promise<LangiumDocument> {
    const uri = URI.parse('memory:/test.txt');
    const doc = shared.workspace.LangiumDocumentFactory.fromString(text, uri);
    shared.workspace.LangiumDocuments.addDocument(doc);
    await shared.workspace.DocumentBuilder.build([doc], { validation: false });
    return doc;
}
