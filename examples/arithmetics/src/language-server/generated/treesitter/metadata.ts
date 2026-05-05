/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { GrammarMetadata } from 'langium/generate';

export const GRAMMAR_METADATA: GrammarMetadata = {
    "version": "1.0.0",
    "nodes": {
        "Module": {
            "nodeType": "Module",
            "fields": [
                {
                    "name": "name",
                    "operator": "="
                },
                {
                    "name": "statements",
                    "operator": "+="
                }
            ]
        },
        "Statement": {
            "nodeType": "Statement",
            "fields": []
        },
        "Definition": {
            "nodeType": "Definition",
            "fields": [
                {
                    "name": "name",
                    "operator": "="
                },
                {
                    "name": "args",
                    "operator": "+="
                },
                {
                    "name": "expr",
                    "operator": "="
                }
            ]
        },
        "DeclaredParameter": {
            "nodeType": "DeclaredParameter",
            "fields": [
                {
                    "name": "name",
                    "operator": "="
                }
            ]
        },
        "Evaluation": {
            "nodeType": "Evaluation",
            "fields": [
                {
                    "name": "expression",
                    "operator": "="
                }
            ]
        },
        "Expression": {
            "nodeType": "Expression",
            "fields": []
        },
        "BinaryExpression": {
            "nodeType": "BinaryExpression",
            "fields": [
                {
                    "name": "left",
                    "operator": "="
                },
                {
                    "name": "operator",
                    "operator": "="
                },
                {
                    "name": "right",
                    "operator": "="
                }
            ]
        },
        "PrimaryExpression": {
            "nodeType": "PrimaryExpression",
            "fields": [
                {
                    "name": "value",
                    "operator": "="
                },
                {
                    "name": "func",
                    "operator": "=",
                    "isRef": true
                },
                {
                    "name": "args",
                    "operator": "+="
                }
            ],
            "isAction": true,
            "actionType": "NumberLiteral"
        },
        "NumberLiteral": {
            "nodeType": "NumberLiteral",
            "fields": [],
            "isAction": true,
            "actionType": "NumberLiteral"
        },
        "FunctionCall": {
            "nodeType": "FunctionCall",
            "fields": [],
            "isAction": true,
            "actionType": "FunctionCall"
        }
    },
    "extras": []
};
