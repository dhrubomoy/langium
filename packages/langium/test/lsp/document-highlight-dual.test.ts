/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test } from 'vitest';
import { expectHighlight } from 'langium/test';
import { BACKENDS } from '../langium-lezer-test.js';

// Grammar without alternatives (Lezer-compatible).
const GRAMMAR = `
grammar HighlightTest
entry Model: persons+=Person* greetings+=Greeting*;
Person: 'person' name=ID;
Greeting: 'hello' person=[Person] '!';
terminal ID: /\\w+/;
hidden terminal WS: /\\s+/;
`;

for (const { name, createServices } of BACKENDS) {
    describe(`Document Highlight (${name})`, () => {

        test('Should highlight declaration name', async () => {
            const services = await createServices({ grammar: GRAMMAR });
            if (!services) return;
            const highlights = expectHighlight(services);
            await highlights({
                text: 'person <|Ali<|>ce|>',
            });
        });

        test('Should highlight declaration and cross-reference from declaration', async () => {
            const services = await createServices({ grammar: GRAMMAR });
            if (!services) return;
            const highlights = expectHighlight(services);
            // Cursor at declaration — highlights both declaration and cross-reference
            await highlights({
                text: `
                    person <|Ali<|>ce|>
                    hello <|Alice|> !
                `,
            });
        });

        test('Should highlight multiple cross-references from declaration', async () => {
            const services = await createServices({ grammar: GRAMMAR });
            if (!services) return;
            const highlights = expectHighlight(services);
            await highlights({
                text: `
                    person <|Bo<|>b|>
                    hello <|Bob|> !
                    hello <|Bob|> !
                `,
            });
        });
    });
}
