/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { CompletionRequest, CompletionResult, CompletionFeature, SyntaxNode, Mutable, AstNode, GrammarConfig } from 'langium-core';
import { GrammarAST, GrammarUtils, SyntaxNodeUtils, AstUtils } from 'langium-core';
import type { NextFeature } from './follow-element-computation.js';
import { findFirstFeatures, findNextFeatures } from './follow-element-computation.js';
import type { LangiumChevrotainServices } from './chevrotain-services.js';

/**
 * Chevrotain-specific completion logic.
 * Extracts completion data from the CompletionParser and uses
 * follow-element computation to determine expected grammar features.
 *
 * Used internally by `ChevrotainAdapter.getCompletionFeatures()`.
 */
export class ChevrotainCompletion {

    protected readonly services: LangiumChevrotainServices;

    constructor(services: LangiumChevrotainServices) {
        this.services = services;
    }

    getCompletionFeatures(request: CompletionRequest): CompletionResult[] {
        const { rootSyntaxNode, text, offset, grammar, grammarRegistry } = request;
        const results: CompletionResult[] = [];
        const grammarConfig = this.services.parser.GrammarConfig;

        // Data type rules need special handling
        const dataTypeRuleOffsets = this.findDataTypeRuleStart(rootSyntaxNode, offset, grammarRegistry);
        if (dataTypeRuleOffsets) {
            const [ruleStart, ruleEnd] = dataTypeRuleOffsets;
            const leafBefore = SyntaxNodeUtils.findLeafSyntaxNodeBeforeOffset(rootSyntaxNode, ruleStart);
            const contextNode = leafBefore ? SyntaxNodeUtils.findAstNodeForSyntaxNode(leafBefore) : undefined;
            const features = this.findFeaturesAt(rootSyntaxNode, text, ruleStart, grammar);
            results.push({
                features: this.convertFeatures(features),
                contextNode,
                tokenOffset: ruleStart,
                tokenEndOffset: ruleEnd,
                offset
            });
        }

        const { nextTokenStart, nextTokenEnd, previousTokenStart, previousTokenEnd } = this.findTokenBoundaries(text, offset);

        let astNodeOffset = nextTokenStart;
        if (offset <= nextTokenStart && previousTokenStart !== undefined) {
            astNodeOffset = previousTokenStart;
        }
        const leaf = SyntaxNodeUtils.findLeafSyntaxNodeBeforeOffset(rootSyntaxNode, astNodeOffset);
        const astNode = leaf ? SyntaxNodeUtils.findAstNodeForSyntaxNode(leaf) : undefined;

        let performNextCompletion = true;
        if (previousTokenStart !== undefined && previousTokenEnd !== undefined && previousTokenEnd === offset) {
            // Complete the current/previous token
            const features = this.findFeaturesAt(rootSyntaxNode, text, previousTokenStart, grammar);
            results.push({
                features: this.convertFeatures(features),
                contextNode: astNode,
                tokenOffset: previousTokenStart,
                tokenEndOffset: previousTokenEnd,
                offset
            });

            performNextCompletion = this.performNextTokenCompletion(
                text.substring(previousTokenStart, previousTokenEnd),
                grammarConfig
            );
            if (performNextCompletion) {
                // Complete the immediate next feature after the previous token
                const nextFeatures = this.findFeaturesAt(rootSyntaxNode, text, previousTokenEnd, grammar);
                results.push({
                    features: this.convertFeatures(nextFeatures),
                    contextNode: astNode,
                    tokenOffset: previousTokenEnd,
                    tokenEndOffset: previousTokenEnd,
                    offset
                });
            }
        }

        if (!astNode) {
            // Empty document — offer entry rule's first features
            const parserRule = GrammarUtils.getEntryRule(grammar);
            if (!parserRule) {
                throw new Error('Missing entry parser rule');
            }
            const firstFeatures = findFirstFeatures(parserRule.definition).map(f => f[f.length - 1]);
            results.push({
                features: this.convertFeatures(firstFeatures),
                contextNode: undefined,
                tokenOffset: nextTokenStart,
                tokenEndOffset: nextTokenEnd,
                offset
            });
        } else if (performNextCompletion) {
            // Complete the next feature
            const features = this.findFeaturesAt(rootSyntaxNode, text, nextTokenStart, grammar);
            results.push({
                features: this.convertFeatures(features),
                contextNode: astNode,
                tokenOffset: nextTokenStart,
                tokenEndOffset: nextTokenEnd,
                offset
            });
        }

        return results;
    }

    protected findFeaturesAt(rootSyntaxNode: SyntaxNode, text: string, featureOffset: number, grammar: GrammarAST.Grammar): NextFeature[] {
        const { tokens, featureStack, tokenIndex } = this.services.parser.ParserAdapter.getCompletionData(rootSyntaxNode, text, featureOffset);

        if (featureStack && tokenIndex > 0) {
            const leftoverTokens = tokens.slice(tokenIndex);
            return findNextFeatures([featureStack.map(feature => ({ feature }))], leftoverTokens);
        }

        const parserRule = GrammarUtils.getEntryRule(grammar)!;
        const syntheticEntryRuleCall = this.buildSyntheticEntryRuleCall(parserRule);
        return findNextFeatures([[syntheticEntryRuleCall]], tokens);
    }

    protected findTokenBoundaries(text: string, offset: number) {
        const tokens = this.services.parser.Lexer.tokenize(text).tokens;
        if (tokens.length === 0) {
            return { nextTokenStart: offset, nextTokenEnd: offset, previousTokenStart: undefined, previousTokenEnd: undefined };
        }
        let previousToken: { startOffset: number; endOffset?: number } | undefined;
        for (const token of tokens) {
            if (token.startOffset >= offset) {
                return {
                    nextTokenStart: offset,
                    nextTokenEnd: offset,
                    previousTokenStart: previousToken ? previousToken.startOffset : undefined,
                    previousTokenEnd: previousToken ? previousToken.endOffset! + 1 : undefined
                };
            }
            if (token.endOffset! >= offset) {
                return {
                    nextTokenStart: token.startOffset,
                    nextTokenEnd: token.endOffset! + 1,
                    previousTokenStart: previousToken ? previousToken.startOffset : undefined,
                    previousTokenEnd: previousToken ? previousToken.endOffset! + 1 : undefined
                };
            }
            previousToken = token;
        }
        return {
            nextTokenStart: offset,
            nextTokenEnd: offset,
            previousTokenStart: previousToken ? previousToken.startOffset : undefined,
            previousTokenEnd: previousToken ? previousToken.endOffset! + 1 : undefined
        };
    }

    protected findDataTypeRuleStart(rootSyntaxNode: SyntaxNode, offset: number, grammarRegistry: CompletionRequest['grammarRegistry']): [number, number] | undefined {
        const leaf = SyntaxNodeUtils.findLeafSyntaxNodeAtOffset(rootSyntaxNode, offset)
            ?? SyntaxNodeUtils.findLeafSyntaxNodeBeforeOffset(rootSyntaxNode, offset);
        if (!leaf) {
            return undefined;
        }
        const dtNode = SyntaxNodeUtils.getDatatypeSyntaxNode(leaf, grammarRegistry);
        if (dtNode) {
            return [dtNode.offset, dtNode.end];
        }
        return undefined;
    }

    protected performNextTokenCompletion(tokenText: string, _grammarConfig: GrammarConfig): boolean {
        return /\P{L}$/u.test(tokenText);
    }

    protected buildSyntheticEntryRuleCall(rule: GrammarAST.ParserRule): NextFeature {
        const start: GrammarAST.Group = {
            $type: 'Group',
            $container: undefined!,
            elements: []
        };
        const startNext: NextFeature<GrammarAST.Group> = {
            feature: start
        };
        const ruleCall: GrammarAST.RuleCall = {
            $type: 'RuleCall',
            $container: undefined!,
            rule: {
                ref: rule,
                $refText: rule.name
            },
            arguments: []
        };
        const group: GrammarAST.Group = {
            $type: 'Group',
            $container: undefined!,
            elements: [
                start,
                ruleCall
            ]
        };
        (start as Mutable<AstNode>).$container = group;
        (ruleCall as Mutable<AstNode>).$container = group;
        return startNext;
    }

    /**
     * Convert `NextFeature[]` to `CompletionFeature[]`.
     */
    protected convertFeatures(nextFeatures: NextFeature[]): CompletionFeature[] {
        const result: CompletionFeature[] = [];
        for (const next of nextFeatures) {
            if (GrammarAST.isKeyword(next.feature)) {
                result.push({
                    kind: 'keyword',
                    value: next.feature.value,
                    grammarElement: next.feature,
                    type: next.type,
                    property: next.property
                });
            } else if (GrammarAST.isCrossReference(next.feature)) {
                const assignment = AstUtils.getContainerOfType(next.feature, GrammarAST.isAssignment);
                result.push({
                    kind: 'crossReference',
                    value: '',
                    grammarElement: next.feature,
                    assignment: assignment ?? undefined,
                    type: next.type,
                    property: next.property
                });
            } else if (GrammarAST.isRuleCall(next.feature)) {
                // Terminal rule calls inside assignments are emitted so that
                // language-specific completion providers can handle them
                // (e.g. path import completion for `path=STRING`).
                const rule = next.feature.rule.ref;
                if (rule && GrammarAST.isTerminalRule(rule)) {
                    const assignment = AstUtils.getContainerOfType(next.feature, GrammarAST.isAssignment);
                    if (assignment) {
                        result.push({
                            kind: 'terminal',
                            value: '',
                            grammarElement: next.feature,
                            assignment,
                            type: next.type,
                            property: next.property
                        });
                    }
                }
            }
        }
        return result;
    }
}
