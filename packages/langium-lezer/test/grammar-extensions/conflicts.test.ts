/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { generateLezerGrammarText } from '../test-helper.js';

describe('Conflict markers translation', () => {

    test('should emit ~conflict markers in rule bodies', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry A: name=ID;
            B: val=ID;
            C: val=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            conflicts {
                [A, B];
            }
        `);
        // Both A and B should get conflict markers
        // A is the @top rule
        expect(grammarText).toMatch(/@top A\b[^{]*\{[^}]*~conflict_A_B/);
        expect(grammarText).toMatch(/B\b[^{]*\{[^}]*~conflict_A_B/);
    });

    test('should emit multiple conflict markers for rule in multiple sets', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry A: name=ID;
            B: val=ID;
            C: val=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            conflicts {
                [A, B];
                [A, C];
            }
        `);
        // A should have markers from both conflict sets
        expect(grammarText).toContain('~conflict_A_B');
        expect(grammarText).toContain('~conflict_A_C');
    });
});

describe('Dynamic precedence translation', () => {

    test('should emit @dynamicPrecedence annotation on rule', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Expr: name=ID @dynamicPrecedence(2);
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;
        `);
        expect(grammarText).toContain('[@dynamicPrecedence=2]');
    });

    test('should emit @dynamicPrecedence on non-entry rules', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: items+=Item*;
            Item: name=ID @dynamicPrecedence(3);
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;
        `);
        expect(grammarText).toMatch(/Item\[@dynamicPrecedence=3\]/);
    });
});
