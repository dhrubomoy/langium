/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { EmptyFileSystem, GrammarAST, type Grammar } from 'langium';
import { createLangiumGrammarServices } from 'langium/grammar';
import { parseHelper } from 'langium/test';
import { describe, expect, test } from 'vitest';
import { compileParserRule, compileParserRuleEntry } from '../../../src/generator/treesitter/grammar-js-compiler.js';

const services = createLangiumGrammarServices(EmptyFileSystem);
const parse = parseHelper<Grammar>(services.grammar);

async function parseGrammar(input: string): Promise<Grammar> {
    const document = await parse(input);
    return document.parseResult.value;
}

function getRule(grammar: Grammar, name: string): GrammarAST.ParserRule {
    const rule = grammar.rules.find(r => r.name === name);
    expect(rule, `rule ${name} should exist`).toBeDefined();
    expect(GrammarAST.isParserRule(rule!)).toBe(true);
    return rule as GrammarAST.ParserRule;
}

describe('grammar-js-compiler', () => {

    test('compiles a single keyword + assignment to seq + field', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry Definition: 'def' name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'Definition'));
        expect(body).toContain("seq('def', field('name', $.ID))");
    });

    test('compiles alternatives to choice()', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: 'a' | 'b' | 'c';
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'E'));
        expect(body).toBe("choice('a', 'b', 'c')");
    });

    test('compiles ? cardinality to optional() (cardinality on Assignment)', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: 'a' (name=ID)?;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'E'));
        expect(body).toContain("optional(field('name', $.ID))");
    });

    test('compiles * cardinality to repeat() (Assignment + *)', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: items+=ID*;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'E'));
        expect(body).toContain("repeat(field('items', $.ID))");
    });

    test('compiles + cardinality to repeat1() (Assignment + +)', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: items+=ID+;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'E'));
        expect(body).toContain("repeat1(field('items', $.ID))");
    });

    test('compiles += list assignment to field with the +=-feature name', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: items+=ID (',' items+=ID)*;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'E'));
        // Both += sites should emit field('items', $.ID)
        const matches = body.match(/field\('items', \$\.ID\)/g) ?? [];
        expect(matches.length).toBe(2);
    });

    test('compiles ?= flag assignment to field()', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: hidden?='hidden' name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'E'));
        expect(body).toContain("field('hidden', 'hidden')");
    });

    test('compiles @prec.left(n) annotation to prec.left(n, seq(...))', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: @prec.left(1) left=ID '+' right=ID | name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'E'));
        expect(body).toContain('prec.left(1, seq(');
        expect(body).toContain("field('left', $.ID)");
        expect(body).toContain("field('right', $.ID)");
    });

    test('compiles @prec.right(n) annotation to prec.right(n, ...)', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: @prec.right(3) '-' operand=ID | name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'E'));
        expect(body).toContain('prec.right(3,');
        expect(body).toContain("field('operand', $.ID)");
    });

    test('compiles @prec(n) annotation (no associativity) to prec(n, ...)', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: @prec(4) '(' inner=ID ')' | name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'E'));
        expect(body).toContain('prec(4,');
        expect(body).toContain("field('inner', $.ID)");
        expect(body).not.toContain('prec.left');
        expect(body).not.toContain('prec.right');
    });

    test('compiles cross-reference [Type:ID] to a field of the terminal', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID '=' element=[E:ID];
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'E'));
        expect(body).toContain("field('element', $.ID)");
    });

    test('compiles cross-reference with default terminal to $.ID', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID '=' element=[E];
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'E'));
        expect(body).toContain("field('element', $.ID)");
    });

    test('compiles a rule call to $.RuleName', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: x=Other;
            Other: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'E'));
        expect(body).toContain("field('x', $.Other)");
    });

    test('fragment rule emits with leading underscore', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: f=Frag;
            fragment Frag: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const fragRule = getRule(grammar, 'Frag');
        expect(compileParserRuleEntry(fragRule).startsWith('_Frag: $ =>')).toBe(true);
        // Reference to fragment should also use the _-prefixed name
        const eBody = compileParserRule(getRule(grammar, 'E'));
        expect(eBody).toContain('$._Frag');
    });

    test('compileParserRuleEntry composes "<name>: $ => <body>"', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const entry = compileParserRuleEntry(getRule(grammar, 'E'));
        expect(entry.startsWith('E: $ => ')).toBe(true);
        expect(entry).toContain("field('name', $.ID)");
    });

    test('compiles arithmetic Expression rule using all expected tree-sitter constructs', async () => {
        // The PRD's arithmetic example expressed in the post-tree-sitter
        // "fully explicit" shape: separate Addition/Subtraction/etc rules each
        // with their own @prec annotation, plus an Expression dispatch rule
        // that chooses among them. We compile the Expression dispatch and
        // each binary rule and assert the expected constructs appear.
        const grammar = await parseGrammar(`
            grammar Arithmetic
            entry Expression:
                Addition | Subtraction | Multiplication | Division | Negation | Parenthesized | NumberLiteral | NamedExpression;
            Addition: @prec.left(1) left=Expression '+' right=Expression;
            Subtraction: @prec.left(1) left=Expression '-' right=Expression;
            Multiplication: @prec.left(2) left=Expression '*' right=Expression;
            Division: @prec.left(2) left=Expression '/' right=Expression;
            Negation: @prec.right(3) '-' operand=Expression;
            Parenthesized: @prec(4) '(' expression=Expression ')';
            NumberLiteral: value=NUMBER;
            NamedExpression: element=[NamedExpression:ID];
            terminal ID: /[_a-zA-Z][\\w]*/;
            terminal NUMBER returns number: /[0-9]+(\\.[0-9]+)?/;
        `);
        const expr = compileParserRule(getRule(grammar, 'Expression'));
        expect(expr).toContain('choice(');
        expect(expr).toContain('$.Addition');
        expect(expr).toContain('$.NamedExpression');

        const add = compileParserRule(getRule(grammar, 'Addition'));
        expect(add).toContain('prec.left(1, seq(');
        expect(add).toContain("field('left', $.Expression)");
        expect(add).toContain("'+'");
        expect(add).toContain("field('right', $.Expression)");

        const neg = compileParserRule(getRule(grammar, 'Negation'));
        expect(neg).toContain('prec.right(3, seq(');
        expect(neg).toContain("'-'");
        expect(neg).toContain("field('operand', $.Expression)");

        const paren = compileParserRule(getRule(grammar, 'Parenthesized'));
        expect(paren).toContain('prec(4, seq(');
        expect(paren).toContain("field('expression', $.Expression)");
    });

    test('skips actions in surrounding seq', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: {infer NumberLiteral} value=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileParserRule(getRule(grammar, 'E'));
        // Action is dropped, leaving just the assignment
        expect(body).toContain("field('value', $.ID)");
        expect(body).not.toContain('__action__');
        expect(body).not.toContain('infer');
    });

});
