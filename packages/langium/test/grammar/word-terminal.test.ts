/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Grammar } from 'langium';
import { EmptyFileSystem, GrammarAST } from 'langium';
import { createLangiumGrammarServices } from 'langium/grammar';
import { parseHelper } from 'langium/test';
import { describe, expect, test } from 'vitest';

const services = createLangiumGrammarServices(EmptyFileSystem);
const parse = parseHelper<Grammar>(services.grammar);

describe('@word terminal annotation', () => {

    test('parses a terminal rule prefixed with @word and sets isWord=true', async () => {
        const grammar = `
        grammar Test
        @word terminal ID: /[a-zA-Z_][\\w]*/;
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const terminal = result.parseResult.value.rules.find(GrammarAST.isTerminalRule);
        expect(terminal).toBeDefined();
        expect(terminal!.name).toBe('ID');
        expect(terminal!.isWord).toBe(true);
    });

    test('terminal rule without @word has isWord=false', async () => {
        const grammar = `
        grammar Test
        terminal ID: /[a-zA-Z_][\\w]*/;
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const terminal = result.parseResult.value.rules.find(GrammarAST.isTerminalRule);
        expect(terminal).toBeDefined();
        expect(terminal!.isWord).toBeFalsy();
    });

    test('@word combines with hidden terminal modifier', async () => {
        const grammar = `
        grammar Test
        @word hidden terminal WS: /\\s+/;
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const terminal = result.parseResult.value.rules.find(GrammarAST.isTerminalRule);
        expect(terminal).toBeDefined();
        expect(terminal!.isWord).toBe(true);
        expect(terminal!.hidden).toBe(true);
    });

    test('@word coexists with other terminals in the same grammar', async () => {
        const grammar = `
        grammar Test
        @word terminal ID: /[a-zA-Z_][\\w]*/;
        terminal NUMBER returns number: /[0-9]+/;
        hidden terminal WS: /\\s+/;
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const terminals = result.parseResult.value.rules.filter(GrammarAST.isTerminalRule);
        expect(terminals).toHaveLength(3);
        const id = terminals.find(t => t.name === 'ID')!;
        const num = terminals.find(t => t.name === 'NUMBER')!;
        const ws = terminals.find(t => t.name === 'WS')!;
        expect(id.isWord).toBe(true);
        expect(num.isWord).toBeFalsy();
        expect(ws.isWord).toBeFalsy();
    });
});
