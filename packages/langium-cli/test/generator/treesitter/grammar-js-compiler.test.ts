/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { EmptyFileSystem, GrammarAST, type Grammar } from 'langium';
import { createLangiumGrammarServices } from 'langium/grammar';
import { parseHelper } from 'langium/test';
import { describe, expect, test } from 'vitest';
import {
    compileExtras,
    compileParserRule,
    compileParserRuleEntry,
    compileTerminalRule,
    compileTerminalRuleEntry,
    compileWord
} from '../../../src/generator/treesitter/grammar-js-compiler.js';

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

function getTerminal(grammar: Grammar, name: string): GrammarAST.TerminalRule {
    const rule = grammar.rules.find(r => r.name === name);
    expect(rule, `terminal rule ${name} should exist`).toBeDefined();
    expect(GrammarAST.isTerminalRule(rule!)).toBe(true);
    return rule as GrammarAST.TerminalRule;
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

    // US-021: terminal rules, extras, and word declaration

    test('compiles a regex terminal as token(/regex/)', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileTerminalRule(getTerminal(grammar, 'ID'));
        expect(body).toBe('token(/[_a-zA-Z][\\w]*/)');
    });

    test('compiles a numeric regex terminal preserving alternation', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: value=Number;
            terminal Number: /[0-9]+(\\.[0-9]+)?/;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileTerminalRule(getTerminal(grammar, 'Number'));
        expect(body).toBe('token(/[0-9]+(\\.[0-9]+)?/)');
    });

    test('compileTerminalRuleEntry composes "<name>: $ => token(...)"', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const entry = compileTerminalRuleEntry(getTerminal(grammar, 'ID'));
        expect(entry).toBe('ID: $ => token(/[_a-zA-Z][\\w]*/)');
    });

    test('compiles a terminal alternatives body to choice(...)', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: /[a-z]+/ | /[A-Z]+/;
        `);
        const body = compileTerminalRule(getTerminal(grammar, 'ID'));
        expect(body).toBe('token(choice(/[a-z]+/, /[A-Z]+/))');
    });

    test('compiles a terminal group body to seq(...) of regex parts', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal SL_COMMENT: /\\/\\//  /[^\\n\\r]*/;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileTerminalRule(getTerminal(grammar, 'SL_COMMENT'));
        expect(body).toBe('token(seq(/\\/\\//, /[^\\n\\r]*/))');
    });

    test('compiles a character range to a regex character class', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: 'a'..'z';
        `);
        const body = compileTerminalRule(getTerminal(grammar, 'ID'));
        expect(body).toBe('token(/[a-z]/)');
    });

    test('compiles a single keyword in a terminal body to a quoted string', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: 'a';
        `);
        const body = compileTerminalRule(getTerminal(grammar, 'ID'));
        expect(body).toBe("token('a')");
    });

    test('compiles a terminal rule call body to $.OTHER', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: BASE;
            terminal BASE: /[_a-zA-Z][\\w]*/;
        `);
        const body = compileTerminalRule(getTerminal(grammar, 'ID'));
        expect(body).toBe('token($.BASE)');
    });

    test('hidden whitespace terminal compiles into the extras array', async () => {
        // AC: a grammar with hidden whitespace terminal produces "extras: [/\\s+/]"
        // (or equivalent). A single-regex hidden terminal is inlined as the
        // anonymous regex so tree-sitter consumes it without producing a node.
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            hidden terminal WS: /\\s+/;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        expect(compileExtras(grammar)).toBe('[/\\s+/]');
    });

    test('hidden multi-element terminal is referenced by name in extras', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            hidden terminal WS: /\\s+/;
            hidden terminal ML_COMMENT: /\\/\\*[\\s\\S]*?\\*\\//;
            hidden terminal SL_COMMENT: /\\/\\//  /[^\\n\\r]*/;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        // WS and ML_COMMENT are single-regex hidden terminals — inlined.
        // SL_COMMENT is a TerminalGroup of two regexes — referenced by name.
        expect(compileExtras(grammar)).toBe('[/\\s+/, /\\/\\*[\\s\\S]*?\\*\\//, $.SL_COMMENT]');
    });

    test('grammar without hidden terminals produces an empty extras array', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        expect(compileExtras(grammar)).toBe('[]');
    });

    test('@word terminal yields the word value $.NAME', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            @word terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        expect(compileWord(grammar)).toBe('$.ID');
    });

    test('grammar with no @word annotation yields undefined word', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        expect(compileWord(grammar)).toBeUndefined();
    });

    test('hidden + @word combine: terminal both contributes to extras and acts as word', async () => {
        // Edge case: @word AND hidden on the same terminal. The terminal still
        // shows up in extras (because it is hidden) and is the word.
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            @word hidden terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        expect(compileWord(grammar)).toBe('$.ID');
        expect(compileExtras(grammar)).toBe('[/[_a-zA-Z][\\w]*/]');
    });

});
