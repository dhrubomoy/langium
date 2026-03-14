/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { createLezerAdapterForGrammar, generateLezerGrammarText } from '../test-helper.js';

describe('Native terminal translation', () => {

    test('should emit native body verbatim in @tokens block', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            terminal Number returns number: native '@digit+';
            hidden terminal WS: /\\s+/;
        `);
        expect(grammarText).toContain('Number { @digit+ }');
    });

    test('should support native terminal with complex Lezer syntax', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            terminal HexString: native '"0" ("x" | "X") $[0-9a-fA-F]+';
            hidden terminal WS: /\\s+/;
        `);
        expect(grammarText).toContain('HexString { "0" ("x" | "X") $[0-9a-fA-F]+ }');
    });

    test('should support hidden native terminal', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: name=ID;
            terminal ID: /[a-z]+/;
            hidden terminal BlockComment: native '"/*" (![*] | "*" ![/])* "*/"';
        `);
        expect(grammarText).toContain('BlockComment { "/*" (![*] | "*" ![/])* "*/" }');
    });

    test('should mix native and regex terminals', async () => {
        const { grammarText } = await generateLezerGrammarText(`
            grammar Test
            entry Model: name=ID value=Number;
            terminal ID: /[a-z]+/;
            terminal Number returns number: native '@digit+';
            hidden terminal WS: /\\s+/;
        `);
        // ID is renamed to Identifier in Lezer grammar output
        expect(grammarText).toContain('Identifier { $[a-z]+ }');
        expect(grammarText).toContain('Number { @digit+ }');
    });

    test('should parse input using native terminal', async () => {
        const { adapter } = await createLezerAdapterForGrammar(`
            grammar Test
            entry Model: 'value' '=' num=Number;
            terminal Number returns number: native '@digit+';
            hidden terminal WS: /\\s+/;
            terminal ID: /[a-z]+/;
        `);
        const result = adapter.parse('value = 42');
        expect(result.root).toBeDefined();
        expect(result.root.children.length).toBeGreaterThan(0);
    });
});
