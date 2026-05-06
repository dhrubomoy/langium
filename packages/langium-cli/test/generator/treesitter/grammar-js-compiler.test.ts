/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { beforeAll, describe, expect, test } from 'vitest';
import { DefaultGrammarParser, type ParsedGrammarSet } from '../../../src/grammar-parser/grammar-parser.js';
import { compileGrammarJs } from '../../../src/generator/treesitter/grammar-js-compiler.js';

let set: ParsedGrammarSet;

beforeAll(async () => {
    const parser = new DefaultGrammarParser();
    const root = await parser.parse(`
        grammar Arithmetic
        entry Def: elements+=Named*;
        Named: name=ID ':' value=Expression;
        Expression: left=Named (op='+' right=Named)?;
        terminal ID: /[_a-zA-Z][\\w_]*/;
        hidden terminal WS: /\\s+/;
    `);
    set = new Map([['a.langium', root]]);
});

describe('compileGrammarJs', () => {
    test('emits module.exports = grammar(...)', () => {
        const out = compileGrammarJs(set);
        expect(out).toContain('module.exports = grammar');
    });

    test('emits a rule for each parser rule', () => {
        const out = compileGrammarJs(set);
        expect(out).toContain('Def:');
        expect(out).toContain('Named:');
    });

    test('emits terminal patterns', () => {
        const out = compileGrammarJs(set);
        expect(out).toContain('ID');
    });
});
