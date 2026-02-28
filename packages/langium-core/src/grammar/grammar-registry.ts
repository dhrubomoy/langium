/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { LangiumCoreServices } from '../services.js';
import type { AbstractElement, AbstractRule, Assignment, Grammar, Keyword } from '../languages/generated/ast.js';
import { isCrossReference, isAssignment, isKeyword, isParserRule, isRuleCall, isTerminalRule } from '../languages/generated/ast.js';
import { streamAllContents } from '../utils/ast-utils.js';
import { isDataTypeRule } from '../utils/grammar-utils.js';

/**
 * Enriched assignment metadata for the AST builder.
 * Provides all information needed to map a SyntaxNode child to an AST property.
 */
export interface AssignmentInfo {
    /** The property/feature name (e.g., "name", "items"). */
    property: string;
    /** The assignment operator. */
    operator: '=' | '?=' | '+=';
    /** Whether this assignment is a cross-reference. */
    isCrossReference: boolean;
    /** Whether this is a multi-reference (CrossReference.isMulti). */
    isMultiReference: boolean;
    /** Terminal rule name for value conversion (e.g., "ID", "STRING", "INT"). */
    terminalRuleName?: string;
    /** The original grammar Assignment AST node. */
    assignment: Assignment;
}

/**
 * Provides grammar introspection by node type name.
 * Replaces the `grammarSource` back-pointer on CstNode by offering
 * O(1) lookups into the Grammar AST, indexed at startup.
 */
export interface GrammarRegistry {
    /** Get the grammar rule that produces nodes of this type. */
    getRuleByName(name: string): AbstractRule | undefined;

    /** Check if a string value is a keyword in the grammar. */
    isKeyword(value: string): boolean;

    /** Get all alternatives for a given parser rule. */
    getAlternatives(ruleName: string): AbstractElement[];

    /**
     * Get the assignment for a property within a parser rule.
     * @param ruleName The name of the parser rule containing the assignment.
     * @param property The property/feature name (e.g., "name", "items").
     */
    getAssignmentByProperty(ruleName: string, property: string): Assignment | undefined;

    /**
     * Get all assignments within a parser rule.
     * @param ruleName The name of the parser rule.
     */
    getAssignments(ruleName: string): Assignment[];

    /**
     * Get all grammar Keyword AST nodes that have the given keyword value.
     * Useful for looking up JSDoc comments attached to keyword definitions.
     */
    getKeywordElements(value: string): Keyword[];

    /**
     * Get enriched assignment info for all assignments within a parser rule.
     * Includes cross-reference detection, operator, and terminal rule name.
     * Used by the SyntaxNodeAstBuilder.
     */
    getAssignmentInfos(ruleName: string): AssignmentInfo[];

    /**
     * Check if a parser rule is a data type rule (returns a primitive value like string, number).
     */
    isDataTypeRule(ruleName: string): boolean;
}

/**
 * Default implementation of {@link GrammarRegistry}.
 * Built from the Grammar AST at language service initialization time.
 */
export class DefaultGrammarRegistry implements GrammarRegistry {

    /** Rule name → AbstractRule */
    private readonly ruleMap = new Map<string, AbstractRule>();

    /** Set of all keyword values in the grammar */
    private readonly keywordSet = new Set<string>();

    /** Rule name → list of top-level alternative elements */
    private readonly alternativesMap = new Map<string, AbstractElement[]>();

    /** "ruleName:propertyName" → Assignment */
    private readonly assignmentMap = new Map<string, Assignment>();

    /** Rule name → all Assignments in that rule */
    private readonly ruleAssignments = new Map<string, Assignment[]>();

    /** Keyword value → all Keyword grammar nodes with that value */
    private readonly keywordElements = new Map<string, Keyword[]>();

    /** Rule name → enriched AssignmentInfo[] */
    private readonly ruleAssignmentInfos = new Map<string, AssignmentInfo[]>();

    /** Set of data type rule names */
    private readonly dataTypeRules = new Set<string>();

    constructor(services: LangiumCoreServices) {
        this.indexGrammar(services.Grammar);
    }

    private indexGrammar(grammar: Grammar): void {
        for (const rule of grammar.rules) {
            this.ruleMap.set(rule.name, rule);

            if (isParserRule(rule)) {
                // Index the top-level definition as the alternatives list
                this.alternativesMap.set(rule.name, [rule.definition]);

                // Track data type rules
                if (isDataTypeRule(rule)) {
                    this.dataTypeRules.add(rule.name);
                }

                // Walk the rule's definition to find all assignments and keywords.
                // Note: streamAllContents does NOT include the root node itself,
                // so we must also check rule.definition directly. This matters when
                // a rule has only a single element (e.g., `Model: entities+=Entity*;`)
                // where the definition IS the Assignment node.
                const assignments: Assignment[] = [];
                const assignmentInfos: AssignmentInfo[] = [];
                const processNode = (node: AbstractElement): void => {
                    if (isAssignment(node)) {
                        assignments.push(node);
                        const key = `${rule.name}:${node.feature}`;
                        // Store the first assignment for each property
                        if (!this.assignmentMap.has(key)) {
                            this.assignmentMap.set(key, node);
                        }
                        // Build enriched AssignmentInfo
                        assignmentInfos.push(this.buildAssignmentInfo(node));
                    } else if (isKeyword(node)) {
                        this.keywordSet.add(node.value);
                        let elements = this.keywordElements.get(node.value);
                        if (!elements) {
                            elements = [];
                            this.keywordElements.set(node.value, elements);
                        }
                        elements.push(node);
                    }
                };
                // Check the definition node itself
                processNode(rule.definition);
                // Then walk all descendants
                for (const node of streamAllContents(rule.definition)) {
                    processNode(node as AbstractElement);
                }
                this.ruleAssignments.set(rule.name, assignments);
                this.ruleAssignmentInfos.set(rule.name, assignmentInfos);
            } else if (isTerminalRule(rule)) {
                // Terminal rules don't have assignments or keywords to index
            }
        }
    }

    getRuleByName(name: string): AbstractRule | undefined {
        return this.ruleMap.get(name);
    }

    isKeyword(value: string): boolean {
        return this.keywordSet.has(value);
    }

    getAlternatives(ruleName: string): AbstractElement[] {
        return this.alternativesMap.get(ruleName) ?? [];
    }

    getAssignmentByProperty(ruleName: string, property: string): Assignment | undefined {
        return this.assignmentMap.get(`${ruleName}:${property}`);
    }

    getAssignments(ruleName: string): Assignment[] {
        return this.ruleAssignments.get(ruleName) ?? [];
    }

    getKeywordElements(value: string): Keyword[] {
        return this.keywordElements.get(value) ?? [];
    }

    getAssignmentInfos(ruleName: string): AssignmentInfo[] {
        return this.ruleAssignmentInfos.get(ruleName) ?? [];
    }

    isDataTypeRule(ruleName: string): boolean {
        return this.dataTypeRules.has(ruleName);
    }

    private buildAssignmentInfo(assignment: Assignment): AssignmentInfo {
        const terminal = assignment.terminal;
        let terminalRuleName: string | undefined;
        let crossRef = false;
        let isMulti = false;

        if (isCrossReference(terminal)) {
            crossRef = true;
            isMulti = terminal.isMulti;
        } else {
            // Find the terminal rule name for value conversion
            if (isRuleCall(terminal) && terminal.rule.ref) {
                terminalRuleName = terminal.rule.ref.name;
            }
        }

        return {
            property: assignment.feature,
            operator: assignment.operator,
            isCrossReference: crossRef,
            isMultiReference: isMulti,
            terminalRuleName,
            assignment
        };
    }
}
