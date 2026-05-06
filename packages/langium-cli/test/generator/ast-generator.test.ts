/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, it, expect, beforeAll } from 'vitest';
import { DefaultGrammarParser, type ParsedGrammarSet } from '../../src/grammar-parser/grammar-parser.js';
import { generateAst } from '../../src/generator/ast-generator.js';
import type { LangiumConfig } from '../../src/package-types.js';
import { RelativePath } from '../../src/package-types.js';

const ARITHMETIC_GRAMMAR = `
grammar Arithmetic

entry Definition:
    elements+=NamedExpression*;

NamedExpression:
    name=ID ':' value=Expression;

Expression:
    Addition;

Addition infix on Expression returns Expression:
    '+';

terminal ID: /[_a-zA-Z][\\w_]*/;
terminal NUMBER returns number: /[0-9]+(\\.[0-9]+)?/;
hidden terminal WS: /\\s+/;
`;

const CONFIG: LangiumConfig = {
    [RelativePath]: './',
    projectName: 'Arithmetic',
    languages: [],
    out: '',
    importExtension: '.js',
};

let set: ParsedGrammarSet;
beforeAll(async () => {
    const parser = new DefaultGrammarParser();
    const root = await parser.parse(ARITHMETIC_GRAMMAR);
    set = new Map([['arithmetic.langium', root]]);
});

describe('generateAst', () => {
    it('emits interface for each rule type', () => {
        const output = generateAst(set, CONFIG);
        expect(output).toContain('export interface Definition');
        expect(output).toContain('export interface NamedExpression');
    });

    it('emits += fields as arrays', () => {
        const output = generateAst(set, CONFIG);
        expect(output).toContain('elements: NamedExpression[]');
    });

    it('emits string field for name', () => {
        const output = generateAst(set, CONFIG);
        expect(output).toContain('name: string');
    });

    it('produces an ArithmeticAstType union', () => {
        const output = generateAst(set, CONFIG);
        expect(output).toContain('ArithmeticAstType');
    });
});
