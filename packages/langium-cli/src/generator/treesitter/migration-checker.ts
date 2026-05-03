/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { AstNode, Grammar } from 'langium';
import { AstUtils, GrammarAST } from 'langium';

/**
 * The category of Langium grammar feature that has been dropped on the
 * tree-sitter migration path.
 */
export type DroppedFeature =
    | 'UnorderedGroup'
    | 'RuleParameter'
    | 'GuardCondition'
    | 'NegatedToken'
    | 'UntilToken'
    | 'LookaheadAssertion';

/**
 * A single migration finding produced by {@link checkMigration}. Identifies a
 * Langium grammar construct that has no direct tree-sitter equivalent and
 * carries a `hint` with a concrete rewrite suggestion.
 */
export interface MigrationError {
    /** Stable identifier of the dropped feature, useful for filtering / grouping. */
    feature: DroppedFeature;
    /** Human-readable description of where the feature was used. */
    message: string;
    /** Concrete rewrite suggestion the language author can act on. */
    hint: string;
    /** The offending AST node, if available. */
    node?: AstNode;
}

const HINTS: Record<DroppedFeature, string> = {
    UnorderedGroup: 'Tree-sitter does not support unordered groups (`&`). Rewrite the alternatives explicitly (e.g. `(a b) | (b a)`) or model the order-insensitive set with a list rule plus a validator.',
    RuleParameter: 'Tree-sitter rules cannot take parameters. Inline each parameter combination as a separate rule, or move the conditional behavior into a runtime check after parsing.',
    GuardCondition: 'Tree-sitter has no semantic predicates (`<P> ...`). Split the guarded alternative into separate rules or resolve the ambiguity with a `conflicts` declaration / `prec` annotation.',
    NegatedToken: 'Tree-sitter does not support negated tokens (`!elem`). Express the negation as a positive regex / character class (e.g. `/[^\\s]/`) on the terminal rule.',
    UntilToken: 'Tree-sitter does not support until-tokens (`-> elem`). Replace with a regex that matches everything up to the delimiter (e.g. `/[^"]*/` for a string body) inside the terminal rule.',
    LookaheadAssertion: 'Tree-sitter terminals do not support lookahead assertions (`?=`, `?!`, `?<=`, `?<!`). Rewrite the regex without the assertion, or split the terminal into multiple rules disambiguated by `prec`.'
};

/**
 * Walks the grammar and reports every use of a dropped Langium feature that
 * cannot be lowered to tree-sitter. The result is empty when the grammar is
 * already in the migrated subset.
 */
export function checkMigration(grammar: Grammar): MigrationError[] {
    const errors: MigrationError[] = [];

    for (const rule of grammar.rules) {
        if (GrammarAST.isParserRule(rule) || GrammarAST.isInfixRule(rule)) {
            for (const parameter of rule.parameters) {
                errors.push({
                    feature: 'RuleParameter',
                    message: `Rule '${rule.name}' declares parameter '${parameter.name}'.`,
                    hint: HINTS.RuleParameter,
                    node: parameter
                });
            }
        }
    }

    for (const node of AstUtils.streamAst(grammar)) {
        if (GrammarAST.isUnorderedGroup(node)) {
            errors.push({
                feature: 'UnorderedGroup',
                message: `Unordered group ('&') in rule '${ruleName(node)}'.`,
                hint: HINTS.UnorderedGroup,
                node
            });
        } else if (GrammarAST.isGroup(node) && node.guardCondition) {
            errors.push({
                feature: 'GuardCondition',
                message: `Guard condition in rule '${ruleName(node)}'.`,
                hint: HINTS.GuardCondition,
                node: node.guardCondition
            });
        } else if (GrammarAST.isNegatedToken(node)) {
            errors.push({
                feature: 'NegatedToken',
                message: `Negated token ('!') in rule '${ruleName(node)}'.`,
                hint: HINTS.NegatedToken,
                node
            });
        } else if (GrammarAST.isUntilToken(node)) {
            errors.push({
                feature: 'UntilToken',
                message: `Until token ('->') in rule '${ruleName(node)}'.`,
                hint: HINTS.UntilToken,
                node
            });
        } else if (GrammarAST.isTerminalElement(node) && node.lookahead) {
            errors.push({
                feature: 'LookaheadAssertion',
                message: `Lookahead assertion '${node.lookahead}' in rule '${ruleName(node)}'.`,
                hint: HINTS.LookaheadAssertion,
                node
            });
        }
    }

    return errors;
}

function ruleName(node: AstNode): string {
    let current: AstNode | undefined = node;
    while (current) {
        if (GrammarAST.isParserRule(current) || GrammarAST.isTerminalRule(current) || GrammarAST.isInfixRule(current)) {
            return current.name;
        }
        current = current.$container;
    }
    return '<unknown>';
}
