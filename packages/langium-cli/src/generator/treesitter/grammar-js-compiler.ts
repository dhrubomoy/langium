/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { GrammarAST } from 'langium';

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
