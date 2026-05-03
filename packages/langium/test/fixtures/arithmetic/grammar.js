/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

/**
 * Hand-crafted tree-sitter grammar for the simplified arithmetic language used
 * as ground-truth for the Langium tree-sitter pipeline. The grammar.js produced
 * by the Langium-to-tree-sitter compiler (US-020 / US-023) is regression-tested
 * against this file (US-025).
 *
 * Language shape:
 *
 *   def x = 1 + 2;
 *   def y = -x * (3 + 4);
 *   def z = x / y;
 *
 * Nodes mirror the metadata fixture in ./metadata.ts (US-004).
 */

/// <reference types="tree-sitter-cli/dsl" />

module.exports = grammar({
    name: 'arithmetic',

    // The word terminal: tree-sitter uses this to disambiguate keywords from
    // identifiers. Without it, `def` could be lexed as an `ID`.
    word: $ => $.ID,

    // Whitespace and comments are skipped between tokens.
    extras: $ => [
        /\s+/,
        $.ML_COMMENT,
        $.SL_COMMENT
    ],

    // Abstract supertypes — these don't appear as concrete nodes in the parse
    // tree, but are recognised by tree-sitter's node-types.json so consumers
    // can query them. AbstractDefinition is the reference target for
    // NamedExpression; Expression unifies all expression kinds.
    supertypes: $ => [
        $.AbstractDefinition,
        $.Expression
    ],

    rules: {
        // Entry rule: a source file is a sequence of top-level definitions.
        source_file: $ => repeat($.Definition),

        // A named expression definition: `def NAME = EXPR;`
        Definition: $ => seq(
            'def',
            field('name', $.ID),
            '=',
            field('expr', $.Expression),
            ';'
        ),

        // Supertype for everything that can be the target of a NamedExpression
        // cross-reference. Only Definition for now; future extensions (e.g.
        // parameters) would join this union.
        AbstractDefinition: $ => $.Definition,

        // Supertype: any arithmetic expression.
        Expression: $ => choice(
            $.Addition,
            $.Subtraction,
            $.Multiplication,
            $.Division,
            $.Negation,
            $.Parenthesized,
            $.NumberLiteral,
            $.NamedExpression
        ),

        // Binary operators. Lower precedence number = lower priority.
        // Both `+` and `-` are at precedence 1 and left-associative; `*` and
        // `/` at precedence 2; unary `-` at precedence 3.
        Addition: $ => prec.left(1, seq(
            field('left', $.Expression),
            '+',
            field('right', $.Expression)
        )),

        Subtraction: $ => prec.left(1, seq(
            field('left', $.Expression),
            '-',
            field('right', $.Expression)
        )),

        Multiplication: $ => prec.left(2, seq(
            field('left', $.Expression),
            '*',
            field('right', $.Expression)
        )),

        Division: $ => prec.left(2, seq(
            field('left', $.Expression),
            '/',
            field('right', $.Expression)
        )),

        // Unary minus. Right-associative so that `--x` parses as Neg(Neg(x)).
        Negation: $ => prec.right(3, seq(
            '-',
            field('operand', $.Expression)
        )),

        // Parenthesised grouping. Highest static precedence so the parser
        // commits to it as soon as it sees an opening paren.
        Parenthesized: $ => prec(4, seq(
            '(',
            field('expression', $.Expression),
            ')'
        )),

        // A literal numeric value.
        NumberLiteral: $ => field('value', $.Number),

        // A reference to a previously declared AbstractDefinition (a
        // Definition by name). The compiler/runtime resolves this against
        // the document index.
        NamedExpression: $ => field('element', $.ID),

        // Terminals.
        Number: $ => token(/[0-9]+(\.[0-9]+)?/),
        ID: $ => token(/[_a-zA-Z][\w_]*/),
        ML_COMMENT: $ => token(seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/')),
        SL_COMMENT: $ => token(seq('//', /[^\n\r]*/))
    }
});
