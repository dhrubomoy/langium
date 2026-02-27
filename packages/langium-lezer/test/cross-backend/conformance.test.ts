/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test, expect, beforeAll } from 'vitest';
import type { ParserAdapter } from 'langium-core';
import type { LezerAdapter } from 'langium-lezer';
import {
    SIMPLE_GRAMMAR,
    LIST_GRAMMAR,
    ALTERNATIVES_GRAMMAR,
    OPTIONAL_GRAMMAR,
    createLezerAdapterForGrammar,
    createChevrotainAdapterForGrammar,
    collectLeafTexts,
    assertLeafSequenceEqual,
    assertDiagnosticsEquivalent
} from '../test-helper.js';

interface GrammarTestCase {
    name: string;
    grammar: string;
    validInputs: string[];
    invalidInputs: string[];
}

const testCases: GrammarTestCase[] = [
    {
        name: 'simple (keyword + terminal)',
        grammar: SIMPLE_GRAMMAR,
        validInputs: [
            'model foo',
            'model MyModel',
            'model _underscore',
        ],
        invalidInputs: [
            'invalid',
            '42',
            '',
        ],
    },
    {
        name: 'list (repeated items)',
        grammar: LIST_GRAMMAR,
        validInputs: [
            'model foo',
            'model foo item bar',
            'model foo item bar item baz',
            'model Test item A item B item C',
        ],
        invalidInputs: [
            'item foo',
            'model',
            'invalid junk',
        ],
    },
    {
        name: 'alternatives',
        grammar: ALTERNATIVES_GRAMMAR,
        validInputs: [
            'a foo',
            'b 42',
            'a foo b 42',
            'a x a y b 1 b 2',
        ],
        invalidInputs: [
            'c foo',
            'a 42',  // 'a' expects ID not INT
        ],
    },
    {
        name: 'optional fields',
        grammar: OPTIONAL_GRAMMAR,
        validInputs: [
            'person Alice',
            'person Alice 30',
            'person Bob 25',
        ],
        invalidInputs: [
            'person',
            'Alice',
            '',
        ],
    },
];

describe('Cross-backend conformance', () => {
    for (const tc of testCases) {
        describe(`grammar: ${tc.name}`, () => {
            let chevrotainAdapter: ParserAdapter;
            let lezerAdapter: LezerAdapter;

            beforeAll(async () => {
                const chev = await createChevrotainAdapterForGrammar(tc.grammar);
                chevrotainAdapter = chev.adapter;

                const lezer = await createLezerAdapterForGrammar(tc.grammar);
                lezerAdapter = lezer.adapter;
            });

            // ---- Valid inputs ----

            for (const input of tc.validInputs) {
                test(`both accept valid input: "${input}"`, () => {
                    const chevResult = chevrotainAdapter.parse(input);
                    const lezerResult = lezerAdapter.parse(input);

                    expect(chevResult.root.diagnostics).toHaveLength(0);
                    expect(lezerResult.root.diagnostics).toHaveLength(0);
                });

                test(`same fullText for: "${input}"`, () => {
                    const chevResult = chevrotainAdapter.parse(input);
                    const lezerResult = lezerAdapter.parse(input);

                    expect(chevResult.root.fullText).toBe(input);
                    expect(lezerResult.root.fullText).toBe(input);
                });

                test(`same root span for: "${input}"`, () => {
                    const chevResult = chevrotainAdapter.parse(input);
                    const lezerResult = lezerAdapter.parse(input);

                    expect(chevResult.root.offset).toBe(0);
                    expect(lezerResult.root.offset).toBe(0);
                    expect(chevResult.root.end).toBe(input.length);
                    expect(lezerResult.root.end).toBe(input.length);
                });

                test(`same leaf token sequence for: "${input}"`, () => {
                    const chevResult = chevrotainAdapter.parse(input);
                    const lezerResult = lezerAdapter.parse(input);

                    assertLeafSequenceEqual(chevResult.root, lezerResult.root);
                });

                test(`both have children for: "${input}"`, () => {
                    const chevResult = chevrotainAdapter.parse(input);
                    const lezerResult = lezerAdapter.parse(input);

                    expect(chevResult.root.children.length).toBeGreaterThan(0);
                    expect(lezerResult.root.children.length).toBeGreaterThan(0);
                });
            }

            // ---- Invalid inputs ----

            for (const input of tc.invalidInputs) {
                test(`both reject invalid input: "${input}"`, () => {
                    const chevResult = chevrotainAdapter.parse(input);
                    const lezerResult = lezerAdapter.parse(input);

                    assertDiagnosticsEquivalent(
                        chevResult.root.diagnostics,
                        lezerResult.root.diagnostics
                    );
                });
            }
        });
    }
});

describe('Cross-backend leaf text comparison', () => {
    test('simple grammar: leaf texts match', async () => {
        const chev = await createChevrotainAdapterForGrammar(LIST_GRAMMAR);
        const lezer = await createLezerAdapterForGrammar(LIST_GRAMMAR);

        const text = 'model foo item bar item baz';
        const chevLeaves = collectLeafTexts(chev.adapter.parse(text).root);
        const lezerLeaves = collectLeafTexts(lezer.adapter.parse(text).root);

        expect(chevLeaves).toEqual(lezerLeaves);
    });

    test('optional grammar with present field: leaf texts match', async () => {
        const chev = await createChevrotainAdapterForGrammar(OPTIONAL_GRAMMAR);
        const lezer = await createLezerAdapterForGrammar(OPTIONAL_GRAMMAR);

        const text = 'person Alice 30';
        const chevLeaves = collectLeafTexts(chev.adapter.parse(text).root);
        const lezerLeaves = collectLeafTexts(lezer.adapter.parse(text).root);

        expect(chevLeaves).toEqual(lezerLeaves);
    });

    test('optional grammar with absent field: leaf texts match', async () => {
        const chev = await createChevrotainAdapterForGrammar(OPTIONAL_GRAMMAR);
        const lezer = await createLezerAdapterForGrammar(OPTIONAL_GRAMMAR);

        const text = 'person Alice';
        const chevLeaves = collectLeafTexts(chev.adapter.parse(text).root);
        const lezerLeaves = collectLeafTexts(lezer.adapter.parse(text).root);

        expect(chevLeaves).toEqual(lezerLeaves);
    });
});
