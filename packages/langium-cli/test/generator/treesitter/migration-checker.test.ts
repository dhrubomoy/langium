/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { EmptyFileSystem, type Grammar } from 'langium';
import { createLangiumGrammarServices } from 'langium/grammar';
import { parseHelper } from 'langium/test';
import { describe, expect, test } from 'vitest';
import { checkMigration } from '../../../src/generator/treesitter/migration-checker.js';

const services = createLangiumGrammarServices(EmptyFileSystem);
const parse = parseHelper<Grammar>(services.grammar);

async function parseGrammar(input: string): Promise<Grammar> {
    const document = await parse(input);
    return document.parseResult.value;
}

describe('migration-checker', () => {

    test('flags unordered groups with the `&` rewrite hint', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry R: a=ID & b=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const errors = checkMigration(grammar);
        const unordered = errors.filter(e => e.feature === 'UnorderedGroup');
        expect(unordered).toHaveLength(1);
        expect(unordered[0].hint).toContain('unordered groups');
        expect(unordered[0].message).toContain("rule 'R'");
    });

    test('flags rule parameters with the inline-rules hint', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry R<P>: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const errors = checkMigration(grammar);
        const params = errors.filter(e => e.feature === 'RuleParameter');
        expect(params).toHaveLength(1);
        expect(params[0].hint).toContain('parameters');
        expect(params[0].message).toContain("Rule 'R'");
        expect(params[0].message).toContain("parameter 'P'");
    });

    test('flags guard conditions with the split-rule hint', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry R<P>: <P> a=ID | b=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const errors = checkMigration(grammar);
        const guards = errors.filter(e => e.feature === 'GuardCondition');
        expect(guards).toHaveLength(1);
        expect(guards[0].hint).toContain('semantic predicates');
        expect(guards[0].message).toContain("rule 'R'");
    });

    test('flags negated tokens with the positive-regex hint', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry R: name=ID;
            terminal NotID: !ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const errors = checkMigration(grammar);
        const negated = errors.filter(e => e.feature === 'NegatedToken');
        expect(negated).toHaveLength(1);
        expect(negated[0].hint).toContain('positive regex');
        expect(negated[0].message).toContain("rule 'NotID'");
    });

    test('flags until-tokens with the regex-up-to hint', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry R: name=ID;
            terminal BLOCK_COMMENT: '/*' -> '*/';
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const errors = checkMigration(grammar);
        const until = errors.filter(e => e.feature === 'UntilToken');
        expect(until).toHaveLength(1);
        expect(until[0].hint).toContain('until-tokens');
        expect(until[0].message).toContain("rule 'BLOCK_COMMENT'");
    });

    test('flags terminal lookahead assertions with the rewrite hint', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry R: name=ID;
            terminal STRING: '"' (?= '"') '"';
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const errors = checkMigration(grammar);
        const lookahead = errors.filter(e => e.feature === 'LookaheadAssertion');
        expect(lookahead.length).toBeGreaterThanOrEqual(1);
        expect(lookahead[0].hint).toContain('lookahead assertions');
        expect(lookahead[0].message).toContain("'?='");
        expect(lookahead[0].message).toContain("rule 'STRING'");
    });

    test('returns an empty list for a clean grammar', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry R: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        expect(checkMigration(grammar)).toEqual([]);
    });

    test('reports every dropped feature in a single grammar', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry R<P>: <P> a=ID | c=ID;
            U: x=ID & y=ID;
            terminal NotID: !ID;
            terminal BLOCK_COMMENT: '/*' -> '*/';
            terminal LOOK: '"' (?! '"') '"';
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const features = new Set(checkMigration(grammar).map(e => e.feature));
        expect(features).toEqual(new Set([
            'UnorderedGroup',
            'RuleParameter',
            'GuardCondition',
            'NegatedToken',
            'UntilToken',
            'LookaheadAssertion'
        ]));
    });
});
