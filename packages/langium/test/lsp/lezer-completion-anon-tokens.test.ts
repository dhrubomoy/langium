/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test } from 'vitest';
import { expectCompletion } from 'langium/test';
import { createLezerServicesForGrammar } from '../langium-lezer-test.js';

/**
 * Tests for Lezer completion with anonymous (non-identifier) tokens.
 *
 * In Lezer, non-identifier keywords like "(", ")", "*", "?", "=", ";" are
 * anonymous inline tokens that don't appear in the parse tree (or appear with
 * empty type names). The completion engine's grammar walk skips them, which
 * means it cannot distinguish between alternatives that differ only by an
 * anonymous token prefix.
 *
 * Tests marked with `test.fails` document the known bug: they describe the
 * CORRECT expected behavior but currently fail because anonymous tokens are
 * invisible to the grammar walk. When the bug is fixed, these tests will
 * start passing and vitest will flag them (test.fails expects failure).
 */

describe('Lezer completion — anonymous token disambiguation', () => {

    // Grammar where the discriminator between alternatives is a non-identifier
    // keyword (anonymous in Lezer's tree). After typing "ab ?", the walk should
    // know the second alternative was taken and only suggest "xef". But since
    // "*" and "?" are anonymous, the walk can't tell which alternative matched.
    const ANON_ALT_GRAMMAR = `
        grammar AnonAltTest
        entry Model: items+=SomeRule*;
        SomeRule: 'ab' (('*' 'xcd') | ('?' 'xef'));
        hidden terminal WS: /\\s+/;
        terminal ID: /[_a-zA-Z][\\w_]*/;
    `;

    // BUG: Walk skips anonymous "?" so it can't disambiguate alternatives.
    // Actual: suggests "*" and "?" (the anonymous first-features of each alt)
    // instead of "xef" (the correct next keyword after "?").
    test('After typing "ab ? x", should suggest "xef" but not "xcd"', async () => {
        const services = await createLezerServicesForGrammar({ grammar: ANON_ALT_GRAMMAR });
        if (!services) return;
        const completion = expectCompletion(services);

        await completion({
            text: 'ab ? x<|>',
            index: 0,
            expectedItems: ['xef']
        });
    });

    // BUG: Same issue — walk can't see that "*" was typed.
    test('After typing "ab * x", should suggest "xcd" but not "xef"', async () => {
        const services = await createLezerServicesForGrammar({ grammar: ANON_ALT_GRAMMAR });
        if (!services) return;
        const completion = expectCompletion(services);

        await completion({
            text: 'ab * x<|>',
            index: 0,
            expectedItems: ['xcd']
        });
    });

    // BUG: Before any discriminator is typed, should offer all first-features
    // of both alternatives (including the anonymous tokens "*", "?" and the
    // identifier keywords "xcd", "xef"). Currently only offers "*" and "?".
    test('After typing "ab ", should suggest both alternatives including identifier keywords', async () => {
        const services = await createLezerServicesForGrammar({ grammar: ANON_ALT_GRAMMAR });
        if (!services) return;
        const completion = expectCompletion(services);

        await completion({
            text: 'ab <|>',
            index: 0,
            expectedItems: ['xcd', 'xef', '*', '?']
        });
    });
});

describe('Lezer completion — paired delimiter disambiguation', () => {

    // Grammar with alternatives discriminated by anonymous delimiters: ( vs [
    const PAREN_GRAMMAR = `
        grammar ParenTest
        entry Model: items+=Item*;
        Item: 'begin' ('(' name=ID ')' 'end' | '[' name=ID ']' 'done');
        hidden terminal WS: /\\s+/;
        terminal ID: /[_a-zA-Z][\\w_]*/;
    `;

    // PASSES: The "(" alternative works because the ID child ("foo") gets
    // consumed by the walk, advancing past the anonymous parens to "end".
    test('After typing "begin ( foo )", should suggest "end" but not "done"', async () => {
        const services = await createLezerServicesForGrammar({ grammar: PAREN_GRAMMAR });
        if (!services) return;
        const completion = expectCompletion(services);

        await completion({
            text: 'begin ( foo ) <|>',
            index: 0,
            expectedItems: ['end']
        });
    });

    // BUG: The "[" alternative fails — the walk sees the same matched children
    // (an ID node for "foo") and picks the first alternative ("(" path) which
    // leads to suggesting "end" instead of "done".
    test('After typing "begin [ foo ]", should suggest "done" but not "end"', async () => {
        const services = await createLezerServicesForGrammar({ grammar: PAREN_GRAMMAR });
        if (!services) return;
        const completion = expectCompletion(services);

        await completion({
            text: 'begin [ foo ] <|>',
            index: 0,
            expectedItems: ['done']
        });
    });
});

describe('Lezer completion — operator alternative disambiguation', () => {

    // Alternatives discriminated by operator tokens (+ vs -)
    const OPERATOR_ALT_GRAMMAR = `
        grammar OpAltTest
        entry Model: items+=BinExpr*;
        BinExpr: left=ID ('+' 'plus_kw' | '-' 'minus_kw') right=ID ';';
        hidden terminal WS: /\\s+/;
        terminal ID: /[_a-zA-Z][\\w_]*/;
    `;

    // BUG: After "a +", the walk should be inside the first alternative and
    // suggest "plus_kw". But "+" is anonymous, so the walk falls back to
    // offering first-features of all alternatives (which are also anonymous),
    // resulting in zero keyword completions.
    test('After typing "a + ", should suggest "plus_kw" but not "minus_kw"', async () => {
        const services = await createLezerServicesForGrammar({ grammar: OPERATOR_ALT_GRAMMAR });
        if (!services) return;
        const completion = expectCompletion(services);

        await completion({
            text: 'a + <|>',
            index: 0,
            expectedItems: ['plus_kw']
        });
    });

    // BUG: Same — "-" is anonymous, walk can't disambiguate.
    test('After typing "a - ", should suggest "minus_kw" but not "plus_kw"', async () => {
        const services = await createLezerServicesForGrammar({ grammar: OPERATOR_ALT_GRAMMAR });
        if (!services) return;
        const completion = expectCompletion(services);

        await completion({
            text: 'a - <|>',
            index: 0,
            expectedItems: ['minus_kw']
        });
    });
});

describe('Lezer completion — sequential anonymous tokens', () => {

    const SEQ_GRAMMAR = `
        grammar SeqTest
        entry Model: items+=Expr*;
        Expr: name=ID '=' value=ID ';';
        hidden terminal WS: /\\s+/;
        terminal ID: /[_a-zA-Z][\\w_]*/;
    `;

    // PASSES: After "x = y", both ID assignments are consumed by the walk.
    // The remaining elements "=" and ";" are anonymous and skipped, leaving
    // no completions — which is correct for this position.
    test('After typing "x = y", should not suggest "=" again', async () => {
        const services = await createLezerServicesForGrammar({ grammar: SEQ_GRAMMAR });
        if (!services) return;
        const completion = expectCompletion(services);

        await completion({
            text: 'x = y <|>',
            index: 0,
            expectedItems: []
        });
    });
});
