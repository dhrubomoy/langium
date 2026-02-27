/******************************************************************************
 * Phase 3: External tokens + external context translation tests
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { generateLezerGrammarText, parseGrammarString } from '../test-helper.js';
import { LezerGrammarTranslator } from 'langium-lezer';

describe('External tokens translation', () => {

    test('should emit @external tokens declaration', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            external tokens from "./my-tokens" {
                INDENT, DEDENT, NEWLINE
            }
        `);
        expect(grammarText).toContain('@external tokens myTokens from "./my-tokens" { INDENT, DEDENT, NEWLINE }');
    });

    test('should derive camelCase tokenizer name from path', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            external tokens from "./indent-tracker" {
                INDENT
            }
        `);
        expect(grammarText).toContain('@external tokens indentTracker from "./indent-tracker"');
    });

    test('should exclude external token names from @tokens block', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            terminal INDENT: /INDENT_MARKER/;
            hidden terminal WS: /\\s+/;

            external tokens from "./tok" {
                INDENT
            }
        `);
        // INDENT should be in @external tokens, not in @tokens
        expect(grammarText).toContain('@external tokens tok from "./tok" { INDENT }');
        // The @tokens block should NOT contain INDENT
        const tokensBlockMatch = grammarText.match(/@tokens \{([\s\S]*?)\}/);
        expect(tokensBlockMatch).toBeTruthy();
        expect(tokensBlockMatch![1]).not.toContain('INDENT');
    });
});

describe('External context translation', () => {

    test('should emit @context declaration', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            external context myTracker from "./context-module";
        `);
        expect(grammarText).toContain('@context myTracker from "./context-module"');
    });

    test('should validate multiple external contexts as error', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            external context tracker1 from "./ctx1";
            external context tracker2 from "./ctx2";
        `);
        const translator = new LezerGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'error' && d.message.includes('Only one external context')
        )).toBe(true);
    });
});
