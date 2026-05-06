/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, it, expect, beforeAll } from 'vitest';
import { DefaultGrammarParser } from '../../src/grammar-parser/grammar-parser.js';

describe('DefaultGrammarParser', () => {
    let parser: DefaultGrammarParser;

    beforeAll(async () => {
        parser = new DefaultGrammarParser();
    });

    it('parses a minimal grammar and returns root SyntaxNode', async () => {
        const root = await parser.parse(`
grammar Foo
entry Bar: name=ID;
terminal ID: /[a-z]+/;
`);
        expect(root.type).toBe('grammar');
        expect(root.hasError).toBe(false);
    });

    it('root has grammar name', async () => {
        const root = await parser.parse(`grammar Foo entry Bar: x=ID; terminal ID: /x/;`);
        const nameNode = root.childForFieldName('name');
        expect(nameNode?.text).toBe('Foo');
    });

    it('root has parser_rule and terminal_rule children', async () => {
        const root = await parser.parse(`grammar Foo entry Bar: x=ID; terminal ID: /x/;`);
        const types = root.namedChildren.map(n => n?.type);
        expect(types).toContain('parser_rule');
        expect(types).toContain('terminal_rule');
    });
});
