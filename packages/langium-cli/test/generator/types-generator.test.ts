/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, it } from 'vitest';
import { generateModule } from '../../src/generator/module-generator.js';
import { generateTypesFile } from '../../src/generator/types-generator.js';
import { DefaultGrammarParser, type ParsedGrammarSet } from '../../src/grammar-parser/grammar-parser.js';
import type { LangiumConfig, LangiumLanguageConfig } from '../../src/package-types.js';
import { RelativePath } from '../../src/package-types.js';

describe('generateTypesFile', () => {
    it('emits interface declarations for parser rules', async () => {
        const parser = new DefaultGrammarParser();
        const root = await parser.parse(
            'grammar Arithmetic entry Def: name=ID; terminal ID: /x/;'
        );
        const set: ParsedGrammarSet = new Map([['a.langium', root]]);
        const output = generateTypesFile(set);
        expect(output).toContain('export interface Def');
        expect(output).toContain('name');
    });

    it('emits type alias for type_decl', async () => {
        const parser = new DefaultGrammarParser();
        const root = await parser.parse(
            'grammar G\ntype Color = "red" | "blue";\nentry Foo: name=ID;\nterminal ID: /x/;'
        );
        const set: ParsedGrammarSet = new Map([['a.langium', root]]);
        const output = generateTypesFile(set);
        expect(output).toContain('export type Color');
    });
});

describe('generateModule', () => {
    it('emits GeneratedSharedModule and GeneratedModule', async () => {
        const parser = new DefaultGrammarParser();
        const root = await parser.parse('grammar Arithmetic entry Def: x=ID; terminal ID: /x/;');
        const set: ParsedGrammarSet = new Map([['a.langium', root]]);
        const config: LangiumConfig = {
            [RelativePath]: './',
            projectName: 'Arithmetic',
            languages: [{ id: 'arithmetic', grammar: 'a.langium', fileExtensions: ['.arith'] } as LangiumLanguageConfig],
            out: '',
            importExtension: '.js',
        };
        const output = generateModule(set, config);
        expect(output).toContain('ArithmeticGeneratedSharedModule');
        expect(output).toContain('ArithmeticGeneratedModule');
    });
});
