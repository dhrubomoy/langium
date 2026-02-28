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

// ---- Complex grammar with ambiguities — 15000 lines ----

/**
 * Mini-language grammar with:
 *  - Nested block scopes (braces)
 *  - Variable declarations with optional type annotations
 *  - Assignments and expression statements
 *  - If/else (dangling-else ambiguity in the AST shape)
 *  - While loops
 *  - Expressions with 5 precedence levels (||, &&, ==, +/-, *)
 *  - Unary operators (! -)
 *  - Parenthesised sub-expressions, function calls, member access
 */
const COMPLEX_GRAMMAR = `
    grammar MiniLang
    entry Program: statements+=Statement*;

    Statement:
        VarDecl | Assignment | IfStatement | WhileStatement | Block | ExprStatement;

    VarDecl:
        'let' name=ID (':' type=TypeRef)? ('=' init=Expression)? ';';

    Assignment:
        target=ID '=' value=Expression ';';

    IfStatement:
        'if' '(' condition=Expression ')' then=Block ('else' else=Block)?;

    WhileStatement:
        'while' '(' condition=Expression ')' body=Block;

    Block:
        '{' statements+=Statement* '}';

    ExprStatement:
        expression=Expression ';';

    TypeRef:
        name=ID;

    Expression: OrExpression;

    OrExpression infers Expression:
        AndExpression ({infer BinaryExpression.left=current} op='||' right=AndExpression)*;

    AndExpression infers Expression:
        EqualityExpression ({infer BinaryExpression.left=current} op='&&' right=EqualityExpression)*;

    EqualityExpression infers Expression:
        AddExpression ({infer BinaryExpression.left=current} op=('==' | '!=') right=AddExpression)*;

    AddExpression infers Expression:
        MulExpression ({infer BinaryExpression.left=current} op=('+' | '-') right=MulExpression)*;

    MulExpression infers Expression:
        UnaryExpression ({infer BinaryExpression.left=current} op='*' right=UnaryExpression)*;

    UnaryExpression infers Expression:
        {infer UnaryExpression} op='!' operand=UnaryExpression
      | PrimaryExpression;

    PrimaryExpression infers Expression:
        '(' Expression ')'
      | {infer NumberLiteral} value=NUMBER
      | {infer TrueLiteral} 'true'
      | {infer FalseLiteral} 'false'
      | {infer VarRef} name=ID;

    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
    terminal NUMBER: /[0-9]+(\\.[0-9]*)?/;
`;

/**
 * Generate a realistic MiniLang document.
 * Produces nested if/else, while loops, variable declarations, and expression statements.
 * Each "function-like block" is ~15 lines, so 1000 blocks ≈ 15000 lines.
 */
function generateComplexDocument(blockCount: number): string {
    const lines: string[] = [];
    const ops = ['+', '-', '*', '==', '!=', '&&', '||'];
    const types = ['int', 'bool', 'string', 'float'];

    for (let b = 0; b < blockCount; b++) {
        const v = `v${b}`;
        const w = `w${b}`;
        const typ = types[b % types.length];
        const op1 = ops[b % ops.length];
        const op2 = ops[(b + 3) % ops.length];

        // Open block
        lines.push('{');

        // Variable declarations
        lines.push(`  let ${v} : ${typ} = ${b} ${op1} ${b + 1} ;`);
        lines.push(`  let ${w} = ${v} ${op2} ${b + 2} ;`);

        // If/else with nested block (dangling-else pattern)
        lines.push(`  if ( ${v} != 0 ) {`);
        lines.push(`    ${w} = ${v} * ( ${b} + 1 ) ;`);
        lines.push(`    if ( ${w} == ${b} ) {`);
        lines.push(`      let tmp = ${v} + ${w} ;`);
        lines.push(`      ${v} = tmp ;`);
        lines.push('    }');
        lines.push('  } else {');
        lines.push(`    ${v} = 0 ;`);
        lines.push('  }');

        // While loop
        lines.push(`  while ( ${v} != 0 ) {`);
        lines.push(`    ${v} = ${v} - 1 ;`);
        lines.push('  }');

        // Close block
        lines.push('}');
    }

    return lines.join('\n');
}

describe('Parse benchmarks — Complex grammar (15000 lines)', () => {
    let lezerAdapter: LezerAdapter;
    let chevrotainAdapter: ParserAdapter;

    beforeAll(async () => {
        const lezerResult = await createLezerAdapterForGrammar(COMPLEX_GRAMMAR);
        lezerAdapter = lezerResult.adapter;
        const chevResult = await createChevrotainAdapterForGrammar(COMPLEX_GRAMMAR);
        chevrotainAdapter = chevResult.adapter;
    });

    test('full parse + incremental at 15000 lines', () => {
        // ~1000 blocks × 15 lines = 15000 lines
        const doc = generateComplexDocument(1000);
        const lineCount = doc.split('\n').length;
        const charCount = doc.length;
        const iterations = 5;

        console.log(`\n=== Complex Grammar — ${lineCount} lines, ${(charCount / 1024).toFixed(0)} KB ===`);

        // Full parse — Chevrotain
        const chevrotainMs = measure(() => chevrotainAdapter.parse(doc), iterations);

        // Full parse — Lezer
        const lezerFullMs = measure(() => lezerAdapter.parse(doc), iterations);

        // Set up incremental base
        const baseResult = lezerAdapter.parse(doc);
        const state = baseResult.incrementalState!;
        expect(baseResult.root.diagnostics).toHaveLength(0);

        // --- Edit 1: Single char insertion (rename a variable in the middle) ---
        const midOffset = Math.floor(doc.length / 2);
        const editedChar = doc.slice(0, midOffset) + 'x' + doc.slice(midOffset);
        const charChanges: TextChange[] = [
            { rangeOffset: midOffset, rangeLength: 0, text: 'x' }
        ];
        const lezerIncrCharMs = measure(
            () => lezerAdapter.parseIncremental!(editedChar, state, charChanges),
            iterations
        );

        // --- Edit 2: Insert a full block (15 lines) in the middle ---
        const lines = doc.split('\n');
        const midLine = Math.floor(lines.length / 2);
        const lineOffset = lines.slice(0, midLine).join('\n').length + 1;
        const insertedBlock = [
            '{',
            '  let inserted : int = 42 ;',
            '  if ( inserted != 0 ) {',
            '    inserted = inserted - 1 ;',
            '  }',
            '}'
        ].join('\n');
        const editedLine = doc.slice(0, lineOffset) + insertedBlock + '\n' + doc.slice(lineOffset);
        const lineChanges: TextChange[] = [
            { rangeOffset: lineOffset, rangeLength: 0, text: insertedBlock + '\n' }
        ];
        const lezerIncrLineMs = measure(
            () => lezerAdapter.parseIncremental!(editedLine, state, lineChanges),
            iterations
        );

        // --- Edit 3: Replace 5 blocks (~75 lines) in the middle ---
        const blockSize = 15; // lines per block
        const replaceStartLine = midLine - (2 * blockSize);
        const replaceEndLine = midLine + (3 * blockSize);
        const replaceStartOffset = lines.slice(0, replaceStartLine).join('\n').length + 1;
        const replaceEndOffset = lines.slice(0, replaceEndLine).join('\n').length;
        const oldBlockText = doc.slice(replaceStartOffset, replaceEndOffset);
        const newBlocks = Array.from({ length: 5 }, (_, i) => [
            '{',
            `  let rep_${i} : float = ${i * 10} ;`,
            `  rep_${i} = rep_${i} + 1 ;`,
            `  if ( rep_${i} == 0 ) {`,
            `    rep_${i} = 99 ;`,
            '  }',
            '}'
        ].join('\n')).join('\n');
        const editedBlock = doc.slice(0, replaceStartOffset) + newBlocks + doc.slice(replaceEndOffset);
        const blockChanges: TextChange[] = [
            { rangeOffset: replaceStartOffset, rangeLength: oldBlockText.length, text: newBlocks }
        ];
        const lezerIncrBlockMs = measure(
            () => lezerAdapter.parseIncremental!(editedBlock, state, blockChanges),
            iterations
        );

        const r = (n: number) => Math.round(n * 100) / 100;

        console.table([{
            'Lines': lineCount,
            'KB': (charCount / 1024).toFixed(0),
            'Chevrotain (ms)': r(chevrotainMs),
            'Lezer Full (ms)': r(lezerFullMs),
            'Incr Char (ms)': r(lezerIncrCharMs),
            'Incr Line (ms)': r(lezerIncrLineMs),
            'Incr Block (ms)': r(lezerIncrBlockMs),
            'Speedup (char)': (lezerFullMs / lezerIncrCharMs).toFixed(1) + 'x',
            'Speedup (line)': (lezerFullMs / lezerIncrLineMs).toFixed(1) + 'x',
            'Speedup (block)': (lezerFullMs / lezerIncrBlockMs).toFixed(1) + 'x',
        }]);

        // Incremental must beat full for a 15k-line document
        expect(lezerIncrCharMs).toBeLessThan(lezerFullMs);
        expect(lezerIncrLineMs).toBeLessThan(lezerFullMs);
        expect(lezerIncrBlockMs).toBeLessThan(lezerFullMs);
    });

    test('scaling: incremental advantage grows with document size', () => {
        // Test at 100, 500, 1000 blocks (1500, 7500, 15000 lines)
        const blockCounts = [100, 500, 1000];
        const iterations = 5;
        const results: {
            blocks: number;
            lines: number;
            lezerFullMs: number;
            lezerIncrMs: number;
            speedup: string;
        }[] = [];

        for (const blocks of blockCounts) {
            const doc = generateComplexDocument(blocks);
            const lineCount = doc.split('\n').length;

            const lezerFullMs = measure(() => lezerAdapter.parse(doc), iterations);

            const baseResult = lezerAdapter.parse(doc);
            const state = baseResult.incrementalState!;

            // Single char insertion in the middle
            const midOffset = Math.floor(doc.length / 2);
            const edited = doc.slice(0, midOffset) + 'x' + doc.slice(midOffset);
            const changes: TextChange[] = [
                { rangeOffset: midOffset, rangeLength: 0, text: 'x' }
            ];
            const lezerIncrMs = measure(
                () => lezerAdapter.parseIncremental!(edited, state, changes),
                iterations
            );

            results.push({
                blocks,
                lines: lineCount,
                lezerFullMs: Math.round(lezerFullMs * 100) / 100,
                lezerIncrMs: Math.round(lezerIncrMs * 100) / 100,
                speedup: (lezerFullMs / lezerIncrMs).toFixed(1) + 'x',
            });
        }

        console.log('\n=== Complex Grammar — Scaling ===');
        console.table(results.map(r => ({
            'Blocks': r.blocks,
            'Lines': r.lines,
            'Full (ms)': r.lezerFullMs,
            'Incr (ms)': r.lezerIncrMs,
            'Speedup': r.speedup,
        })));

        // Speedup should grow: larger doc → bigger advantage
        const speedups = results.map(r => r.lezerFullMs / r.lezerIncrMs);
        for (let i = 1; i < speedups.length; i++) {
            // Each larger size should have at least as good a speedup ratio
            // (use 0.8x tolerance for timing variance)
            expect(speedups[i]).toBeGreaterThan(speedups[i - 1] * 0.8);
        }
    });
});

// ---- Infix grammar with Lezer-specific features (Lezer-only benchmark) ----

/**
 * Grammar using:
 *  1. `infix` rule for binary expression precedence
 *  2. `precedence` block + `@precMarker` on non-expression elements
 *  3. `@dynamicPrecedence` on a parser rule
 *
 * Lezer-only: Chevrotain does not support these grammar extensions.
 */
const INFIX_GRAMMAR = `
    grammar MiniLangX
    entry Program: declarations+=Declaration*;

    Declaration:
        FuncDecl | VarDecl;

    FuncDecl:
        'func' name=ID '(' (params+=Param (',' params+=Param)*)? ')' body=Block;

    Param:
        name=ID ':' type=TypeRef @precMarker=TypeAnnotation;

    VarDecl:
        'let' name=ID @dynamicPrecedence(2) (':' type=TypeRef)? ('=' init=Expression)? ';';

    Statement:
        VarDecl | Assignment | IfStatement | WhileStatement | Block | ExprStatement;

    Assignment:
        target=ID '=' value=Expression ';';

    IfStatement:
        'if' '(' condition=Expression ')' then=Block ('else' else=Block)?;

    WhileStatement:
        'while' '(' condition=Expression ')' body=Block;

    Block:
        '{' statements+=Statement* '}';

    ExprStatement:
        expression=Expression ';';

    TypeRef:
        name=ID;

    Expression: BinaryExpr;

    infix BinaryExpr on AtomicExpr: '||' > '&&' > '==' | '!=' > '+' | '-' > '*';

    AtomicExpr infers Expression:
        '(' Expression ')'
      | {infer UnaryExpression} '!' operand=AtomicExpr
      | {infer NumberLiteral} value=NUMBER
      | {infer TrueLiteral} 'true'
      | {infer FalseLiteral} 'false'
      | {infer VarRef} name=ID;

    precedence {
        TypeAnnotation left assoc;
    }

    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
    terminal NUMBER: /[0-9]+(\\.[0-9]*)?/;
`;

/**
 * Generate a MiniLangX document with function declarations, nested blocks, and expressions.
 * Each function block is ~15 lines, so 1000 blocks ≈ 15000 lines.
 */
function generateInfixDocument(blockCount: number): string {
    const lines: string[] = [];
    const ops = ['+', '-', '*', '==', '!=', '&&', '||'];
    const types = ['int', 'bool', 'string', 'float'];

    for (let b = 0; b < blockCount; b++) {
        const v = `v${b}`;
        const w = `w${b}`;
        const typ = types[b % types.length];
        const op1 = ops[b % ops.length];
        const op2 = ops[(b + 3) % ops.length];

        // Top-level: only Declaration (FuncDecl | VarDecl) is allowed.
        // Alternate between func declarations and top-level let declarations.
        if (b % 3 === 0) {
            // FuncDecl (exercises Param with @precMarker=TypeAnnotation on type)
            lines.push(`func fn_${b}(x${b} : ${typ}, y${b} : ${typ}) {`);

            // Statements inside the function body
            lines.push(`  let ${v} : ${typ} = ${b} ${op1} ${b + 1} ;`);
            lines.push(`  let ${w} = ${v} ${op2} ${b + 2} ;`);

            // If/else with nested block
            lines.push(`  if ( ${v} != 0 ) {`);
            lines.push(`    ${w} = ${v} * ( ${b} + 1 ) ;`);
            lines.push(`    if ( ${w} == ${b} ) {`);
            lines.push(`      let tmp = ${v} + ${w} ;`);
            lines.push(`      ${v} = tmp ;`);
            lines.push('    }');
            lines.push('  } else {');
            lines.push(`    ${v} = 0 ;`);
            lines.push('  }');

            // While loop
            lines.push(`  while ( ${v} != 0 ) {`);
            lines.push(`    ${v} = ${v} - 1 ;`);
            lines.push('  }');

            lines.push('}');
        } else {
            // VarDecl (exercises @dynamicPrecedence(2) on the rule)
            lines.push(`let ${v} : ${typ} = ${b} ${op1} ( ${b + 1} ${op2} ${b + 2} ) ;`);
        }
    }

    return lines.join('\n');
}

describe('Parse benchmarks — Infix grammar with Lezer features (Lezer-only)', () => {
    let lezerAdapter: LezerAdapter;

    beforeAll(async () => {
        const lezerResult = await createLezerAdapterForGrammar(INFIX_GRAMMAR);
        lezerAdapter = lezerResult.adapter;
    });

    test('full parse + incremental at ~15000 lines', () => {
        const doc = generateInfixDocument(1000);
        const lineCount = doc.split('\n').length;
        const charCount = doc.length;
        const iterations = 5;

        console.log(`\n=== Infix Grammar (Lezer-only) — ${lineCount} lines, ${(charCount / 1024).toFixed(0)} KB ===`);

        // Full parse
        const lezerFullMs = measure(() => lezerAdapter.parse(doc), iterations);

        // Set up incremental base
        const baseResult = lezerAdapter.parse(doc);
        const state = baseResult.incrementalState!;
        expect(baseResult.root.diagnostics).toHaveLength(0);

        // Edit 1: Single char insertion
        const midOffset = Math.floor(doc.length / 2);
        const editedChar = doc.slice(0, midOffset) + 'x' + doc.slice(midOffset);
        const charChanges: TextChange[] = [
            { rangeOffset: midOffset, rangeLength: 0, text: 'x' }
        ];
        const lezerIncrCharMs = measure(
            () => lezerAdapter.parseIncremental!(editedChar, state, charChanges),
            iterations
        );

        // Edit 2: Insert a valid declaration in the middle
        const docLines = doc.split('\n');
        const midLine = Math.floor(docLines.length / 2);
        const lineOffset = docLines.slice(0, midLine).join('\n').length + 1;
        const insertedBlock = [
            'func inserted(a : int, b : int) {',
            '  let c : int = a + b ;',
            '  if ( c != 0 ) {',
            '    c = c - 1 ;',
            '  }',
            '}'
        ].join('\n');
        const editedLine = doc.slice(0, lineOffset) + insertedBlock + '\n' + doc.slice(lineOffset);
        const lineChanges: TextChange[] = [
            { rangeOffset: lineOffset, rangeLength: 0, text: insertedBlock + '\n' }
        ];
        const lezerIncrLineMs = measure(
            () => lezerAdapter.parseIncremental!(editedLine, state, lineChanges),
            iterations
        );

        // Edit 3: Replace several declarations in the middle
        const replaceStartLine = Math.max(0, midLine - 10);
        const replaceEndLine = Math.min(docLines.length, midLine + 10);
        const replaceStartOffset = docLines.slice(0, replaceStartLine).join('\n').length + 1;
        const replaceEndOffset = docLines.slice(0, replaceEndLine).join('\n').length;
        const oldBlockText = doc.slice(replaceStartOffset, replaceEndOffset);
        const newBlocks = Array.from({ length: 5 }, (_, i) =>
            `let rep_${i} : float = ${i * 10} + ${i} ;`
        ).join('\n');
        const editedBlock = doc.slice(0, replaceStartOffset) + newBlocks + doc.slice(replaceEndOffset);
        const blockChanges: TextChange[] = [
            { rangeOffset: replaceStartOffset, rangeLength: oldBlockText.length, text: newBlocks }
        ];
        const lezerIncrBlockMs = measure(
            () => lezerAdapter.parseIncremental!(editedBlock, state, blockChanges),
            iterations
        );

        const r = (n: number) => Math.round(n * 100) / 100;

        console.table([{
            'Lines': lineCount,
            'KB': (charCount / 1024).toFixed(0),
            'Full (ms)': r(lezerFullMs),
            'Incr Char (ms)': r(lezerIncrCharMs),
            'Incr Line (ms)': r(lezerIncrLineMs),
            'Incr Block (ms)': r(lezerIncrBlockMs),
            'Speedup (char)': (lezerFullMs / lezerIncrCharMs).toFixed(1) + 'x',
            'Speedup (line)': (lezerFullMs / lezerIncrLineMs).toFixed(1) + 'x',
            'Speedup (block)': (lezerFullMs / lezerIncrBlockMs).toFixed(1) + 'x',
        }]);

        // Incremental must beat full parse
        expect(lezerIncrCharMs).toBeLessThan(lezerFullMs);
        expect(lezerIncrLineMs).toBeLessThan(lezerFullMs);
        expect(lezerIncrBlockMs).toBeLessThan(lezerFullMs);
    });

    test('compare: infix grammar vs manual-chain grammar (Lezer only)', async () => {
        // Also build adapter for the manual-chain COMPLEX_GRAMMAR
        const complexResult = await createLezerAdapterForGrammar(COMPLEX_GRAMMAR);
        const complexAdapter = complexResult.adapter;

        const blockCount = 1000;
        const infixDoc = generateInfixDocument(blockCount);
        const complexDoc = generateComplexDocument(blockCount);
        const iterations = 5;

        const infixFullMs = measure(() => lezerAdapter.parse(infixDoc), iterations);
        const complexFullMs = measure(() => complexAdapter.parse(complexDoc), iterations);

        // Incremental comparison
        const infixBase = lezerAdapter.parse(infixDoc);
        const complexBase = complexAdapter.parse(complexDoc);

        const infixMid = Math.floor(infixDoc.length / 2);
        const complexMid = Math.floor(complexDoc.length / 2);

        const infixEdited = infixDoc.slice(0, infixMid) + 'x' + infixDoc.slice(infixMid);
        const complexEdited = complexDoc.slice(0, complexMid) + 'x' + complexDoc.slice(complexMid);

        const infixIncrMs = measure(
            () => lezerAdapter.parseIncremental!(infixEdited, infixBase.incrementalState!, [
                { rangeOffset: infixMid, rangeLength: 0, text: 'x' }
            ]),
            iterations
        );
        const complexIncrMs = measure(
            () => complexAdapter.parseIncremental!(complexEdited, complexBase.incrementalState!, [
                { rangeOffset: complexMid, rangeLength: 0, text: 'x' }
            ]),
            iterations
        );

        const r = (n: number) => Math.round(n * 100) / 100;

        console.log('\n=== Infix vs Manual-Chain (Lezer only) ===');
        console.table([
            {
                'Grammar': 'Infix (BinaryExpr)',
                'Lines': infixDoc.split('\n').length,
                'Full (ms)': r(infixFullMs),
                'Incr (ms)': r(infixIncrMs),
                'Speedup': (infixFullMs / infixIncrMs).toFixed(1) + 'x',
            },
            {
                'Grammar': 'Manual Chain (5-level)',
                'Lines': complexDoc.split('\n').length,
                'Full (ms)': r(complexFullMs),
                'Incr (ms)': r(complexIncrMs),
                'Speedup': (complexFullMs / complexIncrMs).toFixed(1) + 'x',
            },
        ]);

        // Both should parse without errors
        expect(infixBase.root.diagnostics).toHaveLength(0);
        expect(complexBase.root.diagnostics).toHaveLength(0);
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
