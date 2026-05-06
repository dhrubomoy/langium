/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { GrammarAST, type Grammar } from 'langium';

/**
 * Compile a Langium {@link GrammarAST.ParserRule} to its tree-sitter
 * `grammar.js` rule body. The returned string is the right-hand side of
 * `<RuleName>: $ => <body>` in the rules object — caller composes the full
 * `name: $ => body` line from {@link compileParserRuleEntry}.
 *
 * Fragment rules are emitted with a leading underscore so that tree-sitter
 * inlines them (per the tree-sitter convention for hidden rules).
 */
export function compileParserRule(rule: GrammarAST.ParserRule): string {
    return compileElement(rule.definition);
}

/**
 * Convenience wrapper that emits the full `<name>: $ => <body>` rule entry,
 * applying the underscore prefix to fragment rules.
 */
export function compileParserRuleEntry(rule: GrammarAST.ParserRule): string {
    const name = ruleEmitName(rule);
    return `${name}: $ => ${compileParserRule(rule)}`;
}

/**
 * Compile a Langium {@link GrammarAST.TerminalRule} to its tree-sitter
 * `grammar.js` rule body. Terminals always render inside `token(...)` so the
 * emitted node is a single token in the resulting parse tree.
 */
export function compileTerminalRule(rule: GrammarAST.TerminalRule): string {
    return `token(${compileTerminalElement(rule.definition)})`;
}

/**
 * Convenience wrapper that emits the full `<name>: $ => <body>` terminal-rule
 * entry. Used when materialising the `rules` object of the grammar.js module.
 */
export function compileTerminalRuleEntry(rule: GrammarAST.TerminalRule): string {
    return `${rule.name}: $ => ${compileTerminalRule(rule)}`;
}

/**
 * Compile a Langium {@link GrammarAST.InfixRule} to its tree-sitter
 * `grammar.js` rule body. The infix rule's precedence groups are emitted as
 * separate `prec.left` / `prec.right` / `prec` alternatives over the base
 * rule (`infix X on Base`), with `field('left', ...)`, `field('operator', ...)`,
 * and `field('right', ...)` matching the AST shape Langium synthesises (see
 * `calculateInfixInterfaces` in `type-system/type-collector/inferred-types.ts`).
 *
 * The first precedence group (highest in source) gets the highest tree-sitter
 * precedence number; the base rule is included as the lowest-precedence
 * alternative so the rule terminates at primary expressions.
 */
export function compileInfixRule(rule: GrammarAST.InfixRule): string {
    const baseName = rule.call.rule.ref?.name ?? rule.call.rule.$refText;
    const groups = rule.operators.precedences;
    const alternatives: string[] = [];
    for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const precedence = groups.length - i;
        const opStrings = group.operators.map(op => emitString(op.value));
        const operator = opStrings.length === 1 ? opStrings[0] : `choice(${opStrings.join(', ')})`;
        const seqBody = `seq(field('left', $.${rule.name}), field('operator', ${operator}), field('right', $.${rule.name}))`;
        const wrapped = wrapPrec(seqBody, precedence, group.associativity);
        alternatives.push(wrapped);
    }
    alternatives.push(`$.${baseName}`);
    return `choice(${alternatives.join(', ')})`;
}

/**
 * Convenience wrapper that emits the full `<name>: $ => <body>` infix-rule
 * entry. Used when materialising the `rules` object of the grammar.js module.
 */
export function compileInfixRuleEntry(rule: GrammarAST.InfixRule): string {
    return `${rule.name}: $ => ${compileInfixRule(rule)}`;
}

function wrapPrec(body: string, precedence: number, associativity?: 'left' | 'right' | 'none'): string {
    if (associativity === 'right') {
        return `prec.right(${precedence}, ${body})`;
    }
    if (associativity === 'none') {
        return `prec(${precedence}, ${body})`;
    }
    return `prec.left(${precedence}, ${body})`;
}

/**
 * Build the value side of the `extras: $ => [...]` declaration. Every
 * `hidden terminal X: ...` in the grammar contributes one entry. Hidden
 * terminals whose body is a single regex (e.g. `hidden terminal WS: /\s+/;`)
 * are inlined as `/regex/` to match the tree-sitter convention of using
 * anonymous regexes for whitespace; richer terminals are referenced as
 * `$.NAME` so the rule remains addressable.
 *
 * Returns `[]` (an empty array literal) when no hidden terminals are declared.
 */
export function compileExtras(grammar: Grammar): string {
    const hidden = grammar.rules
        .filter(GrammarAST.isTerminalRule)
        .filter(rule => rule.hidden);
    if (hidden.length === 0) {
        return '[]';
    }
    return `[${hidden.map(renderExtraEntry).join(', ')}]`;
}

/**
 * Locate the terminal annotated with `@word` and return the value side of the
 * `word: $ => $.NAME` declaration (i.e. just `$.NAME`). Returns `undefined`
 * when no terminal is annotated — caller omits the `word` field in that case.
 */
export function compileWord(grammar: Grammar): string | undefined {
    const wordTerminal = grammar.rules
        .filter(GrammarAST.isTerminalRule)
        .find(rule => rule.isWord);
    if (!wordTerminal) {
        return undefined;
    }
    return `$.${wordTerminal.name}`;
}

function compileElement(element: GrammarAST.AbstractElement): string {
    const body = renderElement(element);
    return applyCardinality(body, element.cardinality);
}

function renderElement(element: GrammarAST.AbstractElement): string {
    if (GrammarAST.isAlternatives(element)) {
        return renderAlternatives(element);
    }
    if (GrammarAST.isGroup(element)) {
        return renderGroup(element);
    }
    if (GrammarAST.isUnorderedGroup(element)) {
        // UnorderedGroup is rejected by the migration checker (US-019); render
        // as a seq to keep compilation total in case the checker is bypassed.
        return `seq(${element.elements.map(compileElement).join(', ')})`;
    }
    if (GrammarAST.isAssignment(element)) {
        return renderAssignment(element);
    }
    if (GrammarAST.isCrossReference(element)) {
        return renderCrossReference(element);
    }
    if (GrammarAST.isKeyword(element)) {
        return emitString(element.value);
    }
    if (GrammarAST.isRuleCall(element)) {
        return renderRuleCall(element);
    }
    if (GrammarAST.isAction(element)) {
        // Actions reshape the AST during parsing; tree-sitter has no equivalent
        // (node types come from rule names). The metadata compiler (US-022)
        // captures the action separately. Emit a no-op marker that the caller
        // will strip from any enclosing seq.
        return ACTION_PLACEHOLDER;
    }
    if (GrammarAST.isEndOfFile(element)) {
        return '$._eof';
    }
    return `/* unsupported: ${element.$type} */`;
}

function renderAlternatives(alt: GrammarAST.Alternatives): string {
    const parts = alt.elements.map(compileElement).filter(part => part !== ACTION_PLACEHOLDER);
    if (parts.length === 0) {
        return ACTION_PLACEHOLDER;
    }
    if (parts.length === 1) {
        return parts[0];
    }
    return `choice(${parts.join(', ')})`;
}

function renderGroup(group: GrammarAST.Group): string {
    const seqBody = renderGroupBody(group);
    if (group.prec === undefined) {
        return seqBody;
    }
    if (group.precAssoc === 'left') {
        return `prec.left(${group.prec}, ${seqBody})`;
    }
    if (group.precAssoc === 'right') {
        return `prec.right(${group.prec}, ${seqBody})`;
    }
    return `prec(${group.prec}, ${seqBody})`;
}

function renderGroupBody(group: GrammarAST.Group): string {
    const parts = group.elements.map(compileElement).filter(part => part !== ACTION_PLACEHOLDER);
    if (parts.length === 0) {
        return ACTION_PLACEHOLDER;
    }
    if (parts.length === 1 && group.prec === undefined) {
        return parts[0];
    }
    return `seq(${parts.join(', ')})`;
}

function renderAssignment(assignment: GrammarAST.Assignment): string {
    const inner = compileElement(assignment.terminal);
    return `field('${assignment.feature}', ${inner})`;
}

function renderCrossReference(ref: GrammarAST.CrossReference): string {
    if (ref.terminal) {
        return compileElement(ref.terminal);
    }
    return '$.ID';
}

function renderRuleCall(call: GrammarAST.RuleCall): string {
    const target = call.rule.ref;
    const name = target ? ruleEmitName(target) : call.rule.$refText;
    return `$.${name}`;
}

function ruleEmitName(rule: GrammarAST.AbstractRule): string {
    if (GrammarAST.isParserRule(rule) && rule.fragment) {
        return `_${rule.name}`;
    }
    return rule.name;
}

function compileTerminalElement(element: GrammarAST.AbstractElement): string {
    const body = renderTerminalElement(element);
    return applyCardinality(body, element.cardinality);
}

function renderTerminalElement(element: GrammarAST.AbstractElement): string {
    if (GrammarAST.isRegexToken(element)) {
        return element.regex;
    }
    if (GrammarAST.isTerminalAlternatives(element)) {
        const parts = element.elements.map(compileTerminalElement);
        if (parts.length === 1) {
            return parts[0];
        }
        return `choice(${parts.join(', ')})`;
    }
    if (GrammarAST.isTerminalGroup(element)) {
        const parts = element.elements.map(compileTerminalElement);
        if (parts.length === 1) {
            return parts[0];
        }
        return `seq(${parts.join(', ')})`;
    }
    if (GrammarAST.isTerminalRuleCall(element)) {
        const target = element.rule.ref;
        const name = target ? target.name : element.rule.$refText;
        return `$.${name}`;
    }
    if (GrammarAST.isCharacterRange(element)) {
        return renderCharacterRange(element);
    }
    if (GrammarAST.isWildcard(element)) {
        return '/./';
    }
    if (GrammarAST.isKeyword(element)) {
        return emitString(element.value);
    }
    return `/* unsupported terminal: ${element.$type} */`;
}

function renderCharacterRange(range: GrammarAST.CharacterRange): string {
    if (range.right) {
        return `/[${escapeForRegexClass(range.left.value)}-${escapeForRegexClass(range.right.value)}]/`;
    }
    return emitString(range.left.value);
}

function renderExtraEntry(rule: GrammarAST.TerminalRule): string {
    const def = rule.definition;
    if (GrammarAST.isRegexToken(def) && def.cardinality === undefined) {
        return def.regex;
    }
    return `$.${rule.name}`;
}

function escapeForRegexClass(value: string): string {
    return value.replace(/[\\\]\-^]/g, ch => `\\${ch}`);
}

function emitString(value: string): string {
    const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `'${escaped}'`;
}

function applyCardinality(body: string, cardinality?: '*' | '+' | '?'): string {
    if (body === ACTION_PLACEHOLDER) {
        return body;
    }
    switch (cardinality) {
        case '?': return `optional(${body})`;
        case '*': return `repeat(${body})`;
        case '+': return `repeat1(${body})`;
        default: return body;
    }
}

const ACTION_PLACEHOLDER = '__action__';
