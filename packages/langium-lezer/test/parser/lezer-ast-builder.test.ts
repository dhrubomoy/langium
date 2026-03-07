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
    OPTIONAL_GRAMMAR
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

// --- Helpers ---

async function parseDocument(shared: LangiumSharedCoreServices, text: string): Promise<LangiumDocument> {
    const uri = URI.parse('memory:/test.txt');
    const doc = shared.workspace.LangiumDocumentFactory.fromString(text, uri);
    shared.workspace.LangiumDocuments.addDocument(doc);
    await shared.workspace.DocumentBuilder.build([doc], { validation: false });
    return doc;
}
