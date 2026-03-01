/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { eagerLoad } from 'langium-core';
import { BACKENDS } from '../langium-lezer-test.js';

/**
 * Regression test: eagerLoad must succeed for all backends.
 *
 * The LSP language server calls eagerLoad() during initialization to ensure all
 * services are constructed and event listeners are registered. If a backend module
 * fails to provide a required service (e.g., Hydrator), the server crashes.
 */

const GRAMMAR = `
grammar EagerLoadTest
entry Model: items+=Item*;
Item: 'item' name=ID;
terminal ID: /\\w+/;
hidden terminal WS: /\\s+/;
`;

for (const { name, createServices } of BACKENDS) {
    describe(`eagerLoad (${name})`, () => {
        test('should succeed without throwing', async () => {
            const services = await createServices({ grammar: GRAMMAR });
            if (!services) return;
            // This is what DefaultLanguageServer.initialize() does — it must not throw.
            expect(() => eagerLoad(services)).not.toThrow();
        });
    });
}
