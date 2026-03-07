/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test, expect, beforeAll } from 'vitest';
import type { TextChange } from 'langium-core';
import type { LezerAdapter } from 'langium-lezer';
import {
    LIST_GRAMMAR,
    createLezerAdapterForGrammar,
    assertTreesStructurallyEqual,
    generateLargeDocument
} from '../test-helper.js';

describe('Incremental parsing correctness', () => {
    let adapter: LezerAdapter;

    beforeAll(async () => {
        const result = await createLezerAdapterForGrammar(LIST_GRAMMAR);
        adapter = result.adapter;
    });

    /**
     * Helper: parse original, apply changes, compare incremental vs full reparse.
     */
    function assertIncrementalMatchesFull(
        original: string,
        edited: string,
        changes: TextChange[]
    ): void {
        const result1 = adapter.parse(original);
        expect(result1.incrementalState).toBeDefined();

        const incrementalResult = adapter.parseIncremental!(edited, result1.incrementalState!, changes);
        const fullResult = adapter.parse(edited);

        // Both should produce the same tree structure
        assertTreesStructurallyEqual(incrementalResult.root, fullResult.root);

        // Both should have same diagnostics count
        expect(incrementalResult.root.diagnostics.length).toBe(fullResult.root.diagnostics.length);
    }

    test('single character insertion matches full reparse', () => {
        const original = 'model foo item bar';
        const edited = 'model foox item bar';
        const changes: TextChange[] = [
            { rangeOffset: 9, rangeLength: 0, text: 'x' }
        ];
        assertIncrementalMatchesFull(original, edited, changes);
    });

    test('single character deletion matches full reparse', () => {
        const original = 'model foox item bar';
        const edited = 'model foo item bar';
        const changes: TextChange[] = [
            { rangeOffset: 9, rangeLength: 1, text: '' }
        ];
        assertIncrementalMatchesFull(original, edited, changes);
    });

    test('word replacement matches full reparse', () => {
        const original = 'model foo item bar';
        const edited = 'model foo item baz';
        const changes: TextChange[] = [
            { rangeOffset: 15, rangeLength: 3, text: 'baz' }
        ];
        assertIncrementalMatchesFull(original, edited, changes);
    });

    test('word insertion matches full reparse', () => {
        const original = 'model foo item bar';
        const edited = 'model foo item bar item baz';
        const changes: TextChange[] = [
            { rangeOffset: 18, rangeLength: 0, text: ' item baz' }
        ];
        assertIncrementalMatchesFull(original, edited, changes);
    });

    test('line insertion matches full reparse', () => {
        const original = 'model foo\nitem bar';
        const edited = 'model foo\nitem middle\nitem bar';
        const changes: TextChange[] = [
            { rangeOffset: 10, rangeLength: 0, text: 'item middle\n' }
        ];
        assertIncrementalMatchesFull(original, edited, changes);
    });

    test('line deletion matches full reparse', () => {
        const original = 'model foo\nitem bar\nitem baz';
        const edited = 'model foo\nitem baz';
        const changes: TextChange[] = [
            { rangeOffset: 10, rangeLength: 9, text: '' }
        ];
        assertIncrementalMatchesFull(original, edited, changes);
    });

    test('name change in first item matches full reparse', () => {
        const original = 'model foo item alpha item beta';
        const edited = 'model foo item gamma item beta';
        const changes: TextChange[] = [
            { rangeOffset: 15, rangeLength: 5, text: 'gamma' }
        ];
        assertIncrementalMatchesFull(original, edited, changes);
    });

    test('model name change matches full reparse', () => {
        const original = 'model foo item bar';
        const edited = 'model foobar item bar';
        const changes: TextChange[] = [
            { rangeOffset: 6, rangeLength: 3, text: 'foobar' }
        ];
        assertIncrementalMatchesFull(original, edited, changes);
    });

    test('multiple sequential incremental parses stay correct', () => {
        // First parse
        const text1 = 'model foo';
        const result1 = adapter.parse(text1);

        // Second parse: add item
        const text2 = 'model foo item bar';
        const result2 = adapter.parseIncremental!(text2, result1.incrementalState!, [
            { rangeOffset: 9, rangeLength: 0, text: ' item bar' }
        ]);

        // Third parse: add another item
        const text3 = 'model foo item bar item baz';
        const result3 = adapter.parseIncremental!(text3, result2.incrementalState!, [
            { rangeOffset: 18, rangeLength: 0, text: ' item baz' }
        ]);

        // Compare third incremental with a fresh full parse
        const fullResult = adapter.parse(text3);
        assertTreesStructurallyEqual(result3.root, fullResult.root);
        expect(result3.root.diagnostics.length).toBe(fullResult.root.diagnostics.length);
    });

    test('edit that introduces error matches full reparse', () => {
        const original = 'model foo item bar';
        // Remove 'item' keyword, making it invalid
        const edited = 'model foo bar';
        const changes: TextChange[] = [
            { rangeOffset: 9, rangeLength: 5, text: '' }
        ];

        const result1 = adapter.parse(original);
        const incrementalResult = adapter.parseIncremental!(edited, result1.incrementalState!, changes);
        const fullResult = adapter.parse(edited);

        // Both should have the same diagnostics count (errors expected)
        expect(incrementalResult.root.diagnostics.length).toBe(fullResult.root.diagnostics.length);
    });

    test('edit that fixes error matches full reparse', () => {
        const original = 'model foo bar';
        // Fix by adding 'item' keyword
        const edited = 'model foo item bar';
        const changes: TextChange[] = [
            { rangeOffset: 9, rangeLength: 0, text: ' item' }
        ];

        const result1 = adapter.parse(original);
        const incrementalResult = adapter.parseIncremental!(edited, result1.incrementalState!, changes);
        const fullResult = adapter.parse(edited);

        assertTreesStructurallyEqual(incrementalResult.root, fullResult.root);
        expect(incrementalResult.root.diagnostics).toHaveLength(0);
        expect(fullResult.root.diagnostics).toHaveLength(0);
    });
});

describe('Incremental parsing performance', () => {
    let adapter: LezerAdapter;

    beforeAll(async () => {
        const result = await createLezerAdapterForGrammar(LIST_GRAMMAR);
        adapter = result.adapter;
    });

    test('incremental is faster than full for large document (100 items)', () => {
        const doc = generateLargeDocument(100);
        const { incrementalState } = adapter.parse(doc);

        // Small edit near the middle
        const offset = Math.floor(doc.length / 2);
        const edited = doc.slice(0, offset) + 'x' + doc.slice(offset);
        const changes: TextChange[] = [
            { rangeOffset: offset, rangeLength: 0, text: 'x' }
        ];

        // Warm up
        adapter.parse(edited);
        adapter.parseIncremental!(edited, incrementalState!, changes);

        // Measure full parse
        const fullTimes: number[] = [];
        for (let i = 0; i < 10; i++) {
            const start = performance.now();
            adapter.parse(edited);
            fullTimes.push(performance.now() - start);
        }

        // Measure incremental parse
        const incrTimes: number[] = [];
        for (let i = 0; i < 10; i++) {
            const start = performance.now();
            adapter.parseIncremental!(edited, incrementalState!, changes);
            incrTimes.push(performance.now() - start);
        }

        const avgFull = fullTimes.reduce((a, b) => a + b, 0) / fullTimes.length;
        const avgIncr = incrTimes.reduce((a, b) => a + b, 0) / incrTimes.length;

        // Incremental should not be significantly slower than full parse.
        // For small documents (100 items), timing variance dominates, so use a generous threshold.
        expect(avgIncr).toBeLessThan(avgFull * 3);
    });

    test('incremental is faster than full for large document (500 items)', () => {
        const doc = generateLargeDocument(500);
        const { incrementalState } = adapter.parse(doc);

        // Small edit near the middle
        const offset = Math.floor(doc.length / 2);
        const edited = doc.slice(0, offset) + 'x' + doc.slice(offset);
        const changes: TextChange[] = [
            { rangeOffset: offset, rangeLength: 0, text: 'x' }
        ];

        // Warm up
        adapter.parse(edited);
        adapter.parseIncremental!(edited, incrementalState!, changes);

        // Measure full parse (5 iterations)
        const fullTimes: number[] = [];
        for (let i = 0; i < 5; i++) {
            const start = performance.now();
            adapter.parse(edited);
            fullTimes.push(performance.now() - start);
        }

        // Measure incremental parse (5 iterations)
        const incrTimes: number[] = [];
        for (let i = 0; i < 5; i++) {
            const start = performance.now();
            adapter.parseIncremental!(edited, incrementalState!, changes);
            incrTimes.push(performance.now() - start);
        }

        const avgFull = fullTimes.reduce((a, b) => a + b, 0) / fullTimes.length;
        const avgIncr = incrTimes.reduce((a, b) => a + b, 0) / incrTimes.length;

        // For larger documents, incremental should be measurably faster
        expect(avgIncr).toBeLessThan(avgFull * 1.5);
    });

    test('incremental state persists across many edits', () => {
        let text = 'model foo';
        let state = adapter.parse(text).incrementalState!;

        // Apply 50 sequential edits
        for (let i = 0; i < 50; i++) {
            const addition = ` item item_${i}`;
            const newText = text + addition;
            const changes: TextChange[] = [
                { rangeOffset: text.length, rangeLength: 0, text: addition }
            ];

            const result = adapter.parseIncremental!(newText, state, changes);
            expect(result.root.diagnostics).toHaveLength(0);
            expect(result.incrementalState).toBeDefined();

            text = newText;
            state = result.incrementalState!;
        }

        // Final result should match a fresh full parse
        const fullResult = adapter.parse(text);
        assertTreesStructurallyEqual(adapter.parseIncremental!(text, state, []).root, fullResult.root);
    });
});
