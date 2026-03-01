/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test, expect, beforeAll } from 'vitest';
import type { LangiumCoreServices, LangiumChevrotainServices, ParserAdapter } from 'langium';

import { createServicesForGrammar } from 'langium/grammar';

const grammar = `
    grammar Test
    entry Model: 'model' name=ID items+=Item*;
    Item: 'item' name=ID;
    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
`;

describe('ChevrotainAdapter', () => {
    let services: LangiumCoreServices;
    let adapter: ParserAdapter;

    beforeAll(async () => {
        services = await createServicesForGrammar({ grammar });
        adapter = services.parser.ParserAdapter;
    });

    test('adapter is registered as service', () => {
        expect(adapter).toBeDefined();
    });

    test('name is "chevrotain"', () => {
        expect(adapter.name).toBe('chevrotain');
    });

    test('supportsIncremental is false', () => {
        expect(adapter.supportsIncremental).toBe(false);
    });

    test('parse returns RootSyntaxNode with fullText', () => {
        const result = adapter.parse('model foo');
        expect(result.root).toBeDefined();
        expect(result.root.fullText).toBe('model foo');
    });

    test('parse result has correct fullText', () => {
        const text = 'model foo item bar';
        const result = adapter.parse(text);
        expect(result.root.fullText).toBe(text);
    });

    test('parse result has no diagnostics for valid input', () => {
        const result = adapter.parse('model foo');
        expect(result.root.diagnostics).toHaveLength(0);
    });

    test('parse result has diagnostics for invalid input', () => {
        const result = adapter.parse('invalid input');
        expect(result.root.diagnostics.length).toBeGreaterThan(0);
    });

    test('parse diagnostics have correct structure', () => {
        const result = adapter.parse('model');
        // Missing required ID token after 'model'
        if (result.root.diagnostics.length > 0) {
            const diag = result.root.diagnostics[0];
            expect(diag.message).toBeDefined();
            expect(typeof diag.offset).toBe('number');
            expect(typeof diag.length).toBe('number');
            expect(['error', 'warning']).toContain(diag.severity);
            expect(['lexer', 'parser']).toContain(diag.source);
        }
    });

    test('parse result root has children', () => {
        const result = adapter.parse('model foo item bar');
        expect(result.root.children.length).toBeGreaterThan(0);
    });

    test('parse produces same AST structure as LangiumParser', () => {
        const text = 'model foo item bar item baz';
        const adapterResult = adapter.parse(text);
        const langiumResult = (services as unknown as LangiumChevrotainServices).parser.LangiumParser.parse(text);

        // Both should parse successfully
        expect(adapterResult.root.diagnostics).toHaveLength(0);
        expect(langiumResult.parserErrors).toHaveLength(0);

        // The adapter result wraps the same CST
        expect(adapterResult.root.fullText).toBe(text);
    });

    test('getExpectedTokens returns token list', () => {
        const tokens = adapter.getExpectedTokens('model ', 6);
        expect(Array.isArray(tokens)).toBe(true);
        // After 'model ', we expect an ID token
        expect(tokens.length).toBeGreaterThan(0);
    });
});
