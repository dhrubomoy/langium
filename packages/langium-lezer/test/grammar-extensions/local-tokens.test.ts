/******************************************************************************
 * Phase 3: Local token group translation tests
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { generateLezerGrammarText } from '../test-helper.js';

describe('Local token block translation', () => {

    test('should emit @local tokens block with @else fallback', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: items+=Item*;
            Item: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            local tokens in Item {
                terminal LOCAL_INT: /[0-9]+/;
                terminal LOCAL_OP: /[+\\-]/;
            }
        `);
        expect(grammarText).toContain('@local tokens {');
        expect(grammarText).toContain('LOCAL_INT {');
        expect(grammarText).toContain('LOCAL_OP {');
        expect(grammarText).toContain('@else ItemContent');
        expect(grammarText).toContain('}');
    });

    test('should exclude local token names from @tokens block', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: items+=Item*;
            Item: name=ID;
            terminal ID: /[a-z]+/;
            terminal LOCAL_SPECIAL: /SPECIAL/;
            hidden terminal WS: /\\s+/;

            local tokens in Item {
                terminal LOCAL_SPECIAL: /[!@#]+/;
            }
        `);
        // Get the @tokens block content
        const tokensBlockMatch = grammarText.match(/@tokens \{([\s\S]*?)\}/);
        expect(tokensBlockMatch).toBeTruthy();
        // LOCAL_SPECIAL should NOT be in @tokens since it's a local token
        expect(tokensBlockMatch![1]).not.toContain('LOCAL_SPECIAL');
    });

    test('should translate local terminal regex bodies correctly', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: items+=Item*;
            Item: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            local tokens in Item {
                terminal Digits: /[0-9]+/;
            }
        `);
        // The regex /[0-9]+/ should be translated to Lezer syntax
        expect(grammarText).toMatch(/Digits\s*\{.*\$\[0-9\]\+/);
    });
});
