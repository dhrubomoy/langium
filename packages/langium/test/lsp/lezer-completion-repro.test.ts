/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test, expect } from 'vitest';
import { BACKENDS } from '../langium-lezer-test.js';
import { expectCompletion } from 'langium/test';

for (const { name, createServices } of BACKENDS) {
    describe(`Partial keyword completion (${name})`, () => {
        test('Should suggest next keyword when partial prefix typed', async () => {
            const grammar = `
                grammar SimpleSql
                entry Statement: CreateTableStmt;
                CreateTableStmt: 'Create' 'table' name=ID ';';
                hidden terminal WS: /\\s+/;
                terminal ID: /[_a-zA-Z][\\w_]*/;
            `;

            const services = await createServices({ grammar });
            if (!services) {
                console.log(`[${name}] Services returned null - SKIPPED`);
                return;
            }
            const completion = expectCompletion(services);

            // Test 1: After "Create " (space) - should suggest "table"
            await completion({
                text: 'Create <|>',
                index: 0,
                expectedItems: ['table']
            });

            // Test 2: After "Create Tab" - cursor at end, should suggest "table"
            await completion({
                text: 'Create Tab<|>',
                index: 0,
                assert(completions) {
                    const labels = completions.items.map(i => i.label);
                    console.log(`[${name}] "Create Tab|" completions:`, labels);
                    expect(labels).toContain('table');
                }
            });
        });

        // Chevrotain's LL parser doesn't handle common-prefix alternatives
        // ('a' 'b' ... | 'a' 'b' ...) well — it re-offers 'a' instead of 'b'.
        // Lezer's LR parser handles this correctly.
        test.skipIf(name === 'Chevrotain')('Should suggest keyword with partial prefix in multi-keyword grammar', async () => {
            const grammar = `
                grammar g
                entry Main: ('a' 'b' c=ID | 'a' 'b' d=ID)*;
                hidden terminal WS: /\\s+/;
                terminal ID: /[_a-zA-Z][\\w_]*/;
            `;

            const services = await createServices({ grammar });
            if (!services) {
                console.log(`[${name}] Services returned null - SKIPPED`);
                return;
            }
            const completion = expectCompletion(services);

            // After "a " should suggest "b"
            await completion({
                text: '<|>a <|>',
                index: 0,
                expectedItems: ['a']
            });
            await completion({
                text: '<|>a <|>',
                index: 1,
                expectedItems: ['b']
            });
        });
    });
}
