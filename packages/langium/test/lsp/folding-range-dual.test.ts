/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test } from 'vitest';
import { expectFoldings } from 'langium/test';
import { BACKENDS } from '../langium-lezer-test.js';

// Grammar without alternatives (Lezer-compatible).
// Uses block syntax with braces for multi-line folding.
const GRAMMAR = `
grammar FoldTest
entry Model: items+=Item*;
Item: 'item' name=ID '{' props+=Prop* '}';
Prop: name=ID;
terminal ID: /[_a-zA-Z]\\w*/;
hidden terminal WS: /\\s+/;
hidden terminal ML_COMMENT: /\\/\\*[\\s\\S]*?\\*\\//;
`;

// Note: The folding range provider excludes the last line for nodes ending in }
// and for comments. The |> marker must be on the line BEFORE the closing token.
// Folding ranges require at least 3 lines (2+ line difference).

for (const { name, createServices } of BACKENDS) {
    describe(`Folding Range (${name})`, () => {

        test('Should provide folding range for block with braces', async () => {
            const services = await createServices({ grammar: GRAMMAR });
            if (!services) return;
            const foldings = expectFoldings(services);
            await foldings({
                text: `
<|item Person {
    firstName
    lastName|>
}
                `
            });
        });

        test('Should provide folding ranges for multiple blocks', async () => {
            const services = await createServices({ grammar: GRAMMAR });
            if (!services) return;
            const foldings = expectFoldings(services);
            await foldings({
                text: `
<|item Base {
    id|>
}
<|item Child {
    extra|>
}
                `
            });
        });

        // Lezer does not expose comment token types for folding
        if (name !== 'Lezer') {
            test('Should provide folding range for multi-line comment', async () => {
                const services = await createServices({ grammar: GRAMMAR });
                if (!services) return;
                const foldings = expectFoldings(services);
                await foldings({
                    text: `
<|/*
 * A multi-line
 * comment|>
 */
item Person {}
                    `
                });
            });
        }
    });
}
