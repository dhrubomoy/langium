/******************************************************************************
 * Phase 3: Specialize / Extend block translation tests
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { generateLezerGrammarText, parseGrammarString } from '../test-helper.js';
import { LezerGrammarTranslator } from 'langium-lezer';

describe('Specialize block translation', () => {

    test('should emit @specialize rules for each mapping', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            specialize ID {
                "if" => IfKeyword;
                "else" => ElseKeyword;
                "while" => WhileKeyword;
            }
        `);
        expect(grammarText).toContain('IfKeyword { @specialize[@name={IfKeyword}]<Identifier, "if"> }');
        expect(grammarText).toContain('ElseKeyword { @specialize[@name={ElseKeyword}]<Identifier, "else"> }');
        expect(grammarText).toContain('WhileKeyword { @specialize[@name={WhileKeyword}]<Identifier, "while"> }');
    });

    test('should add specialize source strings to keywords set', async () => {
        const { keywords } = await generateLezerGrammarText(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            specialize ID {
                "if" => IfKeyword;
                "else" => ElseKeyword;
            }
        `);
        expect(keywords.has('if')).toBe(true);
        expect(keywords.has('else')).toBe(true);
    });

    test('should validate duplicate specialize mappings', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            specialize ID {
                "if" => IfKeyword;
                "if" => IfKeyword2;
            }
        `);
        const translator = new LezerGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'warning' && d.message.includes("Duplicate specialize mapping for 'if'")
        )).toBe(true);
    });
});

describe('Extend block translation', () => {

    test('should emit @extend rules for each mapping', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            extend ID {
                "true" => BoolTrue;
                "false" => BoolFalse;
            }
        `);
        expect(grammarText).toContain('BoolTrue { @extend[@name={BoolTrue}]<Identifier, "true"> }');
        expect(grammarText).toContain('BoolFalse { @extend[@name={BoolFalse}]<Identifier, "false"> }');
    });

    test('should add extend source strings to keywords set', async () => {
        const { keywords } = await generateLezerGrammarText(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            extend ID {
                "async" => AsyncKeyword;
            }
        `);
        expect(keywords.has('async')).toBe(true);
    });
});
