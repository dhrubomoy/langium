/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, it, expect, beforeAll } from 'vitest';
import { DefaultGrammarParser, type SyntaxNode } from '../../src/grammar-parser/grammar-parser.js';
import {
    getRules, getTerminals, getInterfaces, getTypeDecls, getImports,
    getGrammarName, getRuleName, getRuleReturnType, isEntryRule, isFragment,
    getTerminalPattern, getImportPath, getAssignments,
} from '../../src/grammar-parser/grammar-queries.js';

const GRAMMAR = `
grammar Arithmetic

import './expressions'

interface Named {
    name: string;
}

type Expr = Addition | Subtraction;

entry Definition returns Definition:
    expressions+=NamedExpression*;

fragment NamedExpression returns NamedExpression:
    name=ID ':' value=Expression;

terminal ID: /[_a-zA-Z][\\w_]*/;
hidden terminal WS: /\\s+/;
`;

let root: SyntaxNode;
beforeAll(async () => {
    const parser = new DefaultGrammarParser();
    root = await parser.parse(GRAMMAR);
});

describe('structural queries', () => {
    it('getGrammarName', () => expect(getGrammarName(root)).toBe('Arithmetic'));
    it('getImports returns import nodes', () => expect(getImports(root)).toHaveLength(1));
    it('getImportPath extracts path string', () => expect(getImportPath(getImports(root)[0])).toBe('./expressions'));
    it('getRules returns parser_rule nodes (not terminals)', () => expect(getRules(root)).toHaveLength(2));
    it('getTerminals returns terminal_rule nodes', () => expect(getTerminals(root)).toHaveLength(2));
    it('getInterfaces returns interface_decl nodes', () => expect(getInterfaces(root)).toHaveLength(1));
    it('getTypeDecls returns type_decl nodes', () => expect(getTypeDecls(root)).toHaveLength(1));
    it('getRuleName for entry rule', () => expect(getRuleName(getRules(root)[0])).toBe('Definition'));
    it('isEntryRule', () => expect(isEntryRule(getRules(root)[0])).toBe(true));
    it('isFragment', () => expect(isFragment(getRules(root)[1])).toBe(true));
    it('getRuleReturnType', () => expect(getRuleReturnType(getRules(root)[0])).toBe('Definition'));
    it('getTerminalPattern for ID', () => {
        const id = getTerminals(root).find(t => getRuleName(t) === 'ID')!;
        expect(getTerminalPattern(id)).toBe('/[_a-zA-Z][\\w_]*/');
    });
});

describe('getAssignments', () => {
    it('collects += assignment from Definition rule', () => {
        const def = getRules(root)[0];
        const assignments = getAssignments(def);
        expect(assignments).toHaveLength(1);
        expect(assignments[0].feature).toBe('expressions');
        expect(assignments[0].operator).toBe('+=');
        expect(assignments[0].isRef).toBe(false);
    });

    it('collects cross-reference assignment as isRef=true', async () => {
        const parser = new DefaultGrammarParser();
        const r = await parser.parse(`grammar X Rule: ref=[Foo:ID]; terminal ID: /x/;`);
        const rule = getRules(r)[0];
        const assignments = getAssignments(rule);
        expect(assignments[0].isRef).toBe(true);
        expect(assignments[0].feature).toBe('ref');
        expect(assignments[0].operator).toBe('=');
    });
});
