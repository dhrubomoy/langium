/******************************************************************************
 * Phase 3: Chevrotain backend diagnostics for unsupported grammar extensions
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { parseGrammarString } from '../test-helper.js';
import { ChevrotainGrammarTranslator } from 'langium-chevrotain';

describe('Chevrotain unsupported features (errors)', () => {

    test('should error on external context', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            external context myTracker from "./context";
        `);
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'error' && d.message.includes('External context trackers require the Lezer backend')
        )).toBe(true);
    });

    test('should error on conflict declarations', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Expr: name=ID;
            Type: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            conflicts {
                [Expr, Type]
            }
        `);
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'error' && d.message.includes('Conflict declarations require the Lezer backend')
        )).toBe(true);
        expect(diagnostics.some(d =>
            d.severity === 'error' && d.message.includes('Expr') && d.message.includes('Type')
        )).toBe(true);
    });

    test('should error on @dynamicPrecedence', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Expr: name=ID @dynamicPrecedence(2);
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;
        `);
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'error' && d.message.includes('Dynamic precedence requires the Lezer backend')
        )).toBe(true);
    });
});

describe('Chevrotain partially supported features (warnings)', () => {

    test('should warn on @precMarker usage', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Expr: name=ID @precMarker=Add;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            precedence {
                Add left assoc;
            }
        `);
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'warning' && d.message.includes('Precedence markers are desugared for Chevrotain')
        )).toBe(true);
    });

    test('should warn on extend blocks', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            extend ID {
                'async' => AsyncKw;
            }
        `);
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'warning' && d.message.includes('Token extension has limited support with Chevrotain')
        )).toBe(true);
    });

    test('should warn on external tokens', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            external tokens from "./my-tokenizer" {
                INDENT, DEDENT
            }
        `);
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'warning' && d.message.includes('External tokens are mapped to custom matcher interface')
        )).toBe(true);
    });

    test('should warn on local token groups', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Model: items+=Item*;
            Item: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            local tokens in Item {
                terminal LOCAL_TOK: /[0-9]+/;
            }
        `);
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'warning' && d.message.includes('Local token groups are mapped to Chevrotain lexer modes')
        )).toBe(true);
    });
});

describe('Chevrotain shared validations', () => {

    test('should error on duplicate precedence level names', async () => {
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
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'error' && d.message.includes("Duplicate precedence level 'Add'")
        )).toBe(true);
    });

    test('should error on undefined @precMarker tag', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Expr: name=ID @precMarker=Unknown;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            precedence {
                Add left assoc;
            }
        `);
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'error' && d.message.includes("'Unknown'")
        )).toBe(true);
    });

    test('should error on multiple external contexts', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            external context tracker1 from "./ctx1";
            external context tracker2 from "./ctx2";
        `);
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'error' && d.message.includes('Only one external context')
        )).toBe(true);
    });

    test('should warn on duplicate specialize mappings', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            specialize ID {
                'if' => IfKw;
                'if' => IfKw2;
            }
        `);
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.some(d =>
            d.severity === 'warning' && d.message.includes("Duplicate specialize mapping for 'if'")
        )).toBe(true);
    });

    test('should produce no errors for a simple grammar without Phase 3 features', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;
        `);
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        expect(diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
        expect(diagnostics.filter(d => d.severity === 'warning')).toHaveLength(0);
    });

    test('should accept specialize blocks without warnings (supported feature)', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            specialize ID {
                'if' => IfKw;
                'else' => ElseKw;
            }
        `);
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        // Specialize is supported by Chevrotain — no warnings or errors
        expect(diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
        expect(diagnostics.filter(d => d.severity === 'warning')).toHaveLength(0);
    });

    test('should accept precedence blocks without errors (informational only)', async () => {
        const grammar = await parseGrammarString(`
            grammar Test
            entry Expr: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal WS: /\\s+/;

            precedence {
                Add left assoc;
                Mul left assoc;
            }
        `);
        const translator = new ChevrotainGrammarTranslator();
        const diagnostics = translator.validate(grammar);
        // Precedence blocks are accepted (Chevrotain uses a different model)
        expect(diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
    });
});
