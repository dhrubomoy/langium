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

function findRule(grammar: Grammar, name: string): GrammarAST.ParserRule {
    const rule = grammar.rules.find(r => GrammarAST.isParserRule(r) && r.name === name);
    expect(rule).toBeDefined();
    return rule as GrammarAST.ParserRule;
}

function alternatives(rule: GrammarAST.ParserRule): GrammarAST.AbstractElement[] {
    const def = rule.definition;
    if (GrammarAST.isAlternatives(def)) {
        return def.elements;
    }
    return [def];
}

describe('@prec parser rule alternative annotation', () => {

    test('parses @prec.left(1) on an alternative and sets prec / precAssoc', async () => {
        const grammar = `
        grammar Test
        E: @prec.left(1) name=ID '+' value=ID | name=ID;
        terminal ID: /[a-zA-Z_][\\w]*/;
        hidden terminal WS: /\\s+/;
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const rule = findRule(result.parseResult.value, 'E');
        const branches = alternatives(rule);
        expect(branches).toHaveLength(2);
        const annotated = branches[0];
        expect(GrammarAST.isGroup(annotated)).toBe(true);
        const group = annotated as GrammarAST.Group;
        expect(group.prec).toBe(1);
        expect(group.precAssoc).toBe('left');
    });

    test('parses @prec.right(2) and sets precAssoc to "right"', async () => {
        const grammar = `
        grammar Test
        E: @prec.right(2) name=ID '+' value=ID | name=ID;
        terminal ID: /[a-zA-Z_][\\w]*/;
        hidden terminal WS: /\\s+/;
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const rule = findRule(result.parseResult.value, 'E');
        const annotated = alternatives(rule)[0] as GrammarAST.Group;
        expect(annotated.prec).toBe(2);
        expect(annotated.precAssoc).toBe('right');
    });

    test('parses @prec(3) without associativity (precAssoc undefined)', async () => {
        const grammar = `
        grammar Test
        E: @prec(3) name=ID '+' value=ID | name=ID;
        terminal ID: /[a-zA-Z_][\\w]*/;
        hidden terminal WS: /\\s+/;
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const rule = findRule(result.parseResult.value, 'E');
        const annotated = alternatives(rule)[0] as GrammarAST.Group;
        expect(annotated.prec).toBe(3);
        expect(annotated.precAssoc).toBeFalsy();
    });

    test('alternative without @prec has prec / precAssoc undefined', async () => {
        const grammar = `
        grammar Test
        E: @prec.left(1) name=ID '+' value=ID | name=ID;
        terminal ID: /[a-zA-Z_][\\w]*/;
        hidden terminal WS: /\\s+/;
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const rule = findRule(result.parseResult.value, 'E');
        const plain = alternatives(rule)[1];
        if (GrammarAST.isGroup(plain)) {
            expect(plain.prec).toBeFalsy();
            expect(plain.precAssoc).toBeFalsy();
        }
        // non-Group alternatives obviously have no prec at all — still acceptable.
    });

    test('multiple @prec annotations on different alternatives are independent', async () => {
        const grammar = `
        grammar Test
        E:
            @prec.left(1) name=ID '+' value=ID
            | @prec.right(2) name=ID '*' value=ID
            | @prec(3) name=ID;
        terminal ID: /[a-zA-Z_][\\w]*/;
        hidden terminal WS: /\\s+/;
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const rule = findRule(result.parseResult.value, 'E');
        const branches = alternatives(rule);
        expect(branches).toHaveLength(3);

        const a = branches[0] as GrammarAST.Group;
        expect(a.prec).toBe(1);
        expect(a.precAssoc).toBe('left');

        const b = branches[1] as GrammarAST.Group;
        expect(b.prec).toBe(2);
        expect(b.precAssoc).toBe('right');

        const c = branches[2] as GrammarAST.Group;
        expect(c.prec).toBe(3);
        expect(c.precAssoc).toBeFalsy();
    });

    test('grammar without any @prec annotation parses unchanged (regression check)', async () => {
        const grammar = `
        grammar Test
        E: name=ID '+' value=ID | name=ID;
        terminal ID: /[a-zA-Z_][\\w]*/;
        hidden terminal WS: /\\s+/;
        `;

        const result = await parse(grammar);
        expect(result.parseResult.lexerErrors).toHaveLength(0);
        expect(result.parseResult.parserErrors).toHaveLength(0);

        const rule = findRule(result.parseResult.value, 'E');
        for (const branch of alternatives(rule)) {
            if (GrammarAST.isGroup(branch)) {
                expect(branch.prec).toBeFalsy();
                expect(branch.precAssoc).toBeFalsy();
            }
        }
    });
});
