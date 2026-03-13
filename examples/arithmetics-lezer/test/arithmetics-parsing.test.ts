/******************************************************************************
 * Copyright 2025 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { createArithmeticsServices } from '../src/language-server/arithmetics-module.js';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import type { Evaluation, Module } from '../src/language-server/generated/ast.js';
import { isBinaryExpression, isFunctionCall, isNumberLiteral, type Expression } from '../src/language-server/generated/ast.js';

describe('Test the arithmetics parsing (Lezer backend)', () => {

    const services = createArithmeticsServices(EmptyFileSystem);
    const parse = parseHelper<Module>(services.arithmetics);

    function printExpression(expr: Expression): string {
        if (isBinaryExpression(expr)) {
            return '(' + printExpression(expr.left) + ' ' + expr.operator + ' ' + printExpression(expr.right) + ')';
        } else if (isNumberLiteral(expr)) {
            return expr.value.toString();
        } else if (isFunctionCall(expr)) {
            return expr.func.$refText;
        }
        return '';
    }

    async function parseExpression(text: string): Promise<Expression> {
        const document = await parse('module test ' + text);
        return (document.parseResult.value.statements[0] as Evaluation).expression;
    }

    test('Single expression', async () => {
        const expr = await parseExpression('1;');
        expect(printExpression(expr)).toBe('1');
    });

    test('Binary expression', async () => {
        const expr = await parseExpression('1 + 2 ^ 3 * 4 % 5;');
        expect(printExpression(expr)).toBe('(1 + ((2 ^ 3) * (4 % 5)))');
    });

    test('Nested expression', async () => {
        const expr = await parseExpression('(1 + 2) ^ 3;');
        expect(printExpression(expr)).toBe('((1 + 2) ^ 3)');
    });
});
