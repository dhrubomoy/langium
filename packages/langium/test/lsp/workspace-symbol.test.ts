/******************************************************************************
 * Copyright 2023 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test } from 'vitest';
import { expectWorkspaceSymbols, parseHelper } from 'langium/test';
import { BACKENDS } from '../langium-lezer-test.js';

const grammar = `
 grammar HelloWorld
 entry Model: persons+=Person;
 Person: 'Person' name=ID;
 terminal ID: /\\w+/;
 hidden terminal WS: /\\s+/;
 `.trim();

for (const { name, createServices } of BACKENDS) {
    describe(`Workspace symbols (${name})`, () => {

        test('Should show all workspace symbols', async () => {
            const services = await createServices({ grammar });
            if (!services) return;
            const symbols = expectWorkspaceSymbols(services.shared);
            const parser = parseHelper(services);
            await parser('Person Alice');
            await parser('Person Bob');
            await symbols({
                expectedSymbols: [
                    'Alice',
                    'Bob'
                ]
            });
        });

        test('Should show all workspace symbols matching the query', async () => {
            const services = await createServices({ grammar });
            if (!services) return;
            const symbols = expectWorkspaceSymbols(services.shared);
            const parser = parseHelper(services);
            await parser('Person Alice');
            await parser('Person Bob');
            await symbols({
                query: 'Ali',
                expectedSymbols: [
                    'Alice'
                ]
            });
        });
    });
}

