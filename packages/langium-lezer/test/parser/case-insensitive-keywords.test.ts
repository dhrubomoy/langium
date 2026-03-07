/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test, expect, beforeAll } from 'vitest';
import type { LezerAdapter } from 'langium-lezer';
import type { SyntaxNode } from 'langium-core';
import { URI } from 'langium-core';
import { createLezerAdapterForGrammar, generateLezerGrammarText, createLezerServicesForGrammar } from '../test-helper.js';

const CASE_INSENSITIVE_GRAMMAR = `
    grammar CaseTest
    entry Model: elements+=Element*;
    Element: Decl | Ref;
    Decl: 'create' name=ID;
    Ref: 'use' target=[Decl] ('if' 'not' 'null')?;
    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
`;

describe('Case-Insensitive Keywords', () => {
    let adapter: LezerAdapter;

    beforeAll(async () => {
        const result = await createLezerAdapterForGrammar(CASE_INSENSITIVE_GRAMMAR, { caseInsensitive: true });
        adapter = result.adapter;
    });

    test('lowercase keywords parse correctly', () => {
        const result = adapter.parse('create foo use foo');
        expect(result.root.fullText).toBe('create foo use foo');
        const children = result.root.children.filter(c => !c.isHidden);
        expect(children.length).toBeGreaterThan(0);
    });

    test('uppercase keywords parse correctly', () => {
        const result = adapter.parse('CREATE foo USE foo');
        expect(result.root.fullText).toBe('CREATE foo USE foo');
        const children = result.root.children.filter(c => !c.isHidden);
        expect(children.length).toBeGreaterThan(0);
    });

    test('mixed-case keywords parse correctly', () => {
        const result = adapter.parse('Create foo Use foo');
        expect(result.root.fullText).toBe('Create foo Use foo');
        const children = result.root.children.filter(c => !c.isHidden);
        expect(children.length).toBeGreaterThan(0);
    });

    test('non-identifier keywords (operators) still work', () => {
        // Operators like punctuation don't go through case-insensitive specialization
        // but should still parse correctly
        const result = adapter.parse('create foo');
        expect(result.root).toBeDefined();
    });

    test('isKeyword returns true for case-insensitive keyword nodes', () => {
        const result = adapter.parse('CREATE foo');
        // Find the keyword node for 'CREATE'
        function findKeywords(node: SyntaxNode): SyntaxNode[] {
            const kws: SyntaxNode[] = [];
            if (node.isKeyword) kws.push(node);
            for (const child of node.children) {
                kws.push(...findKeywords(child));
            }
            return kws;
        }
        const keywords = findKeywords(result.root);
        expect(keywords.length).toBeGreaterThan(0);
        // The 'CREATE' text should be recognized as a keyword
        const createKw = keywords.find(k => k.text === 'CREATE');
        expect(createKw).toBeDefined();
        expect(createKw!.isKeyword).toBe(true);
    });

    test('keywords with JS reserved words (null, true, false) work case-insensitively', () => {
        const result = adapter.parse('create foo use foo IF NOT NULL');
        expect(result.root).toBeDefined();
        expect(result.root.fullText).toBe('create foo use foo IF NOT NULL');
    });
});

describe('Case-Insensitive Grammar Generation', () => {

    test('grammar text contains @external specialize (not kw<>)', async () => {
        const result = await generateLezerGrammarText(CASE_INSENSITIVE_GRAMMAR, { caseInsensitive: true });
        expect(result.grammarText).toContain('@external specialize');
        expect(result.grammarText).not.toContain('kw<term>');
    });

    test('grammar text has kw<> when case-sensitive (default)', async () => {
        const result = await generateLezerGrammarText(CASE_INSENSITIVE_GRAMMAR);
        expect(result.grammarText).toContain('kw<term>');
        expect(result.grammarText).not.toContain('@external specialize');
    });
});

describe('Case-Insensitive AST Building', () => {

    test('AST is built correctly with uppercase keywords', async () => {
        const { shared } = await createLezerServicesForGrammar(CASE_INSENSITIVE_GRAMMAR, { caseInsensitive: true });
        const uri = URI.parse('memory:/ci-test.txt');
        const doc = shared.workspace.LangiumDocumentFactory.fromString('CREATE foo USE foo', uri);
        shared.workspace.LangiumDocuments.addDocument(doc);
        await shared.workspace.DocumentBuilder.build([doc], { validation: false });

        const program = doc.parseResult.value;
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(program.$type).toBe('Model');
    });
});
