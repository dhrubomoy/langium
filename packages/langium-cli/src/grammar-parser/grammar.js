/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

module.exports = grammar({
  name: 'langium',

  word: $ => $.ID,

  extras: $ => [
    /\s+/,
    $.ML_COMMENT,
    $.SL_COMMENT,
  ],

  // Ambiguities between feature_name (which contains $.ID) and rule_call/simple_type
  conflicts: $ => [
    [$.simple_type, $.feature_name],
    [$.rule_call, $.feature_name],
    [$.terminal_rule_call, $.feature_name],
  ],

  rules: {

    // ═══════════════════════════════════════════════════
    // Root
    // ═══════════════════════════════════════════════════

    grammar: $ => seq(
      optional(seq('grammar', field('name', $.ID))),
      repeat($.grammar_import),
      repeat(choice(
        $.parser_rule,
        $.terminal_rule,
        $.infix_rule,
        $.interface_decl,
        $.type_decl,
        $.conflict_group_decl,
      )),
    ),

    grammar_import: $ => seq(
      'import',
      field('path', $.STRING),
      optional(';'),
    ),

    conflict_group_decl: $ => seq(
      'conflicts', ':', commaSep1($.conflict_group), optional(';'),
    ),

    conflict_group: $ => seq('[', commaSep1($.ID), ']'),

    // ═══════════════════════════════════════════════════
    // Interface declarations
    // ═══════════════════════════════════════════════════

    interface_decl: $ => seq(
      'interface',
      field('name', $.ID),
      optional(seq('extends', commaSep1(field('super_type', $.ID)))),
      '{',
      repeat($.type_attribute),
      '}',
      optional(';'),
    ),

    type_attribute: $ => seq(
      field('name', $.feature_name),
      optional(field('optional', '?')),
      ':',
      field('type', $.type_definition),
      optional(seq('=', field('default_value', $.value_literal))),
      optional(';'),
    ),

    // ═══════════════════════════════════════════════════
    // Type alias declarations
    // ═══════════════════════════════════════════════════

    type_decl: $ => seq(
      'type',
      field('name', $.ID),
      '=',
      field('type', $.type_definition),
      optional(';'),
    ),

    // ═══════════════════════════════════════════════════
    // Type definition expressions
    // ═══════════════════════════════════════════════════

    type_definition: $ => $.union_type,

    // A union_type is one or more array_types separated by '|'
    // When there is only one element, it is structurally an array_type (no union_type wrapper)
    union_type: $ => seq(
      $.array_type,
      repeat(seq('|', $.array_type)),
    ),

    array_type: $ => seq(
      $.reference_type,
      optional(seq('[', ']')),
    ),

    reference_type: $ => choice(
      $.simple_type,
      seq('@', field('reference_type', $.simple_type), optional('+')),
    ),

    simple_type: $ => choice(
      seq('(', $.type_definition, ')'),
      field('type_ref', $.ID),
      field('primitive_type', $.primitive_type),
      field('string_type', $.STRING),
    ),

    primitive_type: _ => choice('string', 'number', 'boolean', 'Date', 'bigint'),

    // ═══════════════════════════════════════════════════
    // Value literals (for interface attribute defaults)
    // ═══════════════════════════════════════════════════

    value_literal: $ => choice(
      $.string_literal,
      $.number_literal,
      $.boolean_literal,
      $.array_literal,
    ),

    string_literal:  $ => field('value', $.STRING),
    number_literal:  $ => field('value', $.NUMBER),
    boolean_literal: _ => choice('true', 'false'),
    array_literal:   $ => seq('[', optional(commaSep1($.value_literal)), ']'),

    // ═══════════════════════════════════════════════════
    // Parser rules
    // ═══════════════════════════════════════════════════

    parser_rule: $ => seq(
      optional(field('modifier', choice('entry', 'fragment'))),
      $.rule_name_and_params,
      optional(choice(
        seq('returns', field('return_type', choice($.ID, $.primitive_type))),
        field('inferred_type', $.inferred_type),
      )),
      ':',
      field('definition', $.alternatives),
      ';',
    ),

    infix_rule: $ => seq(
      'infix',
      $.rule_name_and_params,
      'on',
      field('call', $.rule_call),
      optional(choice(
        seq('returns', field('return_type', choice($.ID, $.primitive_type))),
        field('inferred_type', $.inferred_type),
      )),
      ':',
      field('operators', $.infix_rule_operators),
      ';',
    ),

    infix_rule_operators: $ => seq(
      $.infix_operator_list,
      repeat(seq('>', $.infix_operator_list)),
    ),

    infix_operator_list: $ => seq(
      optional(seq(field('associativity', choice('left', 'right')), 'assoc')),
      $.keyword,
      repeat(seq('|', $.keyword)),
    ),

    terminal_rule: $ => seq(
      optional(field('word_marker', '@word')),
      optional(field('hidden', 'hidden')),
      'terminal',
      optional(field('fragment', 'fragment')),
      field('name', $.ID),
      optional(seq('returns', field('return_type', $.ID))),
      ':',
      field('definition', $.terminal_alternatives),
      ';',
    ),

    rule_name_and_params: $ => seq(
      field('name', $.ID),
      optional(seq('<', optional(commaSep1($.parameter)), '>')),
    ),

    parameter: $ => field('name', $.ID),

    inferred_type: $ => seq(
      choice('infer', 'infers'),
      field('name', $.ID),
    ),

    // ═══════════════════════════════════════════════════
    // Alternatives / Groups / Tokens
    // ═══════════════════════════════════════════════════

    alternatives: $ => seq(
      $.conditional_branch,
      repeat(seq('|', $.conditional_branch)),
    ),

    conditional_branch: $ => choice(
      $.unordered_group,
      seq(
        '@prec',
        optional(seq('.', field('prec_assoc', choice('left', 'right')))),
        '(', field('prec', $.NUMBER), ')',
        repeat1($.abstract_token),
      ),
      seq('<', field('guard', $.disjunction), '>', repeat1($.abstract_token)),
    ),

    unordered_group: $ => seq(
      $.group,
      repeat(seq('&', $.group)),
    ),

    group: $ => repeat1($.abstract_token),

    abstract_token: $ => choice(
      $.abstract_token_with_cardinality,
      $.action,
    ),

    abstract_token_with_cardinality: $ => seq(
      choice($.assignment, $.abstract_terminal),
      optional($.cardinality),
    ),

    cardinality: _ => choice('?', '*', '+'),

    action: $ => seq(
      '{',
      choice(field('type', $.ID), field('inferred_type', $.inferred_type)),
      optional(seq(
        '.',
        field('feature', $.feature_name),
        field('operator', choice('=', '+=')),
        'current',
      )),
      '}',
    ),

    abstract_terminal: $ => choice(
      $.keyword,
      $.rule_call,
      $.parenthesized_element,
      $.predicated_keyword,
      $.predicated_rule_call,
      $.predicated_group,
      $.end_of_file,
    ),

    end_of_file: _ => 'EOF',

    keyword: $ => field('value', $.STRING),

    rule_call: $ => seq(
      field('rule', $.ID),
      optional(seq('<', commaSep1($.named_argument), '>')),
    ),

    named_argument: $ => seq(
      optional(seq(field('parameter', $.ID), '=')),
      field('value', $.disjunction),
    ),

    predicated_keyword: $ => seq(choice('=>', '->'), field('value', $.STRING)),

    predicated_rule_call: $ => seq(
      choice('=>', '->'),
      field('rule', $.ID),
      optional(seq('<', commaSep1($.named_argument), '>')),
    ),

    predicated_group: $ => seq(
      choice('=>', '->'),
      '(',
      field('elements', $.alternatives),
      ')',
    ),

    // ═══════════════════════════════════════════════════
    // Assignments
    // ═══════════════════════════════════════════════════

    assignment: $ => seq(
      optional(choice('=>', '->')),
      field('feature', $.feature_name),
      field('operator', choice('+=', '=', '?=')),
      field('terminal', $.assignable_terminal),
    ),

    assignable_terminal: $ => choice(
      $.keyword,
      $.rule_call,
      $.parenthesized_assignable,
      $.cross_reference,
    ),

    parenthesized_assignable: $ => seq('(', $.assignable_alternatives, ')'),

    assignable_alternatives: $ => seq(
      $.assignable_terminal,
      repeat(seq('|', $.assignable_terminal)),
    ),

    cross_reference: $ => seq(
      '[',
      optional(field('multi', '+')),
      field('type', $.ID),
      optional(seq(choice('|', ':'), field('terminal', $.cross_referenceable_terminal))),
      ']',
    ),

    cross_referenceable_terminal: $ => choice($.keyword, $.rule_call),

    parenthesized_element: $ => seq('(', $.alternatives, ')'),

    // ═══════════════════════════════════════════════════
    // Conditions (guarded branches and named arguments)
    // ═══════════════════════════════════════════════════

    disjunction:  $ => seq($.conjunction, repeat(seq('|', $.conjunction))),
    conjunction:  $ => seq($.negation, repeat(seq('&', $.negation))),
    negation:     $ => choice($.atom, seq('!', $.negation)),
    atom:         $ => choice(
      $.parameter_reference,
      seq('(', $.disjunction, ')'),
      'true',
      'false',
    ),
    parameter_reference: $ => field('parameter', $.ID),

    // ═══════════════════════════════════════════════════
    // Terminal rule elements
    // ═══════════════════════════════════════════════════

    terminal_alternatives: $ => seq(
      $.terminal_group,
      repeat(seq('|', $.terminal_group)),
    ),

    terminal_group: $ => seq(
      $.terminal_token,
      repeat($.terminal_token),
    ),

    terminal_token: $ => seq(
      $.terminal_token_element,
      optional($.cardinality),
    ),

    terminal_token_element: $ => choice(
      $.character_range,
      $.terminal_rule_call,
      $.parenthesized_terminal,
      $.negated_token,
      $.until_token,
      $.regex_token,
      $.wildcard,
    ),

    parenthesized_terminal: $ => seq(
      '(',
      optional(field('lookahead', choice('?=', '?!', '?<=', '?<!'))),
      $.terminal_alternatives,
      ')',
    ),

    terminal_rule_call: $ => field('rule', $.ID),

    negated_token: $ => seq('!', $.terminal_token_element),

    until_token:  $ => seq('->', $.terminal_token_element),

    regex_token:  $ => $.RegexLiteral,

    wildcard:     _ => '.',

    character_range: $ => seq(
      field('left', $.STRING),
      optional(seq('..', field('right', $.STRING))),
    ),

    // ═══════════════════════════════════════════════════
    // Feature names — keywords allowed as property names in assignments
    // ═══════════════════════════════════════════════════

    feature_name: $ => choice(
      'infix', 'on', 'right', 'left', 'assoc', 'conflicts', 'current',
      'entry', 'extends', 'false', 'fragment', 'grammar', 'hidden',
      'import', 'interface', 'returns', 'terminal', 'true', 'type',
      'infer', 'infers', 'with', $.primitive_type, $.ID,
    ),

    // ═══════════════════════════════════════════════════
    // Terminals
    // ═══════════════════════════════════════════════════

    ID:           _ => /\^?[_a-zA-Z][\w_]*/,
    STRING:       _ => /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/,
    NUMBER:       _ => /NaN|-?((\d*\.\d+|\d+)([Ee][+-]?\d+)?|Infinity)/,
    RegexLiteral: _ => /\/(?![*+?])(?:[^\r\n\[/\\]|\\.|\[(?:[^\r\n\]\\]|\\.)*\])+\/[a-z]*/,
    ML_COMMENT:   _ => /\/\*[\s\S]*?\*\//,
    SL_COMMENT:   _ => /\/\/[^\n\r]*/,
  },
});

function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}
