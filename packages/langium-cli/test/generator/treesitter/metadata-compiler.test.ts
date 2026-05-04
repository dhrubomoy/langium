/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { EmptyFileSystem, type Grammar } from 'langium';
import type { GrammarMetadata, NodeMetadata } from 'langium/generate';
import { createLangiumGrammarServices } from 'langium/grammar';
import { parseHelper } from 'langium/test';
import { describe, expect, test } from 'vitest';
import { compileMetadata } from '../../../src/generator/treesitter/metadata-compiler.js';

const services = createLangiumGrammarServices(EmptyFileSystem);
const parse = parseHelper<Grammar>(services.grammar);

async function parseGrammar(input: string): Promise<Grammar> {
    const document = await parse(input);
    return document.parseResult.value;
}

/**
 * Mirror of the hand-written {@link ARITHMETIC_METADATA} fixture
 * (`packages/langium/test/fixtures/arithmetic/metadata.ts`, US-004). Inlined
 * here because the langium-cli test rootDir cannot reach into the langium
 * package's test/fixtures directory; the structural-match assertion below
 * derives every check from this constant so any future drift between the
 * fixture and the test must be intentional.
 */
const EXPECTED_ARITHMETIC: GrammarMetadata = {
    version: '1.0.0',
    word: 'ID',
    extras: ['ML_COMMENT', 'SL_COMMENT'],
    nodes: {
        Definition: {
            nodeType: 'Definition',
            fields: [
                { name: 'name', operator: '=' },
                { name: 'expr', operator: '=' }
            ]
        },
        AbstractDefinition: { nodeType: 'AbstractDefinition', fields: [] },
        Expression: { nodeType: 'Expression', fields: [] },
        Addition: {
            nodeType: 'Addition',
            fields: [
                { name: 'left', operator: '=' },
                { name: 'right', operator: '=' }
            ]
        },
        Subtraction: {
            nodeType: 'Subtraction',
            fields: [
                { name: 'left', operator: '=' },
                { name: 'right', operator: '=' }
            ]
        },
        Multiplication: {
            nodeType: 'Multiplication',
            fields: [
                { name: 'left', operator: '=' },
                { name: 'right', operator: '=' }
            ]
        },
        Division: {
            nodeType: 'Division',
            fields: [
                { name: 'left', operator: '=' },
                { name: 'right', operator: '=' }
            ]
        },
        Negation: {
            nodeType: 'Negation',
            fields: [
                { name: 'operand', operator: '=' }
            ]
        },
        Parenthesized: {
            nodeType: 'Parenthesized',
            fields: [
                { name: 'expression', operator: '=' }
            ]
        },
        NumberLiteral: {
            nodeType: 'NumberLiteral',
            fields: [
                { name: 'value', operator: '=' }
            ]
        },
        NamedExpression: {
            nodeType: 'NamedExpression',
            fields: [
                { name: 'element', operator: '=', isRef: true }
            ]
        }
    }
};

describe('metadata-compiler', () => {

    test('emits metadata version', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        expect(compileMetadata(grammar).version).toBe('1.0.0');
    });

    test('records a single = assignment as a field', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry Definition: 'def' name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const meta = compileMetadata(grammar);
        expect(meta.nodes.Definition).toEqual({
            nodeType: 'Definition',
            fields: [{ name: 'name', operator: '=' }]
        });
    });

    test('preserves += list operator on field', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: items+=ID (',' items+=ID)*;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const meta = compileMetadata(grammar);
        // duplicate items+=ID assignment sites collapse to one field entry
        expect(meta.nodes.E.fields).toEqual([{ name: 'items', operator: '+=' }]);
    });

    test('preserves ?= flag operator on field', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: hidden?='hidden' name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const meta = compileMetadata(grammar);
        expect(meta.nodes.E.fields).toEqual([
            { name: 'hidden', operator: '?=' },
            { name: 'name', operator: '=' }
        ]);
    });

    test('marks cross-reference fields with isRef: true', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID '=' element=[E:ID];
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const meta = compileMetadata(grammar);
        expect(meta.nodes.E.fields).toEqual([
            { name: 'name', operator: '=' },
            { name: 'element', operator: '=', isRef: true }
        ]);
    });

    test('marks default-terminal cross-reference [Type] with isRef: true', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID '=' element=[E];
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const meta = compileMetadata(grammar);
        const elementField = meta.nodes.E.fields.find(f => f.name === 'element');
        expect(elementField?.isRef).toBe(true);
    });

    test('marks rule containing {infer T} action as isAction with actionType', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: {infer NumberLiteral} value=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const meta = compileMetadata(grammar);
        expect(meta.nodes.E).toMatchObject({
            nodeType: 'E',
            isAction: true,
            actionType: 'NumberLiteral',
            fields: [{ name: 'value', operator: '=' }]
        });
        // The inferred action type also gets its own metadata entry so
        // consumers that look up by AST type name find a stub entry.
        expect(meta.nodes.NumberLiteral).toMatchObject({
            nodeType: 'NumberLiteral',
            isAction: true,
            actionType: 'NumberLiteral'
        });
    });

    test('records {Type.field=current} action with referenced type', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E returns Other: x=ID ({Other.left=current} '+' right=ID)*;
            Other: y=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const meta = compileMetadata(grammar);
        expect(meta.nodes.E).toMatchObject({
            isAction: true,
            actionType: 'Other'
        });
    });

    test('hidden multi-element terminals appear in extras by name', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            hidden terminal WS: /\\s+/;
            hidden terminal ML_COMMENT: /\\/\\*[\\s\\S]*?\\*\\//;
            hidden terminal SL_COMMENT: /\\/\\//  /[^\\n\\r]*/;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const meta = compileMetadata(grammar);
        // Single-regex hidden terminals (WS, ML_COMMENT) are inlined as
        // anonymous regex by the grammar.js compiler — they have no named
        // tree-sitter node, so they are excluded from metadata.extras.
        // SL_COMMENT is a TerminalGroup, referenced as $.SL_COMMENT, so it
        // surfaces as a named extra here.
        expect(meta.extras).toEqual(['SL_COMMENT']);
    });

    test('grammar without hidden terminals has empty extras', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        expect(compileMetadata(grammar).extras).toEqual([]);
    });

    test('@word terminal is recorded in word', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            @word terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        expect(compileMetadata(grammar).word).toBe('ID');
    });

    test('grammar without @word omits the word property', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const meta = compileMetadata(grammar);
        expect(meta.word).toBeUndefined();
        expect('word' in meta).toBe(false);
    });

    test('fragment rules are skipped (no tree-sitter node)', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: f=Frag;
            fragment Frag: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const meta = compileMetadata(grammar);
        expect(meta.nodes.E).toBeDefined();
        expect(meta.nodes.Frag).toBeUndefined();
    });

    test('terminal rules do not appear as nodes', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
            terminal NUMBER: /[0-9]+/;
        `);
        const meta = compileMetadata(grammar);
        expect(meta.nodes.ID).toBeUndefined();
        expect(meta.nodes.NUMBER).toBeUndefined();
    });

    test('arithmetic grammar metadata matches ARITHMETIC_METADATA fixture structurally', async () => {
        const grammar = await parseGrammar(`
            grammar Arithmetic
            entry Expression:
                Addition | Subtraction | Multiplication | Division | Negation | Parenthesized | NumberLiteral | NamedExpression;
            AbstractDefinition: Definition;
            Definition: 'def' name=ID '=' expr=Expression ';';
            Addition: @prec.left(1) left=Expression '+' right=Expression;
            Subtraction: @prec.left(1) left=Expression '-' right=Expression;
            Multiplication: @prec.left(2) left=Expression '*' right=Expression;
            Division: @prec.left(2) left=Expression '/' right=Expression;
            Negation: @prec.right(3) '-' operand=Expression;
            Parenthesized: @prec(4) '(' expression=Expression ')';
            NumberLiteral: value=NUMBER;
            NamedExpression: element=[AbstractDefinition:ID];
            hidden terminal WS: /\\s+/;
            hidden terminal ML_COMMENT: /\\/\\*[\\s\\S]*?\\*\\//  '*/';
            hidden terminal SL_COMMENT: /\\/\\//  /[^\\n\\r]*/;
            @word terminal ID: /[_a-zA-Z][\\w_]*/;
            terminal NUMBER returns number: /[0-9]+(\\.[0-9]+)?/;
        `);
        const meta = compileMetadata(grammar);

        expect(meta.version).toBe(EXPECTED_ARITHMETIC.version);
        expect(meta.word).toBe(EXPECTED_ARITHMETIC.word);
        // Extras: every expected entry must be present (compiled output may
        // include additional named extras if test grammar uses richer hidden
        // terminals than the hand-written fixture).
        for (const name of EXPECTED_ARITHMETIC.extras) {
            expect(meta.extras).toContain(name);
        }
        // Every NodeMetadata entry in the fixture is present in compiled output
        // with matching field shape.
        for (const [nodeType, expected] of Object.entries(EXPECTED_ARITHMETIC.nodes)) {
            const actual = meta.nodes[nodeType];
            expect(actual, `node ${nodeType} should exist in compiled metadata`).toBeDefined();
            expectFieldsMatch(actual, expected);
        }
    });

});

function expectFieldsMatch(actual: NodeMetadata, expected: NodeMetadata): void {
    expect(actual.nodeType, `nodeType for ${expected.nodeType}`).toBe(expected.nodeType);
    expect(actual.fields.length, `field count for ${expected.nodeType}`).toBe(expected.fields.length);
    for (let i = 0; i < expected.fields.length; i++) {
        const expectedField = expected.fields[i];
        const actualField = actual.fields[i];
        expect(actualField.name, `field[${i}].name on ${expected.nodeType}`).toBe(expectedField.name);
        expect(actualField.operator, `field[${i}].operator on ${expected.nodeType}`).toBe(expectedField.operator);
        expect(actualField.isRef ?? false, `field[${i}].isRef on ${expected.nodeType}`).toBe(expectedField.isRef ?? false);
    }
}
