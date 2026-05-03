/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { GrammarMetadata } from 'langium/generate';

/**
 * Hand-crafted {@link GrammarMetadata} for the simplified arithmetic language.
 * Acts as ground-truth for the runtime index builder (US-006/007/008) and the
 * compiler's metadata emitter (US-022). Mirrors the node types, fields, and
 * `extras` / `word` declarations of the hand-written {@link ./grammar.js}.
 */
export const ARITHMETIC_METADATA: GrammarMetadata = {
    version: '1.0.0',
    word: 'ID',
    extras: ['ML_COMMENT', 'SL_COMMENT'],
    nodes: {
        // `def NAME = EXPR;`
        Definition: {
            nodeType: 'Definition',
            fields: [
                { name: 'name', operator: '=' },
                { name: 'expr', operator: '=' }
            ]
        },
        // Supertype/alias: AbstractDefinition := Definition. No fields of its
        // own; included so consumers can resolve the supertype name.
        AbstractDefinition: {
            nodeType: 'AbstractDefinition',
            fields: []
        },
        // Supertype/choice over the concrete expression node types. No fields.
        Expression: {
            nodeType: 'Expression',
            fields: []
        },
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
        // Cross-reference: `element` resolves against AbstractDefinition
        // declarations in the document index.
        NamedExpression: {
            nodeType: 'NamedExpression',
            fields: [
                { name: 'element', operator: '=', isRef: true }
            ]
        }
    }
};
