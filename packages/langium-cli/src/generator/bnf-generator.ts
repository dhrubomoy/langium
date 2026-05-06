/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { SyntaxNode, ParsedGrammarSet } from '../grammar-parser/grammar-parser.js';
import { getRules, getTerminals, getRuleName } from '../grammar-parser/grammar-queries.js';

export interface BnfOptions {
    dialect?: 'EBNF' | 'GBNF';
}

export function generateBnf(set: ParsedGrammarSet, options: BnfOptions = { dialect: 'GBNF' }): string {
    void options;
    const lines: string[] = [];
    for (const root of set.values()) {
        for (const rule of [...getRules(root), ...getTerminals(root)]) {
            const name = getRuleName(rule);
            const def = rule.childForFieldName('definition');
            const rhs = def ? nodeToEbnf(def) : '/* empty */';
            lines.push(`${name} ::= ${rhs}`);
        }
    }
    return lines.join('\n\n');
}

function namedChildrenNonNull(node: SyntaxNode): SyntaxNode[] {
    return node.namedChildren.filter((c): c is SyntaxNode => c !== null);
}

function nodeToEbnf(node: SyntaxNode): string {
    switch (node.type) {
        case 'alternatives':
        case 'assignable_alternatives':
        case 'terminal_alternatives': {
            const parts = namedChildrenNonNull(node).map(nodeToEbnf).filter(Boolean);
            return parts.join(' | ');
        }
        case 'conditional_branch':
        case 'unordered_group':
        case 'group':
        case 'terminal_group':
            return namedChildrenNonNull(node).map(nodeToEbnf).filter(Boolean).join(' ');
        case 'abstract_token':
        case 'abstract_token_with_cardinality':
        case 'terminal_token': {
            const children = namedChildrenNonNull(node);
            const last = children[children.length - 1];
            const card = last?.type === 'cardinality' ? last.text : '';
            const inner = children.filter(c => c.type !== 'cardinality').map(nodeToEbnf).join('');
            return card ? `(${inner})${card}` : inner;
        }
        case 'assignment': {
            const feature = node.childForFieldName('feature')?.text ?? '';
            const terminal = node.childForFieldName('terminal');
            return terminal ? nodeToEbnf(terminal) : feature;
        }
        case 'keyword':
            return node.childForFieldName('value')?.text ?? node.text;
        case 'rule_call':
        case 'terminal_rule_call':
            return node.childForFieldName('rule')?.text ?? node.text;
        case 'cross_reference':
            return `[${node.childForFieldName('type')?.text ?? ''}]`;
        case 'regex_token':
        case 'terminal_token_element':
        case 'character_range':
            return node.text;
        case 'parenthesized_element':
        case 'parenthesized_assignable':
        case 'parenthesized_terminal':
            return `(${namedChildrenNonNull(node).map(nodeToEbnf).join('')})`;
        default:
            return node.namedChildCount > 0
                ? namedChildrenNonNull(node).map(nodeToEbnf).filter(Boolean).join(' ')
                : '';
    }
}
