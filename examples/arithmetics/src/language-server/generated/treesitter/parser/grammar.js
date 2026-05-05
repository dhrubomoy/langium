/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

/// <reference types="tree-sitter-cli/dsl" />

module.exports = grammar({
    name: 'Arithmetics',

    extras: $ => [/\s+/, /\/\*[\s\S]*?\*\//, /\/\/[^\n\r]*/],

    rules: {
        Module: $ => seq('module', field('name', $.ID), repeat(field('statements', $.Statement))),
        Statement: $ => choice($.Definition, $.Evaluation),
        Definition: $ => seq('def', field('name', $.ID), optional(seq('(', field('args', $.DeclaredParameter), repeat(seq(',', field('args', $.DeclaredParameter))), ')')), ':', field('expr', $.Expression), ';'),
        DeclaredParameter: $ => field('name', $.ID),
        Evaluation: $ => seq(field('expression', $.Expression), ';'),
        Expression: $ => $.BinaryExpression,
        BinaryExpression: $ => choice(prec.left(4, seq(field('left', $.BinaryExpression), field('operator', '%'), field('right', $.BinaryExpression))), prec.left(3, seq(field('left', $.BinaryExpression), field('operator', '^'), field('right', $.BinaryExpression))), prec.left(2, seq(field('left', $.BinaryExpression), field('operator', choice('*', '/')), field('right', $.BinaryExpression))), prec.left(1, seq(field('left', $.BinaryExpression), field('operator', choice('+', '-')), field('right', $.BinaryExpression))), $.PrimaryExpression),
        PrimaryExpression: $ => choice(seq('(', $.Expression, ')'), field('value', $.NUMBER), seq(field('func', $.ID), optional(seq('(', field('args', $.Expression), repeat(seq(',', field('args', $.Expression))), ')')))),
        WS: $ => token(/\s+/),
        ID: $ => token(/[_a-zA-Z][\w_]*/),
        NUMBER: $ => token(/[0-9]+(\.[0-9]*)?/),
        ML_COMMENT: $ => token(/\/\*[\s\S]*?\*\//),
        SL_COMMENT: $ => token(/\/\/[^\n\r]*/)
    }
});
