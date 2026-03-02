/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { CompletionRequest, CompletionResult, CompletionFeature, SyntaxNode, GrammarRegistry } from 'langium-core';
import { GrammarAST, GrammarUtils, SyntaxNodeUtils } from 'langium-core';

/**
 * Regex matching identifier-like keywords (e.g., "select", "from").
 * Non-identifier keywords (e.g., "(", ")", "*", ";") are anonymous inline
 * tokens in Lezer and don't appear as tree nodes.
 */
const IDENTIFIER_KEYWORD_RE = /^[_a-zA-Z]\w*$/;

/**
 * Lezer-specific completion logic.
 * Walks the Lezer parse tree to determine where the cursor is in the grammar,
 * then uses GrammarRegistry to compute what grammar features are expected next.
 *
 * This replaces the Chevrotain-oriented token-replay approach with a direct
 * tree-walking approach that leverages Lezer's error recovery: Lezer always
 * produces a complete tree, inserting error nodes where input doesn't match.
 *
 * Key design considerations for the Lezer tree:
 * - Identifier-like keywords (e.g., "select") are named nodes via @specialize.
 * - Non-identifier keywords (e.g., "(", ")") are anonymous inline tokens that
 *   don't appear in the tree. The walk must skip over them.
 * - Each assignment in the grammar produces a wrapper nonterminal in the Lezer
 *   tree (e.g., `star?='*'` → `SelectItemStar`). The walk matches these by
 *   reconstructing the expected wrapper name from the rule and field names.
 *
 * Used internally by `LezerAdapter.getCompletionFeatures()`.
 */
export class LezerCompletion {

    /**
     * The name of the parser rule currently being walked.
     * Set at the start of `getExpectedFeatures()` and used by `walkAssignment()`
     * to compute wrapper nonterminal names for matching.
     */
    private _currentRuleName = '';

    getCompletionFeatures(request: CompletionRequest): CompletionResult[] {
        const { rootSyntaxNode, text, offset, grammar, grammarRegistry } = request;
        const results: CompletionResult[] = [];

        // Extract partial text for filtering
        const partialText = this.getPartialToken(text, offset);
        const tokenOffset = offset - partialText.length;

        // Find the context AST node for scope resolution
        const leaf = SyntaxNodeUtils.findLeafSyntaxNodeBeforeOffset(rootSyntaxNode, offset)
            ?? SyntaxNodeUtils.findLeafSyntaxNodeAtOffset(rootSyntaxNode, offset);
        const contextNode = leaf ? SyntaxNodeUtils.findAstNodeForSyntaxNode(leaf) : undefined;

        // Find the rule node to use for completion.
        // Strategy: find the deepest node at cursor, walk up to a rule node.
        // If we end up at root, check if root itself is a known rule (Lezer may inline entry rules).
        const nodeAtCursor = this.findDeepestNode(rootSyntaxNode, offset);
        const ruleNode = this.findRuleNodeForCompletion(nodeAtCursor, rootSyntaxNode, grammarRegistry);

        if (ruleNode) {
            const rule = grammarRegistry.getRuleByName(ruleNode.type);
            if (rule && GrammarAST.isParserRule(rule)) {
                const features = this.getExpectedFeatures(ruleNode, rule.definition, offset, grammarRegistry);
                results.push({
                    features,
                    contextNode,
                    tokenOffset,
                    tokenEndOffset: offset,
                    offset
                });
                return results;
            }
        }

        // Fallback: at the top level or empty document — offer entry rule's first features
        const entryRule = GrammarUtils.getEntryRule(grammar);
        if (entryRule) {
            const features = this.getFirstFeatures(entryRule.definition, grammarRegistry);
            results.push({
                features,
                contextNode,
                tokenOffset,
                tokenEndOffset: offset,
                offset
            });
        }
        return results;
    }

    /**
     * Find the deepest (most specific) node at the given offset.
     */
    protected findDeepestNode(root: SyntaxNode, offset: number): SyntaxNode {
        let node = root;
        let found = true;
        while (found) {
            found = false;
            for (const child of node.children) {
                if (child.offset <= offset && child.end >= offset) {
                    node = child;
                    found = true;
                    break;
                }
            }
        }
        return node;
    }

    /**
     * Find the rule node to use for completion.
     * Walks up from the node at cursor past error/leaf nodes.
     * If we reach the root, checks whether the root itself is a known grammar rule
     * (Lezer may inline delegation rules like `Statement: CreateTableStmt`).
     */
    protected findRuleNodeForCompletion(
        node: SyntaxNode,
        root: SyntaxNode,
        grammarRegistry: GrammarRegistry
    ): SyntaxNode | null {
        let current: SyntaxNode | null = node;
        while (current) {
            if (!current.isError && !current.isLeaf && current.type !== '') {
                // Check if this is a known grammar rule
                const rule = grammarRegistry.getRuleByName(current.type);
                if (rule && GrammarAST.isParserRule(rule)) {
                    return current;
                }
            }
            if (current === root) {
                break;
            }
            current = current.parent;
        }
        return null;
    }

    /**
     * Determine what grammar features are expected next at the given offset
     * within a rule node, based on which children have already been matched.
     */
    protected getExpectedFeatures(
        ruleNode: SyntaxNode,
        definition: GrammarAST.AbstractElement,
        offset: number,
        grammarRegistry: GrammarRegistry
    ): CompletionFeature[] {
        // Store the current rule name for wrapper matching in walkAssignment
        this._currentRuleName = ruleNode.type;

        // Collect successfully matched children strictly before the cursor.
        // Use strict `<` so that a token ending exactly at the cursor position
        // is NOT considered consumed — the user may be typing a partial token
        // (e.g., "insert into u|" where "u" is a partial cross-reference target).
        // This ensures the walker offers completion for the token at the cursor.
        const matchedTypes: string[] = [];
        for (const child of ruleNode.children) {
            if (child.end < offset && !child.isError) {
                if (child.isKeyword) {
                    matchedTypes.push(child.text);
                } else if (child.type) {
                    matchedTypes.push(child.type);
                }
            }
        }

        // Walk the grammar definition to find what should come next
        return this.walkDefinition(definition, matchedTypes, 0, grammarRegistry).features;
    }

    /**
     * Walk a grammar definition to compute expected features given matched children.
     * Returns the expected features and how many matched children were consumed.
     *
     * Handles element repetition (cardinality * or +): when all contents of a
     * repeating element are consumed, loops back to try matching again.
     */
    protected walkDefinition(
        element: GrammarAST.AbstractElement,
        matchedTypes: string[],
        matchIndex: number,
        grammarRegistry: GrammarRegistry
    ): { features: CompletionFeature[]; consumed: number } {
        // Walk the element once
        let result = this.walkElementOnce(element, matchedTypes, matchIndex, grammarRegistry);

        // Handle repetition: if element has * or + cardinality
        if (this.isRepeating(element) && result.consumed > 0) {
            let totalConsumed = result.consumed;

            // Keep consuming iterations while there are matches and no completion features
            while (result.features.length === 0 && result.consumed > 0) {
                result = this.walkElementOnce(element, matchedTypes, matchIndex + totalConsumed, grammarRegistry);
                totalConsumed += result.consumed;
            }

            if (result.features.length > 0) {
                // Found features in a subsequent iteration
                return { features: result.features, consumed: totalConsumed };
            }

            // All matches consumed — offer first features of this element (it can repeat)
            const firstFeatures = this.getFirstFeatures(element, grammarRegistry);
            return { features: firstFeatures, consumed: totalConsumed };
        }

        return result;
    }

    /**
     * Walk a grammar element once (without repetition handling).
     */
    protected walkElementOnce(
        element: GrammarAST.AbstractElement,
        matchedTypes: string[],
        matchIndex: number,
        grammarRegistry: GrammarRegistry
    ): { features: CompletionFeature[]; consumed: number } {
        if (GrammarAST.isGroup(element)) {
            return this.walkGroup(element, matchedTypes, matchIndex, grammarRegistry);
        } else if (GrammarAST.isAlternatives(element) || GrammarAST.isUnorderedGroup(element)) {
            return this.walkAlternatives(element, matchedTypes, matchIndex, grammarRegistry);
        } else if (GrammarAST.isAssignment(element)) {
            return this.walkAssignment(element, matchedTypes, matchIndex, grammarRegistry);
        } else if (GrammarAST.isRuleCall(element)) {
            return this.walkRuleCall(element, matchedTypes, matchIndex, grammarRegistry);
        } else if (GrammarAST.isKeyword(element)) {
            return this.walkKeyword(element, matchedTypes, matchIndex);
        } else if (GrammarAST.isAction(element)) {
            // Actions don't consume tokens — skip them
            return { features: [], consumed: 0 };
        } else {
            return { features: [], consumed: 0 };
        }
    }

    protected walkGroup(
        group: GrammarAST.Group,
        matchedTypes: string[],
        matchIndex: number,
        grammarRegistry: GrammarRegistry
    ): { features: CompletionFeature[]; consumed: number } {
        let currentIndex = matchIndex;

        for (const elem of group.elements) {
            const result = this.walkDefinition(elem, matchedTypes, currentIndex, grammarRegistry);
            currentIndex += result.consumed;

            if (result.features.length > 0) {
                // This element has unmatched features — these are our completions
                // But also check if this element can be empty (optional, or rule with optional content)
                // and collect features from following elements
                const features = [...result.features];
                if (this.canBeEmpty(elem)) {
                    // Also offer features from the next elements in the group
                    const remaining = this.collectFeaturesFromIndex(group, group.elements.indexOf(elem) + 1, grammarRegistry);
                    features.push(...remaining);
                }
                return { features, consumed: currentIndex - matchIndex };
            }
        }

        // All elements matched — nothing to complete in this group
        return { features: [], consumed: currentIndex - matchIndex };
    }

    protected walkAlternatives(
        alternatives: GrammarAST.Alternatives | GrammarAST.UnorderedGroup,
        matchedTypes: string[],
        matchIndex: number,
        grammarRegistry: GrammarRegistry
    ): { features: CompletionFeature[]; consumed: number } {
        // If nothing has been matched yet at this position, offer first features of all alternatives
        if (matchIndex >= matchedTypes.length) {
            const allFeatures: CompletionFeature[] = [];
            for (const alt of alternatives.elements) {
                const first = this.getFirstFeatures(alt, grammarRegistry);
                allFeatures.push(...first);
            }
            return { features: allFeatures, consumed: 0 };
        }

        // Try to match each alternative — prioritize alternatives that consume tokens
        for (const alt of alternatives.elements) {
            const result = this.walkDefinition(alt, matchedTypes, matchIndex, grammarRegistry);
            if (result.consumed > 0) {
                // This alternative actually matched and consumed tokens
                return result;
            }
        }

        // No alternative consumed tokens — offer first features of all alternatives
        const allFeatures: CompletionFeature[] = [];
        for (const alt of alternatives.elements) {
            const first = this.getFirstFeatures(alt, grammarRegistry);
            allFeatures.push(...first);
        }
        return { features: allFeatures, consumed: 0 };
    }

    protected walkAssignment(
        assignment: GrammarAST.Assignment,
        matchedTypes: string[],
        matchIndex: number,
        grammarRegistry: GrammarRegistry
    ): { features: CompletionFeature[]; consumed: number } {
        // Check for Lezer wrapper nonterminal match.
        // The Lezer grammar translator creates a wrapper nonterminal for each assignment,
        // named "${RuleName}${capitalize(fieldName)}" (e.g., SelectItemStar for star?='*').
        // These wrappers appear in the tree as direct children, and we need to recognize
        // them to correctly advance past consumed assignments.
        if (matchIndex < matchedTypes.length) {
            const wrapperName = this._currentRuleName + capitalize(assignment.feature);
            if (matchedTypes[matchIndex] === wrapperName) {
                return { features: [], consumed: 1 };
            }
        }

        const terminal = assignment.terminal;

        if (GrammarAST.isCrossReference(terminal)) {
            // Cross-reference: check if already matched
            if (matchIndex < matchedTypes.length) {
                // Something matched at this position — consumed
                return { features: [], consumed: 1 };
            }
            // Not matched — offer cross-reference completion
            return {
                features: [{
                    kind: 'crossReference',
                    value: '',
                    grammarElement: terminal,
                    assignment,
                    property: assignment.feature
                }],
                consumed: 0
            };
        }

        // Delegate to the terminal element
        return this.walkDefinition(terminal, matchedTypes, matchIndex, grammarRegistry);
    }

    protected walkRuleCall(
        ruleCall: GrammarAST.RuleCall,
        matchedTypes: string[],
        matchIndex: number,
        grammarRegistry: GrammarRegistry
    ): { features: CompletionFeature[]; consumed: number } {
        const rule = ruleCall.rule.ref;
        if (!rule) {
            return { features: [], consumed: 0 };
        }

        if (GrammarAST.isParserRule(rule)) {
            // Check if the matched type at this position corresponds to this rule
            if (matchIndex < matchedTypes.length) {
                const matchedType = matchedTypes[matchIndex];
                // The matched child might be of the rule's type or a subtype
                const ruleType = GrammarUtils.getExplicitRuleType(rule) ?? rule.name;
                if (matchedType === ruleType || matchedType === rule.name) {
                    return { features: [], consumed: 1 };
                }
            }
            // Not matched — offer the rule's first features
            const features = this.getFirstFeatures(rule.definition, grammarRegistry);
            return { features, consumed: 0 };
        } else if (GrammarAST.isTerminalRule(rule)) {
            // Terminal rules (ID, STRING, etc.) — check if matched.
            // Note: Lezer translates terminal names (e.g. ID → Identifier),
            // so we can't rely on exact name match alone.
            if (matchIndex < matchedTypes.length) {
                const matchedType = matchedTypes[matchIndex];
                if (matchedType === rule.name) {
                    return { features: [], consumed: 1 };
                }
                // If the matched type is not a known parser rule, it's likely
                // a terminal token (with a Lezer-translated name) — consume it.
                const knownRule = grammarRegistry.getRuleByName(matchedType);
                if (!knownRule) {
                    return { features: [], consumed: 1 };
                }
            }
            // Can't offer completions for terminal rules from framework level
            return { features: [], consumed: 0 };
        }

        return { features: [], consumed: 0 };
    }

    protected walkKeyword(
        keyword: GrammarAST.Keyword,
        matchedTypes: string[],
        matchIndex: number
    ): { features: CompletionFeature[]; consumed: number } {
        // Non-identifier keywords (operators, punctuation like "(", ")", ";", "*")
        // don't appear as nodes in the Lezer tree — they are anonymous inline tokens.
        // Skip them in the grammar walk so subsequent elements can be matched.
        if (!IDENTIFIER_KEYWORD_RE.test(keyword.value)) {
            return { features: [], consumed: 0 };
        }

        if (matchIndex < matchedTypes.length) {
            const matchedType = matchedTypes[matchIndex];
            if (matchedType === keyword.value) {
                return { features: [], consumed: 1 };
            }
        }
        // Keyword not yet matched — offer it as completion
        return {
            features: [{
                kind: 'keyword',
                value: keyword.value,
                grammarElement: keyword
            }],
            consumed: 0
        };
    }

    /**
     * Collect first features from a group starting at a given element index.
     * Used when an element is optional and we need features from following elements too.
     */
    protected collectFeaturesFromIndex(
        group: GrammarAST.Group,
        startIndex: number,
        grammarRegistry: GrammarRegistry
    ): CompletionFeature[] {
        const features: CompletionFeature[] = [];
        for (let i = startIndex; i < group.elements.length; i++) {
            const elem = group.elements[i];
            const first = this.getFirstFeatures(elem, grammarRegistry);
            features.push(...first);
            if (!this.isOptional(elem)) {
                break; // Stop at first required element
            }
        }
        return features;
    }

    /**
     * Get the first completable features of a grammar element.
     * Recurses into groups, alternatives, assignments, and rule calls.
     */
    protected getFirstFeatures(
        element: GrammarAST.AbstractElement,
        grammarRegistry: GrammarRegistry,
        visited: Set<string> = new Set()
    ): CompletionFeature[] {
        if (GrammarAST.isKeyword(element)) {
            return [{
                kind: 'keyword',
                value: element.value,
                grammarElement: element
            }];
        } else if (GrammarAST.isGroup(element)) {
            const features: CompletionFeature[] = [];
            for (const elem of element.elements) {
                features.push(...this.getFirstFeatures(elem, grammarRegistry, visited));
                if (!this.isOptional(elem)) {
                    break;
                }
            }
            return features;
        } else if (GrammarAST.isAlternatives(element) || GrammarAST.isUnorderedGroup(element)) {
            return element.elements.flatMap(e => this.getFirstFeatures(e, grammarRegistry, visited));
        } else if (GrammarAST.isAssignment(element)) {
            const terminal = element.terminal;
            if (GrammarAST.isCrossReference(terminal)) {
                return [{
                    kind: 'crossReference',
                    value: '',
                    grammarElement: terminal,
                    assignment: element,
                    property: element.feature
                }];
            }
            return this.getFirstFeatures(terminal, grammarRegistry, visited);
        } else if (GrammarAST.isRuleCall(element)) {
            const rule = element.rule.ref;
            if (GrammarAST.isParserRule(rule)) {
                // Guard against infinite recursion
                if (visited.has(rule.name)) {
                    return [];
                }
                visited.add(rule.name);
                return this.getFirstFeatures(rule.definition, grammarRegistry, visited);
            }
            // Terminal rules — can't suggest content
            return [];
        } else if (GrammarAST.isAction(element)) {
            // Actions don't produce completable features
            return [];
        }
        return [];
    }

    /**
     * Extract partial token text at the cursor by walking backward.
     */
    protected getPartialToken(text: string, offset: number): string {
        let start = offset;
        while (start > 0 && /[\w]/.test(text[start - 1])) {
            start--;
        }
        return text.slice(start, offset);
    }

    /**
     * Check if a grammar element is optional (cardinality ? or *).
     */
    protected isOptional(element: GrammarAST.AbstractElement): boolean {
        return GrammarUtils.isOptionalCardinality(element.cardinality, element);
    }

    /**
     * Check if a grammar element can produce empty (nothing mandatory).
     * Unlike `isOptional`, this recurses into rule calls and groups to detect
     * cases like fragments whose entire content is optional.
     */
    protected canBeEmpty(element: GrammarAST.AbstractElement): boolean {
        if (this.isOptional(element)) return true;
        if (GrammarAST.isRuleCall(element)) {
            const rule = element.rule.ref;
            if (GrammarAST.isParserRule(rule)) {
                return this.canBeEmpty(rule.definition);
            }
            return false;
        }
        if (GrammarAST.isGroup(element)) {
            return element.elements.every(e => this.canBeEmpty(e));
        }
        if (GrammarAST.isAlternatives(element) || GrammarAST.isUnorderedGroup(element)) {
            return element.elements.some(e => this.canBeEmpty(e));
        }
        if (GrammarAST.isAction(element)) return true;
        if (GrammarAST.isAssignment(element)) {
            return this.canBeEmpty(element.terminal);
        }
        return false;
    }

    /**
     * Check if a grammar element repeats (cardinality * or +).
     */
    protected isRepeating(element: GrammarAST.AbstractElement): boolean {
        return element.cardinality === '*' || element.cardinality === '+';
    }
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
