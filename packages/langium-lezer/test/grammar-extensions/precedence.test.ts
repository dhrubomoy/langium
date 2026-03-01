/******************************************************************************
 * Phase 3: Precedence blocks + @precMarker translation tests
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { generateLezerGrammarText, parseGrammarString } from '../test-helper.js';
import { LezerGrammarTranslator } from 'langium-lezer';

describe('Precedence translation', () => {

    test('should emit @precedence declaration from PrecedenceBlock', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Expr: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            precedence {
                Add left assoc;
                Mul left assoc;
                Unary;
            }
        `);
        expect(grammarText).toContain('@precedence { Add @left, Mul @left, Unary @left }');
    });

    test('should emit right-associative precedence levels', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Expr: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            precedence {
                Assign right assoc;
                Add left assoc;
            }
        `);
        expect(grammarText).toContain('@precedence { Assign @right, Add @left }');
    });

    test('should merge PrecedenceBlock with infix rule levels', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Expr: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            infix BinExpr on Expr: '+' | '-' > '*' | '/';

            precedence {
                High;
                Low;
            }
        `);
        // PrecedenceBlock levels come first, then infix-generated levels
        expect(grammarText).toContain('@precedence {');
        expect(grammarText).toMatch(/High @left.*Low @left.*prec_BinExpr_0 @left.*prec_BinExpr_1 @left/);
    });

    test('should emit !tag marker for @precMarker on elements', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Expr: name=ID @precMarker=Add;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            precedence {
                Add left assoc;
            }
        `);
        expect(grammarText).toContain('!Add');
    });

    test('should validate undefined @precMarker tag', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Expr: name=ID @precMarker=Unknown;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            precedence {
                Add left assoc;
            }
        `);
        const translator = new LezerGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'error' && d.message.includes("'Unknown'")
        )).toBe(true);
    });

    test('should validate duplicate precedence level names', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Expr: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            precedence {
                Add left assoc;
                Add right assoc;
            }
        `);
        const translator = new LezerGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'error' && d.message.includes("Duplicate precedence level 'Add'")
        )).toBe(true);
    });

    test('should emit @precedence before @top in output order', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: items+=Item*;
            Item: name=ID;
            terminal ID: /[_a-zA-Z][\\w_]*/;
            hidden terminal WS: /\\s+/;

            precedence {
                High left assoc;
                Low left assoc;
            }
        `);
        const precIdx = grammarText.indexOf('@precedence');
        const topIdx = grammarText.indexOf('@top');
        expect(precIdx).toBeGreaterThanOrEqual(0);
        expect(topIdx).toBeGreaterThanOrEqual(0);
        expect(precIdx).toBeLessThan(topIdx);
    });
});
