/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { beforeAll, describe, expect, test } from 'vitest';
import { DefaultGrammarParser, type ParsedGrammarSet } from '../../src/grammar-parser/grammar-parser.js';
import { generateBnf } from '../../src/generator/bnf-generator.js';

let set: ParsedGrammarSet;
beforeAll(async () => {
    const parser = new DefaultGrammarParser();
    const root = await parser.parse(`grammar Foo entry Bar: name=ID (',' name+=ID)*; terminal ID: /[a-z]+/;`);
    set = new Map([['foo.langium', root]]);
});

describe('generateBnf', () => {
    test('emits rule definition for Bar', () => {
        const out = generateBnf(set);
        expect(out).toContain('Bar');
        expect(out).toContain('::=');
    });

    test('emits terminal rule', () => {
        const out = generateBnf(set);
        expect(out).toContain('ID');
    });

    test('emits a line for every parser and terminal rule', () => {
        const out = generateBnf(set);
        expect(out.split('\n\n').filter(line => line.includes('::='))).toHaveLength(2);
    });
});
