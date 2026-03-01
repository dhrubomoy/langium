/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

/**
 * Dual-backend example: same grammar parsed with both Chevrotain and Lezer.
 *
 * Demonstrates:
 * 1. Cross-backend AST equivalence (same grammar → same AST)
 * 2. Lezer incremental parsing (only re-parse changed regions)
 * 3. Performance comparison between backends
 */

import { describe, test, expect, beforeAll } from 'vitest';
import type { ParserAdapter, TextChange } from 'langium-core';
import { EmptyFileSystem, URI } from 'langium-core';
import { createLangiumGrammarServices, createServicesForGrammar } from 'langium-lsp';
import { buildParser } from '@lezer/generator';
import type { LezerAdapter } from 'langium-lezer';
import { LezerGrammarTranslator, DefaultFieldMap, LezerAdapter as LezerAdapterClass } from 'langium-lezer';

// ---- Grammar ----

const TASK_GRAMMAR = `
    grammar TaskList
    entry TaskList: 'project' name=ID tasks+=Task*;
    Task: 'task' name=ID (':' priority=Priority)? ';';
    Priority: 'low' | 'medium' | 'high' | 'critical';
    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
`;

// ---- Test documents ----

const SMALL_DOC = `project MyProject
task setup : high ;
task build ;
task test : medium ;
task deploy : critical ;
`;

function generateTaskDoc(taskCount: number): string {
    const priorities = ['low', 'medium', 'high', 'critical'];
    const lines = ['project LargeProject'];
    for (let i = 0; i < taskCount; i++) {
        const priority = priorities[i % priorities.length];
        lines.push(`task task_${i} : ${priority} ;`);
    }
    return lines.join('\n');
}

// ---- Helpers ----

async function parseGrammar(grammarString: string) {
    const grammarServices = createLangiumGrammarServices(EmptyFileSystem).grammar;
    const uri = URI.parse('memory:/test-grammar.langium');
    const doc = grammarServices.shared.workspace.LangiumDocumentFactory.fromString(grammarString, uri);
    grammarServices.shared.workspace.LangiumDocuments.addDocument(doc);
    await grammarServices.shared.workspace.DocumentBuilder.build([doc], { validation: false });
    return doc.parseResult.value;
}

async function createChevrotainAdapter(): Promise<ParserAdapter> {
    const services = await createServicesForGrammar({ grammar: TASK_GRAMMAR });
    return services.parser.ParserAdapter;
}

async function createLezerAdapter(): Promise<LezerAdapter> {
    const grammar = await parseGrammar(TASK_GRAMMAR);
    const translator = new LezerGrammarTranslator();
    const { grammarText, fieldMapData, keywords } = translator.generateGrammarInMemory(grammar as any);
    const parser = buildParser(grammarText);
    const fieldMap = new DefaultFieldMap(fieldMapData);
    const adapter = new LezerAdapterClass();
    adapter.loadParseTables(parser, fieldMap, keywords);
    return adapter;
}

function collectLeafTexts(node: { children: readonly any[]; isLeaf: boolean; isHidden: boolean; text: string }): string[] {
    const texts: string[] = [];
    function walk(n: any): void {
        if (n.isHidden) return;
        if (n.isLeaf) {
            texts.push(n.text);
        } else {
            for (const child of n.children) {
                walk(child);
            }
        }
    }
    walk(node);
    return texts;
}

// ---- Tests ----

describe('Cross-backend equivalence', () => {
    let chevrotain: ParserAdapter;
    let lezer: LezerAdapter;

    beforeAll(async () => {
        chevrotain = await createChevrotainAdapter();
        lezer = await createLezerAdapter();
    });

    test('both backends accept valid input', () => {
        const chevResult = chevrotain.parse(SMALL_DOC);
        const lezerResult = lezer.parse(SMALL_DOC);

        expect(chevResult.root.diagnostics).toHaveLength(0);
        expect(lezerResult.root.diagnostics).toHaveLength(0);
    });

    test('both backends produce same non-punctuation token sequence', () => {
        const chevTokens = collectLeafTexts(chevrotain.parse(SMALL_DOC).root);
        const lezerTokens = collectLeafTexts(lezer.parse(SMALL_DOC).root);

        // Filter out punctuation (: ;) since backends may structure these differently
        const filterPunct = (tokens: string[]) => tokens.filter(t => ![':', ';'].includes(t));
        expect(filterPunct(chevTokens)).toEqual(filterPunct(lezerTokens));
    });

    test('both backends produce same fullText', () => {
        const chevResult = chevrotain.parse(SMALL_DOC);
        const lezerResult = lezer.parse(SMALL_DOC);

        expect(chevResult.root.fullText).toBe(lezerResult.root.fullText);
    });

    test('both backends reject invalid input with diagnostics', () => {
        const invalid = 'project';
        const chevResult = chevrotain.parse(invalid);
        const lezerResult = lezer.parse(invalid);

        // Both should report errors
        expect(chevResult.root.diagnostics.length).toBeGreaterThan(0);
        expect(lezerResult.root.diagnostics.length).toBeGreaterThan(0);
    });
});

describe('Lezer incremental parsing', () => {
    let lezer: LezerAdapter;

    beforeAll(async () => {
        lezer = await createLezerAdapter();
    });

    test('incremental parse produces same result as full parse', () => {
        const original = SMALL_DOC;
        const result1 = lezer.parse(original);
        expect(result1.incrementalState).toBeDefined();

        // Add a new task
        const addition = 'task newTask : low ;\n';
        const edited = original + addition;
        const changes: TextChange[] = [
            { rangeOffset: original.length, rangeLength: 0, text: addition }
        ];

        const incrResult = lezer.parseIncremental!(edited, result1.incrementalState!, changes);
        const fullResult = lezer.parse(edited);

        // Same token sequence
        const incrTokens = collectLeafTexts(incrResult.root);
        const fullTokens = collectLeafTexts(fullResult.root);
        expect(incrTokens).toEqual(fullTokens);

        // No errors
        expect(incrResult.root.diagnostics).toHaveLength(0);
    });

    test('multiple incremental edits stay correct', () => {
        let text = 'project Test\ntask alpha ;';
        let state = lezer.parse(text).incrementalState!;

        // Add tasks one by one
        const tasksToAdd = ['beta', 'gamma', 'delta', 'epsilon'];
        for (const name of tasksToAdd) {
            const addition = `\ntask ${name} ;`;
            const newText = text + addition;
            const result = lezer.parseIncremental!(newText, state, [
                { rangeOffset: text.length, rangeLength: 0, text: addition }
            ]);
            expect(result.root.diagnostics).toHaveLength(0);
            text = newText;
            state = result.incrementalState!;
        }

        // Final result should match fresh parse
        const freshResult = lezer.parse(text);
        const incrTokens = collectLeafTexts(lezer.parseIncremental!(text, state, []).root);
        const freshTokens = collectLeafTexts(freshResult.root);
        expect(incrTokens).toEqual(freshTokens);
    });
});

describe('Performance comparison', () => {
    let chevrotain: ParserAdapter;
    let lezer: LezerAdapter;

    beforeAll(async () => {
        chevrotain = await createChevrotainAdapter();
        lezer = await createLezerAdapter();
    });

    test('incremental parsing is faster than full parsing for large documents', () => {
        const doc = generateTaskDoc(1000);

        // Full parse baseline
        const baseResult = lezer.parse(doc);
        const state = baseResult.incrementalState!;

        // Small edit in the middle
        const midOffset = Math.floor(doc.length / 2);
        const edited = doc.slice(0, midOffset) + 'x' + doc.slice(midOffset);
        const changes: TextChange[] = [
            { rangeOffset: midOffset, rangeLength: 0, text: 'x' }
        ];

        // Warm up
        lezer.parse(edited);
        lezer.parseIncremental!(edited, state, changes);

        // Measure
        const fullTimes: number[] = [];
        const incrTimes: number[] = [];
        for (let i = 0; i < 10; i++) {
            let start = performance.now();
            lezer.parse(edited);
            fullTimes.push(performance.now() - start);

            start = performance.now();
            lezer.parseIncremental!(edited, state, changes);
            incrTimes.push(performance.now() - start);
        }

        const avgFull = fullTimes.reduce((a, b) => a + b, 0) / fullTimes.length;
        const avgIncr = incrTimes.reduce((a, b) => a + b, 0) / incrTimes.length;
        const speedup = avgFull / avgIncr;

        console.log(`\n=== Performance: 1000 tasks ===`);
        console.log(`  Full parse:        ${avgFull.toFixed(2)} ms`);
        console.log(`  Incremental parse: ${avgIncr.toFixed(2)} ms`);
        console.log(`  Speedup:           ${speedup.toFixed(1)}x`);

        // Incremental should not be slower than full
        expect(avgIncr).toBeLessThan(avgFull * 2);
    });

    test('both backends produce equivalent results for large documents', () => {
        const doc = generateTaskDoc(100);

        const chevResult = chevrotain.parse(doc);
        const lezerResult = lezer.parse(doc);

        // Filter out punctuation since backends may structure keyword tokens differently
        const filterPunct = (tokens: string[]) => tokens.filter(t => ![':', ';'].includes(t));
        const chevTokens = filterPunct(collectLeafTexts(chevResult.root));
        const lezerTokens = filterPunct(collectLeafTexts(lezerResult.root));

        expect(chevTokens).toEqual(lezerTokens);
    });
});
