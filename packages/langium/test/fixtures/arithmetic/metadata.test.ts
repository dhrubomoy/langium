/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import type { GrammarMetadata } from 'langium/generate';
import { ARITHMETIC_METADATA } from './metadata.js';

describe('arithmetic metadata fixture', () => {

    test('declares the word terminal and extras', () => {
        expect(ARITHMETIC_METADATA.word).toBe('ID');
        expect(ARITHMETIC_METADATA.extras).toEqual(['ML_COMMENT', 'SL_COMMENT']);
    });

    test('covers every node type required by the PRD', () => {
        const required = [
            'Definition',
            'AbstractDefinition',
            'Addition',
            'Subtraction',
            'Multiplication',
            'Division',
            'Negation',
            'NumberLiteral',
            'NamedExpression'
        ];
        for (const nodeType of required) {
            expect(ARITHMETIC_METADATA.nodes[nodeType]).toBeDefined();
            expect(ARITHMETIC_METADATA.nodes[nodeType].nodeType).toBe(nodeType);
        }
    });

    test('Definition has name and expr fields with single-value operator', () => {
        const def = ARITHMETIC_METADATA.nodes.Definition;
        expect(def.fields).toEqual([
            { name: 'name', operator: '=' },
            { name: 'expr', operator: '=' }
        ]);
    });

    test.each(['Addition', 'Subtraction', 'Multiplication', 'Division'])(
        '%s has left and right fields',
        nodeType => {
            const node = ARITHMETIC_METADATA.nodes[nodeType];
            expect(node.fields).toEqual([
                { name: 'left', operator: '=' },
                { name: 'right', operator: '=' }
            ]);
        }
    );

    test('Negation has operand field', () => {
        expect(ARITHMETIC_METADATA.nodes.Negation.fields).toEqual([
            { name: 'operand', operator: '=' }
        ]);
    });

    test('NumberLiteral has value field', () => {
        expect(ARITHMETIC_METADATA.nodes.NumberLiteral.fields).toEqual([
            { name: 'value', operator: '=' }
        ]);
    });

    test('NamedExpression element field is a cross-reference', () => {
        const named = ARITHMETIC_METADATA.nodes.NamedExpression;
        expect(named.fields).toHaveLength(1);
        const [element] = named.fields;
        expect(element.name).toBe('element');
        expect(element.operator).toBe('=');
        expect(element.isRef).toBe(true);
    });

    test('only NamedExpression.element is marked as a cross-reference', () => {
        for (const [nodeType, node] of Object.entries(ARITHMETIC_METADATA.nodes)) {
            for (const field of node.fields) {
                if (field.isRef) {
                    expect(`${nodeType}.${field.name}`).toBe('NamedExpression.element');
                }
            }
        }
    });

    test('every field operator is one of the three legal values', () => {
        const legal: Array<GrammarMetadata['nodes'][string]['fields'][number]['operator']> = ['=', '+=', '?='];
        for (const node of Object.values(ARITHMETIC_METADATA.nodes)) {
            for (const field of node.fields) {
                expect(legal).toContain(field.operator);
            }
        }
    });
});
