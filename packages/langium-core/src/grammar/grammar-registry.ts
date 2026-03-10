/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { LangiumCoreServices } from '../services.js';
import type { AbstractElement, AbstractRule, Action, Assignment, Grammar, Keyword } from '../languages/generated/ast.js';
import { isAction, isAlternatives, isCrossReference, isAssignment, isGroup, isInfixRule, isKeyword, isParserRule, isRuleCall, isTerminalRule } from '../languages/generated/ast.js';
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
 * Metadata for a type-only `{infer X}` action within a parser rule.
 * Used to determine the correct `$type` based on which fields are populated.
 */
export interface InferActionInfo {
    /** The inferred type name (e.g., "FunctionCall", "ColumnNameExpression"). */
    typeName: string;
    /** Fields that must be present to match this inferred type. */
    requiredFields: string[];
}

/**
 * Metadata for a chaining `{infer X.prop=current}` action within a parser rule.
 * Used to reconstruct nested node chains from flat Lezer trees.
 */
export interface ChainingActionInfo {
    /** The type name of the chained node (e.g., "GlobalReference", "BinaryTableExpression"). */
    typeName: string;
    /** The property that links to the previous node (e.g., "previous", "left"). */
    chainProperty: string;
    /** Fields assigned within the chaining group (e.g., "operator", "right"). */
    assignedFields: string[];
}

/**
 * Metadata for an `infix` rule.
 * Used to build binary expression nodes from flat Lezer infix trees.
 */
export interface InfixRuleInfo {
    /** The rule name (also the Lezer node type). */
    ruleName: string;
    /** The operand rule name (e.g., "PrimaryExpression"). */
    operandRuleName: string;
    /** The $type to use for binary expression nodes. */
    binaryTypeName: string;
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

    /**
     * Get type-only `{infer X}` actions for a parser rule.
     * Returns infer action metadata used to determine the correct `$type`
     * based on which fields are populated in the built AST node.
     */
    getInferActions(ruleName: string): InferActionInfo[];

    /**
     * Get chaining `{infer X.prop=current}` actions for a parser rule.
     * Returns metadata about left-recursive chaining patterns that need
     * flat-to-nested restructuring in the Lezer backend.
     */
    getChainingActions(ruleName: string): ChainingActionInfo[];

    /**
     * Get infix rule metadata if the given rule name corresponds to an infix rule.
     * Returns undefined if the rule is not an infix rule.
     */
    getInfixRuleInfo(ruleName: string): InfixRuleInfo | undefined;
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

    /** Rule name → type-only infer actions */
    private readonly inferActionsMap = new Map<string, InferActionInfo[]>();

    /** Rule name → chaining actions */
    private readonly chainingActionsMap = new Map<string, ChainingActionInfo[]>();

    /** Rule name → infix rule info */
    private readonly infixRuleMap = new Map<string, InfixRuleInfo>();

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
                // Index {infer} actions (type-only and chaining)
                this.indexActions(rule.name, rule.definition);
            } else if (isTerminalRule(rule)) {
                // Terminal rules don't have assignments or keywords to index
            } else if (isInfixRule(rule)) {
                // Index infix rules for binary expression building
                const operandName = rule.call.rule.ref?.name ?? '';
                const binaryType = rule.inferredType?.name ?? rule.returnType?.ref?.name ?? rule.name;
                this.infixRuleMap.set(rule.name, {
                    ruleName: rule.name,
                    operandRuleName: operandName,
                    binaryTypeName: binaryType
                });
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

    getInferActions(ruleName: string): InferActionInfo[] {
        return this.inferActionsMap.get(ruleName) ?? [];
    }

    getChainingActions(ruleName: string): ChainingActionInfo[] {
        return this.chainingActionsMap.get(ruleName) ?? [];
    }

    getInfixRuleInfo(ruleName: string): InfixRuleInfo | undefined {
        return this.infixRuleMap.get(ruleName);
    }

    /**
     * Walk a parser rule's definition tree to find and index `{infer}` actions.
     * Classifies actions into type-only (no feature) and chaining (with feature).
     */
    private indexActions(ruleName: string, definition: AbstractElement): void {
        const inferActions: InferActionInfo[] = [];
        const chainingActions: ChainingActionInfo[] = [];

        // Get the top-level alternatives of the rule
        const branches = isAlternatives(definition) ? definition.elements : [definition];

        for (const branch of branches) {
            this.collectActionsFromBranch(branch, inferActions, chainingActions);
        }

        if (inferActions.length > 0) {
            this.inferActionsMap.set(ruleName, inferActions);
        }
        if (chainingActions.length > 0) {
            this.chainingActionsMap.set(ruleName, chainingActions);
        }
    }

    /**
     * Analyze a single alternative branch for `{infer}` actions.
     * Recursively walks into nested groups (e.g., repetition groups) to find actions.
     */
    private collectActionsFromBranch(
        branch: AbstractElement,
        inferActions: InferActionInfo[],
        chainingActions: ChainingActionInfo[]
    ): void {
        // Walk the entire branch to find all actions
        const allNodes: AbstractElement[] = [branch];
        for (const node of streamAllContents(branch)) {
            allNodes.push(node as AbstractElement);
        }

        for (const element of allNodes) {
            if (isAction(element) && element.inferredType?.name) {
                // Collect assigned fields from the action's parent group
                const parentGroup = element.$container;
                const siblings = isGroup(parentGroup) ? parentGroup.elements : [element];

                if (element.feature) {
                    // Chaining action: {infer Type.prop=current}
                    const assignedFields = this.collectFieldsFromElements(siblings, element);
                    chainingActions.push({
                        typeName: element.inferredType.name,
                        chainProperty: element.feature,
                        assignedFields
                    });
                } else {
                    // Type-only action: {infer Type}
                    const requiredFields = this.collectFieldsFromElements(siblings, element);
                    inferActions.push({
                        typeName: element.inferredType.name,
                        requiredFields
                    });
                }
            }
        }
    }

    /**
     * Collect assignment field names from a list of elements (siblings of an action).
     */
    private collectFieldsFromElements(elements: readonly AbstractElement[], _action: Action): string[] {
        const fields: string[] = [];
        for (const el of elements) {
            this.collectFieldsRecursive(el, fields);
        }
        return fields;
    }

    /**
     * Recursively collect assignment field names from an element and its descendants.
     * Only collects fields that are required (not inside optional `?` or `*` containers).
     */
    private collectFieldsRecursive(element: AbstractElement, fields: string[]): void {
        if (isAssignment(element)) {
            // Only include if not optional at this level
            if (!element.cardinality || element.cardinality === '+') {
                fields.push(element.feature);
            }
        } else if (isAction(element)) {
            // Skip actions themselves
        } else if (element.cardinality === '?' || element.cardinality === '*') {
            // Skip entire optional/starred groups — their fields are not required
        } else {
            // Walk children (Group, Alternatives, etc.)
            // But respect cardinality of intermediate containers
            if (isGroup(element)) {
                for (const child of element.elements) {
                    this.collectFieldsRecursive(child as AbstractElement, fields);
                }
            } else if (isAlternatives(element)) {
                // For alternatives, no single branch's fields are guaranteed
                // Skip — fields from alternatives are not required
            } else {
                for (const child of streamAllContents(element)) {
                    if (isAssignment(child)) {
                        // Check if this assignment is inside an optional container
                        if (!this.isInsideOptionalContainer(child, element)) {
                            fields.push(child.feature);
                        }
                    }
                }
            }
        }
    }

    /**
     * Check if an assignment is inside an optional (`?` or `*`) container
     * between itself and the given ancestor element.
     */
    private isInsideOptionalContainer(assignment: AbstractElement, ancestor: AbstractElement): boolean {
        let current = assignment.$container;
        while (current && current !== ancestor) {
            if ('cardinality' in current) {
                const cardinality = (current as AbstractElement).cardinality;
                if (cardinality === '?' || cardinality === '*') {
                    return true;
                }
            }
            current = current.$container;
        }
        return false;
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
