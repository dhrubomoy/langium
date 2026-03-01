/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test } from 'vitest';
import { expectFindReferences } from 'langium/test';
import { BACKENDS } from '../langium-lezer-test.js';

// Grammar without alternatives (Lezer-compatible).
// Cross-references: Greeting.person=[Person]
const GRAMMAR = `
grammar RefTest
entry Model: persons+=Person* greetings+=Greeting*;
Person: 'person' name=ID;
Greeting: 'hello' person=[Person] '!';
terminal ID: /\\w+/;
hidden terminal WS: /\\s+/;
`;

for (const { name, createServices } of BACKENDS) {
    describe(`Find References (${name})`, () => {

        test('Should find declaration reference only (include decl, no cross-ref)', async () => {
            const services = await createServices({ grammar: GRAMMAR });
            if (!services) return;
            const findReferences = expectFindReferences(services);
            await findReferences({
                text: 'person <|<|>Alice|>',
                includeDeclaration: true,
            });
        });

        test('Should find declaration and cross-reference from declaration position', async () => {
            const services = await createServices({ grammar: GRAMMAR });
            if (!services) return;
            const findReferences = expectFindReferences(services);
            // Cursor at declaration position — finds self + cross-ref from index
            await findReferences({
                text: `
                    person <|<|>Alice|>
                    hello <|Alice|> !
                `,
                includeDeclaration: true,
            });
        });

        test('Should find only cross-reference when excluding declaration', async () => {
            const services = await createServices({ grammar: GRAMMAR });
            if (!services) return;
            const findReferences = expectFindReferences(services);
            await findReferences({
                text: `
                    person <|>Alice
                    hello <|Alice|> !
                `,
                includeDeclaration: false,
            });
        });

        test('Should find multiple cross-references from declaration', async () => {
            const services = await createServices({ grammar: GRAMMAR });
            if (!services) return;
            const findReferences = expectFindReferences(services);
            await findReferences({
                text: `
                    person <|<|>Bob|>
                    hello <|Bob|> !
                    hello <|Bob|> !
                `,
                includeDeclaration: true,
            });
        });
    });
}
