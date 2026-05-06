/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { ParsedGrammarSet, SyntaxNode } from '../../grammar-parser/grammar-parser.js';
import {
    getRules, getTerminals, getRuleName, getTerminalPattern,
    isHiddenTerminal, isFragment,
} from '../../grammar-parser/grammar-queries.js';

/**
 * Compile a {@link ParsedGrammarSet} (one or more parsed `.langium` files) into
 * the source text of a tree-sitter `grammar.js` module. The output is the
 * canonical `module.exports = grammar({ name, word?, extras, rules })` shape
 * that the tree-sitter CLI's `tree-sitter generate` consumes.
 *
 * Fragment parser rules are emitted with a leading underscore so tree-sitter
 * inlines them; hidden terminals are folded into `extras`.
 */
export function compileGrammarJs(set: ParsedGrammarSet): string {
    const allRules: SyntaxNode[] = [];
    const allTerminals: SyntaxNode[] = [];

    for (const root of set.values()) {
        allRules.push(...getRules(root));
        allTerminals.push(...getTerminals(root));
    }

    const ruleEntries = allRules.map(rule => {
        const baseName = getRuleName(rule);
        const name = isFragment(rule) ? `_${baseName}` : baseName;
        const body = ruleToGrammarJs(rule);
        return `        ${name}: $ => ${body},`;
    });

    const terminalEntries = allTerminals
        .filter(t => !isHiddenTerminal(t))
        .map(t => {
            const name = getRuleName(t);
            const pattern = getTerminalPattern(t) ?? '/.*/';
            return `        ${name}: _ => ${pattern},`;
        });

    const hiddenPatterns = allTerminals
        .filter(isHiddenTerminal)
        .map(t => getTerminalPattern(t) ?? '/.*/');

    const extras = hiddenPatterns.length > 0
        ? `extras: $ => [${hiddenPatterns.join(', ')}, /\\s+/],`
        : `extras: $ => [/\\s+/],`;

    const word = allTerminals.find(t => getRuleName(t) === 'ID');

    const lines: string[] = [
        'module.exports = grammar({',
        "    name: 'generated',",
    ];
    if (word) {
        lines.push('    word: $ => $.ID,');
    }
    lines.push(`    ${extras}`);
    lines.push('    rules: {');
    lines.push(...ruleEntries);
    lines.push(...terminalEntries);
    lines.push('    },');
    lines.push('});');
    return lines.join('\n');
}

function namedChildrenNonNull(node: SyntaxNode): SyntaxNode[] {
    return node.namedChildren.filter((c): c is SyntaxNode => c !== null);
}

function ruleToGrammarJs(rule: SyntaxNode): string {
    const def = rule.childForFieldName('definition');
    if (!def) return 'seq()';
    return nodeToJs(def);
}

function nodeToJs(node: SyntaxNode): string {
    switch (node.type) {
        case 'alternatives': {
            const branches = namedChildrenNonNull(node).map(nodeToJs).filter(Boolean);
            if (branches.length === 0) return 'seq()';
            return branches.length === 1 ? branches[0] : `choice(${branches.join(', ')})`;
        }
        case 'conditional_branch':
        case 'unordered_group':
        case 'group': {
            const parts = namedChildrenNonNull(node).map(nodeToJs).filter(Boolean);
            if (parts.length === 0) return 'seq()';
            return parts.length === 1 ? parts[0] : `seq(${parts.join(', ')})`;
        }
        case 'abstract_token': {
            const children = namedChildrenNonNull(node);
            if (children.length === 0) return '';
            return nodeToJs(children[0]);
        }
        case 'abstract_token_with_cardinality': {
            const children = namedChildrenNonNull(node);
            const card = children.find(c => c.type === 'cardinality')?.text;
            const inners = children
                .filter(c => c.type !== 'cardinality')
                .map(nodeToJs)
                .filter(Boolean);
            const inner = inners.length === 0
                ? 'seq()'
                : inners.length === 1 ? inners[0] : `seq(${inners.join(', ')})`;
            if (!card) return inner;
            if (card === '?') return `optional(${inner})`;
            if (card === '*') return `repeat(${inner})`;
            if (card === '+') return `repeat1(${inner})`;
            return inner;
        }
        case 'assignment': {
            const feature = node.childForFieldName('feature')?.text ?? '';
            const terminal = node.childForFieldName('terminal');
            const inner = terminal ? nodeToJs(terminal) : 'seq()';
            return `field('${feature}', ${inner})`;
        }
        case 'keyword': {
            return node.childForFieldName('value')?.text ?? "''";
        }
        case 'rule_call': {
            const ruleName = node.childForFieldName('rule')?.text ?? 'unknown';
            return `$.${ruleName}`;
        }
        case 'cross_reference': {
            const terminal = node.childForFieldName('terminal');
            return terminal ? nodeToJs(terminal) : '$.ID';
        }
        case 'parenthesized_element':
        case 'parenthesized_assignable':
        case 'parenthesized_terminal': {
            const inner = namedChildrenNonNull(node).map(nodeToJs).filter(Boolean);
            if (inner.length === 0) return 'seq()';
            return inner.length === 1 ? inner[0] : `seq(${inner.join(', ')})`;
        }
        case 'action':
            return '';
        default: {
            const children = namedChildrenNonNull(node);
            if (children.length === 0) return '';
            const parts = children.map(nodeToJs).filter(Boolean);
            if (parts.length === 0) return '';
            return parts.length === 1 ? parts[0] : parts.join(', ');
        }
    }
}
