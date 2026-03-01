/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import type { DocumentSymbol } from 'vscode-languageserver';
import { expectSymbols } from 'langium/test';
import { BACKENDS } from '../langium-lezer-test.js';

// Grammar without alternatives (Lezer-compatible).
const GRAMMAR = `
grammar SymbolTest
entry Model: items+=Item*;
Item: 'item' name=ID;
terminal ID: /\\w+/;
hidden terminal WS: /\\s+/;
`;

function flatSymbolNames(symbols: DocumentSymbol[]): string[] {
    const names: string[] = [];
    for (const sym of symbols) {
        names.push(sym.name);
        if (sym.children) {
            names.push(...flatSymbolNames(sym.children));
        }
    }
    return names;
}

for (const { name, createServices } of BACKENDS) {
    describe(`Document Symbols (${name})`, () => {

        test('Should show single item as document symbol', async () => {
            const services = await createServices({ grammar: GRAMMAR });
            if (!services) return;
            const symbols = expectSymbols(services);
            await symbols({
                text: 'item Person',
                assert: (syms) => {
                    const names = flatSymbolNames(syms);
                    expect(names).toContain('Person');
                }
            });
        });

        test('Should show multiple items as document symbols', async () => {
            const services = await createServices({ grammar: GRAMMAR });
            if (!services) return;
            const symbols = expectSymbols(services);
            await symbols({
                text: 'item Alice item Bob item Charlie',
                assert: (syms) => {
                    const names = flatSymbolNames(syms);
                    expect(names).toContain('Alice');
                    expect(names).toContain('Bob');
                    expect(names).toContain('Charlie');
                    expect(names).toHaveLength(3);
                }
            });
        });

        test('Should show no symbols for empty document', async () => {
            const services = await createServices({ grammar: GRAMMAR });
            if (!services) return;
            const symbols = expectSymbols(services);
            await symbols({
                text: '',
                assert: (syms) => {
                    expect(syms).toHaveLength(0);
                }
            });
        });
    });
}
