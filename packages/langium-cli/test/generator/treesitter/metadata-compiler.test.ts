/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { beforeAll, describe, expect, it } from 'vitest';
import { DefaultGrammarParser, type ParsedGrammarSet } from '../../../src/grammar-parser/grammar-parser.js';
import { compileMetadata } from '../../../src/generator/treesitter/metadata-compiler.js';

let set: ParsedGrammarSet;
beforeAll(async () => {
    const parser = new DefaultGrammarParser();
    const root = await parser.parse('grammar X entry Foo: name=ID; terminal ID: /x/;');
    set = new Map([['x.langium', root]]);
});

describe('compileMetadata', () => {
    it('emits GRAMMAR_METADATA export', () => {
        expect(compileMetadata(set)).toContain('GRAMMAR_METADATA');
    });
    it('includes node type Foo', () => {
        expect(compileMetadata(set)).toContain("'Foo'");
    });
});
