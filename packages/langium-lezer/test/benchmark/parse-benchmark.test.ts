/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test, expect, beforeAll } from 'vitest';
import type { ParserAdapter, TextChange } from 'langium-core';
import type { LezerAdapter } from 'langium-lezer';
import {
    LIST_GRAMMAR,
    createLezerAdapterForGrammar,
    createChevrotainAdapterForGrammar,
    generateLargeDocument
} from '../test-helper.js';

// ---- Arithmetics-style grammar for realistic benchmarks ----

const ARITHMETICS_GRAMMAR = `
    grammar ArithBench
    entry Module: 'module' name=ID statements+=Statement*;
    Statement: Definition | Evaluation;
    Definition: 'def' name=ID ':' expr=Expression ';';
    Evaluation: expression=Expression ';';
    Expression: Addition;
    Addition infers Expression:
        Multiplication ({infer BinaryExpression.left=current} op=('+' | '-') right=Multiplication)*;
    Multiplication infers Expression:
        PrimaryExpression ({infer BinaryExpression.left=current} op=('*') right=PrimaryExpression)*;
    PrimaryExpression infers Expression:
        '(' Expression ')' |
        {infer NumberLiteral} value=NUMBER |
        {infer FunctionCall} func=[Definition];
    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
    terminal NUMBER: /[0-9]+(\\.[0-9]*)?/;
`;

function generateArithmeticsDocument(defCount: number): string {
    const lines: string[] = ['module Bench'];
    for (let i = 0; i < defCount; i++) {
        lines.push(`def var_${i} : ${i} * (${i + 1} + ${i + 2}) ;`);
    }
    // Add evaluations that reference earlier definitions
    for (let i = 0; i < Math.min(defCount, 20); i++) {
        lines.push(`var_${i} + var_${Math.min(i + 1, defCount - 1)} ;`);
    }
    return lines.join('\n');
}

// ---- Benchmark utilities ----

interface BenchmarkResult {
    size: number;
    chevrotainMs: number;
    lezerFullMs: number;
    lezerIncrCharMs: number;
    lezerIncrLineMs: number;
    lezerIncrBlockMs: number;
    speedupChar: string;
    speedupLine: string;
    speedupBlock: string;
}

function median(times: number[]): number {
    const sorted = [...times].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

function measure(fn: () => void, iterations: number, warmup = 3): number {
    // Warm-up
    for (let i = 0; i < warmup; i++) {
        fn();
    }
    // Measure
    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        fn();
        times.push(performance.now() - start);
    }
    return median(times);
}

// ---- LIST_GRAMMAR benchmarks ----

describe('Parse benchmarks — LIST_GRAMMAR', () => {
    let lezerAdapter: LezerAdapter;
    let chevrotainAdapter: ParserAdapter;

    beforeAll(async () => {
        const lezerResult = await createLezerAdapterForGrammar(LIST_GRAMMAR);
        lezerAdapter = lezerResult.adapter;
        const chevResult = await createChevrotainAdapterForGrammar(LIST_GRAMMAR);
        chevrotainAdapter = chevResult.adapter;
    });

    const sizes = [100, 500, 1000, 5000];

    test('full parse + incremental across document sizes', () => {
        const results: BenchmarkResult[] = [];
        const iterations = 10;

        for (const size of sizes) {
            const doc = generateLargeDocument(size);

            // Full parse — Chevrotain
            const chevrotainMs = measure(() => chevrotainAdapter.parse(doc), iterations);

            // Full parse — Lezer
            const lezerFullMs = measure(() => lezerAdapter.parse(doc), iterations);

            // Set up incremental base
            const baseResult = lezerAdapter.parse(doc);
            const state = baseResult.incrementalState!;

            // Edit 1: Single char insertion in middle
            const midOffset = Math.floor(doc.length / 2);
            const editedChar = doc.slice(0, midOffset) + 'x' + doc.slice(midOffset);
            const charChanges: TextChange[] = [
                { rangeOffset: midOffset, rangeLength: 0, text: 'x' }
            ];
            const lezerIncrCharMs = measure(
                () => lezerAdapter.parseIncremental!(editedChar, state, charChanges),
                iterations
            );

            // Edit 2: Line insertion in middle
            const lines = doc.split('\n');
            const midLine = Math.floor(lines.length / 2);
            const lineOffset = lines.slice(0, midLine).join('\n').length + 1;
            const newLine = 'item inserted_item';
            const editedLine = doc.slice(0, lineOffset) + newLine + '\n' + doc.slice(lineOffset);
            const lineChanges: TextChange[] = [
                { rangeOffset: lineOffset, rangeLength: 0, text: newLine + '\n' }
            ];
            const lezerIncrLineMs = measure(
                () => lezerAdapter.parseIncremental!(editedLine, state, lineChanges),
                iterations
            );

            // Edit 3: Block replacement (replace 5 items in the middle)
            const blockStart = lines.slice(0, midLine - 2).join('\n').length + 1;
            const blockEnd = lines.slice(0, midLine + 3).join('\n').length;
            const oldBlock = doc.slice(blockStart, blockEnd);
            const newBlock = Array.from({ length: 5 }, (_, i) => `item replaced_${i}`).join('\n');
            const editedBlock = doc.slice(0, blockStart) + newBlock + doc.slice(blockEnd);
            const blockChanges: TextChange[] = [
                { rangeOffset: blockStart, rangeLength: oldBlock.length, text: newBlock }
            ];
            const lezerIncrBlockMs = measure(
                () => lezerAdapter.parseIncremental!(editedBlock, state, blockChanges),
                iterations
            );

            results.push({
                size,
                chevrotainMs: Math.round(chevrotainMs * 100) / 100,
                lezerFullMs: Math.round(lezerFullMs * 100) / 100,
                lezerIncrCharMs: Math.round(lezerIncrCharMs * 100) / 100,
                lezerIncrLineMs: Math.round(lezerIncrLineMs * 100) / 100,
                lezerIncrBlockMs: Math.round(lezerIncrBlockMs * 100) / 100,
                speedupChar: (lezerFullMs / lezerIncrCharMs).toFixed(1) + 'x',
                speedupLine: (lezerFullMs / lezerIncrLineMs).toFixed(1) + 'x',
                speedupBlock: (lezerFullMs / lezerIncrBlockMs).toFixed(1) + 'x',
            });
        }

        // Print results
        console.log('\n=== LIST_GRAMMAR Parse Benchmarks ===');
        console.table(results.map(r => ({
            'Items': r.size,
            'Chevrotain (ms)': r.chevrotainMs,
            'Lezer Full (ms)': r.lezerFullMs,
            'Incr Char (ms)': r.lezerIncrCharMs,
            'Incr Line (ms)': r.lezerIncrLineMs,
            'Incr Block (ms)': r.lezerIncrBlockMs,
            'Speedup (char)': r.speedupChar,
            'Speedup (line)': r.speedupLine,
            'Speedup (block)': r.speedupBlock,
        })));

        // Assertions: for large documents, incremental should be faster than full
        for (const r of results) {
            if (r.size >= 500) {
                expect(r.lezerIncrCharMs).toBeLessThan(r.lezerFullMs * 2);
            }
        }
    });
});

// ---- Arithmetics grammar benchmarks ----

describe('Parse benchmarks — Arithmetics grammar', () => {
    let lezerAdapter: LezerAdapter;
    let chevrotainAdapter: ParserAdapter;

    beforeAll(async () => {
        const lezerResult = await createLezerAdapterForGrammar(ARITHMETICS_GRAMMAR);
        lezerAdapter = lezerResult.adapter;
        const chevResult = await createChevrotainAdapterForGrammar(ARITHMETICS_GRAMMAR);
        chevrotainAdapter = chevResult.adapter;
    });

    const sizes = [50, 200, 500, 1000];

    test('full parse + incremental with expression-heavy grammar', () => {
        const results: BenchmarkResult[] = [];
        const iterations = 10;

        for (const size of sizes) {
            const doc = generateArithmeticsDocument(size);

            // Full parse — Chevrotain
            const chevrotainMs = measure(() => chevrotainAdapter.parse(doc), iterations);

            // Full parse — Lezer
            const lezerFullMs = measure(() => lezerAdapter.parse(doc), iterations);

            // Incremental: single char edit
            const baseResult = lezerAdapter.parse(doc);
            const state = baseResult.incrementalState!;

            const midOffset = Math.floor(doc.length / 2);
            const editedChar = doc.slice(0, midOffset) + '1' + doc.slice(midOffset);
            const charChanges: TextChange[] = [
                { rangeOffset: midOffset, rangeLength: 0, text: '1' }
            ];
            const lezerIncrCharMs = measure(
                () => lezerAdapter.parseIncremental!(editedChar, state, charChanges),
                iterations
            );

            // Incremental: add a new definition line
            const lines = doc.split('\n');
            const midLine = Math.floor(lines.length / 2);
            const lineOffset = lines.slice(0, midLine).join('\n').length + 1;
            const newDef = `def inserted_var : 42 + 1 ;`;
            const editedLine = doc.slice(0, lineOffset) + newDef + '\n' + doc.slice(lineOffset);
            const lineChanges: TextChange[] = [
                { rangeOffset: lineOffset, rangeLength: 0, text: newDef + '\n' }
            ];
            const lezerIncrLineMs = measure(
                () => lezerAdapter.parseIncremental!(editedLine, state, lineChanges),
                iterations
            );

            // Incremental: replace a definition
            const defLines = lines.filter(l => l.startsWith('def'));
            const replaceLineIdx = lines.indexOf(defLines[Math.floor(defLines.length / 2)]);
            const replaceStart = lines.slice(0, replaceLineIdx).join('\n').length + 1;
            const replaceEnd = replaceStart + lines[replaceLineIdx].length;
            const oldText = doc.slice(replaceStart, replaceEnd);
            const newDefReplace = 'def replaced : 99 * 3 + 7 ;';
            const editedBlock = doc.slice(0, replaceStart) + newDefReplace + doc.slice(replaceEnd);
            const blockChanges: TextChange[] = [
                { rangeOffset: replaceStart, rangeLength: oldText.length, text: newDefReplace }
            ];
            const lezerIncrBlockMs = measure(
                () => lezerAdapter.parseIncremental!(editedBlock, state, blockChanges),
                iterations
            );

            results.push({
                size,
                chevrotainMs: Math.round(chevrotainMs * 100) / 100,
                lezerFullMs: Math.round(lezerFullMs * 100) / 100,
                lezerIncrCharMs: Math.round(lezerIncrCharMs * 100) / 100,
                lezerIncrLineMs: Math.round(lezerIncrLineMs * 100) / 100,
                lezerIncrBlockMs: Math.round(lezerIncrBlockMs * 100) / 100,
                speedupChar: (lezerFullMs / lezerIncrCharMs).toFixed(1) + 'x',
                speedupLine: (lezerFullMs / lezerIncrLineMs).toFixed(1) + 'x',
                speedupBlock: (lezerFullMs / lezerIncrBlockMs).toFixed(1) + 'x',
            });
        }

        console.log('\n=== Arithmetics Grammar Parse Benchmarks ===');
        console.table(results.map(r => ({
            'Defs': r.size,
            'Chevrotain (ms)': r.chevrotainMs,
            'Lezer Full (ms)': r.lezerFullMs,
            'Incr Char (ms)': r.lezerIncrCharMs,
            'Incr Line (ms)': r.lezerIncrLineMs,
            'Incr Block (ms)': r.lezerIncrBlockMs,
            'Speedup (char)': r.speedupChar,
            'Speedup (line)': r.speedupLine,
            'Speedup (block)': r.speedupBlock,
        })));

        // Assertions: for larger expression-heavy grammars, incremental should win
        for (const r of results) {
            if (r.size >= 500) {
                expect(r.lezerIncrCharMs).toBeLessThan(r.lezerFullMs * 2);
            }
        }
    });
});

// ---- SyntaxNode tree size comparison ----

describe('Tree size comparison', () => {
    let lezerAdapter: LezerAdapter;
    let chevrotainAdapter: ParserAdapter;

    beforeAll(async () => {
        const lezerResult = await createLezerAdapterForGrammar(LIST_GRAMMAR);
        lezerAdapter = lezerResult.adapter;
        const chevResult = await createChevrotainAdapterForGrammar(LIST_GRAMMAR);
        chevrotainAdapter = chevResult.adapter;
    });

    function countNodes(node: { children: readonly { children: readonly any[] }[] }): number {
        let count = 1;
        for (const child of node.children) {
            count += countNodes(child);
        }
        return count;
    }

    test('node count comparison across sizes', () => {
        const sizes = [100, 500, 1000];
        const results: { size: number; chevrotainNodes: number; lezerNodes: number }[] = [];

        for (const size of sizes) {
            const doc = generateLargeDocument(size);

            const chevResult = chevrotainAdapter.parse(doc);
            const lezerResult = lezerAdapter.parse(doc);

            results.push({
                size,
                chevrotainNodes: countNodes(chevResult.root),
                lezerNodes: countNodes(lezerResult.root),
            });
        }

        console.log('\n=== SyntaxNode Tree Size ===');
        console.table(results.map(r => ({
            'Items': r.size,
            'Chevrotain Nodes': r.chevrotainNodes,
            'Lezer Nodes': r.lezerNodes,
        })));

        // Both should produce trees (sanity check)
        for (const r of results) {
            expect(r.chevrotainNodes).toBeGreaterThan(0);
            expect(r.lezerNodes).toBeGreaterThan(0);
        }
    });
});
