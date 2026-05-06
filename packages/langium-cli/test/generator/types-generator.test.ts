/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Grammar } from 'langium';
import { EmptyFileSystem } from 'langium';
import { expandToStringWithNL } from 'langium/generate';
import { createLangiumGrammarServices } from 'langium/grammar';
import { parseHelper } from 'langium/test';
import { describe, expect, it, test } from 'vitest';
import { generateModule } from '../../src/generator/module-generator.js';
import { generateTypesFile } from '../../src/generator/types-generator.js';
import { DefaultGrammarParser, type ParsedGrammarSet } from '../../src/grammar-parser/grammar-parser.js';
import type { LangiumConfig, LangiumLanguageConfig } from '../../src/package-types.js';
import { RelativePath } from '../../src/package-types.js';

const { grammar } = createLangiumGrammarServices(EmptyFileSystem);

describe('Types generator', () => {

    test('should generate types file', async () => {
        const result = (await parseHelper<Grammar>(grammar)(TEST_GRAMMAR)).parseResult;
        // on Windows system the line ending of result is "\r\n"
        // Therefore typesFileContent is normalized to prevent false negatives
        const typesFileContent = generateTypesFile(grammar, [result.value]);
        expect(typesFileContent).toBe(EXPECTED_TYPES);
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

const EXPECTED_TYPES = expandToStringWithNL`
    type AbstractDefinition = DeclaredParameter | Definition;

    type Expression = BinaryExpression | FunctionCall | NumberLiteral;

    type Statement = Definition | Evaluation;

    interface BinaryExpression {
        left: Expression;
        operator: "*" | "+" | "-" | "/";
        right: Expression;
    }

    interface DeclaredParameter {
        name: string;
    }

    interface Definition {
        args: DeclaredParameter[];
        expr: Expression;
        name: string;
    }

    interface Evaluation {
        expression: Expression;
    }

    interface FunctionCall {
        args: Expression[];
        func: @AbstractDefinition;
    }

    interface Module {
        name: string;
        statements: Statement[];
    }

    interface NumberLiteral {
        value: number;
    }

`;

const TEST_GRAMMAR = expandToStringWithNL`
    grammar Arithmetics

    entry Module:
        'module' name=ID
        (statements+=Statement)*;

    Statement:
        Definition | Evaluation;

    Definition:
        'def' name=ID ('(' args+=DeclaredParameter (',' args+=DeclaredParameter)* ')')?
        ':' expr=Expression ';';

    DeclaredParameter:
        name=ID;

    type AbstractDefinition = Definition | DeclaredParameter;

    Evaluation:
        expression=Expression ';';

    Expression:
        Addition;

    Addition infers Expression:
        Multiplication ({infer BinaryExpression.left=current} operator=('+' | '-') right=Multiplication)*;

    Multiplication infers Expression:
        PrimaryExpression ({infer BinaryExpression.left=current} operator=('*' | '/') right=PrimaryExpression)*;

    PrimaryExpression infers Expression:
        '(' Expression ')' |
        {infer NumberLiteral} value=NUMBER |
        {infer FunctionCall} func=[AbstractDefinition] ('(' args+=Expression (',' args+=Expression)* ')')?;

    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
    terminal NUMBER returns number: /[0-9]+(\\.[0-9]*)?/;

    hidden terminal ML_COMMENT: /\\/\\*[\\s\\S]*?\\*\\//;
    hidden terminal SL_COMMENT: /\\/\\/[^\\n\\r]*/;
`;
