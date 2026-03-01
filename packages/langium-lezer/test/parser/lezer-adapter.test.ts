/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test, expect, beforeAll } from 'vitest';
import type { LezerAdapter } from 'langium-lezer';
import { LIST_GRAMMAR, createLezerAdapterForGrammar } from '../test-helper.js';

describe('LezerAdapter', () => {
    let adapter: LezerAdapter;

    beforeAll(async () => {
        const result = await createLezerAdapterForGrammar(LIST_GRAMMAR);
        adapter = result.adapter;
    });

    test('adapter is registered', () => {
        expect(adapter).toBeDefined();
    });

    test('name is "lezer"', () => {
        expect(adapter.name).toBe('lezer');
    });

    test('supportsIncremental is true', () => {
        expect(adapter.supportsIncremental).toBe(true);
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

    test('parse result has no diagnostics for valid input with items', () => {
        const result = adapter.parse('model foo item bar item baz');
        expect(result.root.diagnostics).toHaveLength(0);
    });

    test('parse result has diagnostics for invalid input', () => {
        const result = adapter.parse('invalid input');
        expect(result.root.diagnostics.length).toBeGreaterThan(0);
    });

    test('parse diagnostics have correct structure', () => {
        const result = adapter.parse('invalid');
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

    test('parse result root offset is 0', () => {
        const result = adapter.parse('model foo');
        expect(result.root.offset).toBe(0);
    });

    test('parse result root end equals text length', () => {
        const text = 'model foo item bar';
        const result = adapter.parse(text);
        expect(result.root.end).toBe(text.length);
    });

    test('parse returns incrementalState', () => {
        const result = adapter.parse('model foo');
        expect(result.incrementalState).toBeDefined();
    });

    test('parseIncremental returns valid result', () => {
        const original = 'model foo';
        const result1 = adapter.parse(original);

        const edited = 'model foobar';
        const changes = [{ rangeOffset: 9, rangeLength: 0, text: 'bar' }];

        const result2 = adapter.parseIncremental!(edited, result1.incrementalState!, changes);
        expect(result2.root).toBeDefined();
        expect(result2.root.fullText).toBe(edited);
        expect(result2.root.diagnostics).toHaveLength(0);
    });

    test('parseIncremental returns new incrementalState', () => {
        const result1 = adapter.parse('model foo');
        const result2 = adapter.parseIncremental!('model foobar', result1.incrementalState!, [
            { rangeOffset: 9, rangeLength: 0, text: 'bar' }
        ]);
        expect(result2.incrementalState).toBeDefined();
    });

    test('getExpectedTokens returns token array', () => {
        const tokens = adapter.getExpectedTokens('model ', 6);
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);
    });

    test('getExpectedTokens at offset 0 returns tokens', () => {
        const tokens = adapter.getExpectedTokens('', 0);
        expect(Array.isArray(tokens)).toBe(true);
    });

    test('dispose does not throw', () => {
        expect(() => adapter.dispose?.()).not.toThrow();
    });
});
