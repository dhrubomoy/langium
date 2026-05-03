/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Grammar } from 'langium';
import { EmptyFileSystem } from 'langium';
import { createLangiumGrammarServices } from 'langium/grammar';
import { parseHelper } from 'langium/test';
import { describe, expect, test } from 'vitest';

const services = createLangiumGrammarServices(EmptyFileSystem);
const parse = parseHelper<Grammar>(services.grammar);

describe('conflicts top-level declaration', () => {

    test('parses a single conflicts group with two rules', async () => {
        const grammar = `
        grammar Test
        conflicts: [RuleA, RuleB];
        RuleA: name='a';
        RuleB: name='b';
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const conflicts = result.parseResult.value.conflicts;
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].rules).toHaveLength(2);
        expect(conflicts[0].rules[0].$refText).toBe('RuleA');
        expect(conflicts[0].rules[1].$refText).toBe('RuleB');
    });

    test('grammar without a conflicts declaration has empty conflicts array', async () => {
        const grammar = `
        grammar Test
        RuleA: name='a';
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        expect(result.parseResult.value.conflicts).toEqual([]);
    });

    test('parses multiple conflicts groups in one declaration', async () => {
        const grammar = `
        grammar Test
        conflicts: [RuleA, RuleB], [RuleC, RuleD, RuleE];
        RuleA: name='a';
        RuleB: name='b';
        RuleC: name='c';
        RuleD: name='d';
        RuleE: name='e';
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const conflicts = result.parseResult.value.conflicts;
        expect(conflicts).toHaveLength(2);
        expect(conflicts[0].rules.map(r => r.$refText)).toEqual(['RuleA', 'RuleB']);
        expect(conflicts[1].rules.map(r => r.$refText)).toEqual(['RuleC', 'RuleD', 'RuleE']);
    });

    test('parses multiple separate conflicts declarations', async () => {
        const grammar = `
        grammar Test
        conflicts: [RuleA, RuleB];
        RuleA: name='a';
        RuleB: name='b';
        conflicts: [RuleC, RuleD];
        RuleC: name='c';
        RuleD: name='d';
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const conflicts = result.parseResult.value.conflicts;
        expect(conflicts).toHaveLength(2);
        expect(conflicts[0].rules.map(r => r.$refText)).toEqual(['RuleA', 'RuleB']);
        expect(conflicts[1].rules.map(r => r.$refText)).toEqual(['RuleC', 'RuleD']);
    });

    test('conflicts group with three rules', async () => {
        const grammar = `
        grammar Test
        conflicts: [RuleA, RuleB, RuleC];
        RuleA: name='a';
        RuleB: name='b';
        RuleC: name='c';
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const conflicts = result.parseResult.value.conflicts;
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].rules.map(r => r.$refText)).toEqual(['RuleA', 'RuleB', 'RuleC']);
    });

    test('conflicts cross-references resolve to actual rules', async () => {
        const grammar = `
        grammar Test
        conflicts: [RuleA, RuleB];
        RuleA: name='a';
        RuleB: name='b';
        `;

        const result = await parse(grammar, { validation: true });
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const conflicts = result.parseResult.value.conflicts;
        const ruleARef = conflicts[0].rules[0];
        const ruleBRef = conflicts[0].rules[1];
        expect(ruleARef.ref).toBeDefined();
        expect(ruleBRef.ref).toBeDefined();
        expect(ruleARef.ref?.name).toBe('RuleA');
        expect(ruleBRef.ref?.name).toBe('RuleB');
    });
});
