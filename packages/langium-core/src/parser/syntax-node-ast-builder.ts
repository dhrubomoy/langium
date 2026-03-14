/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { LangiumCoreServices } from '../services.js';
import type { AstNode, AstReflection, GenericAstNode, Mutable } from '../syntax-tree.js';
import type { Linker } from '../references/linker.js';
import type { GrammarRegistry, AssignmentInfo, InferActionInfo, ChainingActionInfo, InfixRuleInfo } from '../grammar/grammar-registry.js';
import type { ValueConverter } from './value-converter.js';
import type { RootSyntaxNode, SyntaxNode } from './syntax-node.js';
import type { ParseResult, ParseError, LexError } from './parse-result.js';
import { isAstNode } from '../syntax-tree.js';
import { assignMandatoryProperties, linkContentToContainer } from '../utils/ast-utils.js';

/**
 * Builds an AstNode tree from a SyntaxNode parse tree.
 * Used by non-Chevrotain backends (e.g., Lezer) where the parser produces
 * only a SyntaxNode tree and AST construction is a post-parse step.
 */
export interface SyntaxNodeAstBuilder {
    /**
     * Build an AST from a SyntaxNode parse tree.
     * @param root The root SyntaxNode from any parser backend.
     * @returns ParseResult with the root AstNode.
     */
    buildAst<T extends AstNode = AstNode>(root: RootSyntaxNode): ParseResult<T>;

    /**
     * Find the AstNode corresponding to a SyntaxNode.
     * Walks up the parent chain to find the nearest mapped AstNode.
     */
    findAstNode(node: SyntaxNode): AstNode | undefined;
}

export class DefaultSyntaxNodeAstBuilder implements SyntaxNodeAstBuilder {
    protected readonly grammarRegistry: GrammarRegistry;
    protected readonly linker: Linker;
    protected readonly valueConverter: ValueConverter;
    protected readonly reflection: AstReflection;

    /** Per-service-instance reverse mapping from SyntaxNode to AstNode. */
    protected readonly syntaxNodeToAstNode = new WeakMap<SyntaxNode, AstNode>();

    constructor(services: LangiumCoreServices) {
        this.grammarRegistry = services.grammar.GrammarRegistry;
        this.linker = services.references.Linker;
        this.valueConverter = services.parser.ValueConverter;
        this.reflection = services.shared.AstReflection;
    }

    buildAst<T extends AstNode = AstNode>(root: RootSyntaxNode): ParseResult<T> {
        const astRoot = this.buildNode(root) as T;
        if (isAstNode(astRoot)) {
            linkContentToContainer(astRoot, { deep: true });
        }
        return {
            value: astRoot,
            parserErrors: this.convertParserErrors(root),
            lexerErrors: this.convertLexerErrors(root)
        };
    }

    findAstNode(node: SyntaxNode): AstNode | undefined {
        let current: SyntaxNode | null = node;
        while (current) {
            const astNode = this.syntaxNodeToAstNode.get(current);
            if (astNode) {
                return astNode;
            }
            current = current.parent;
        }
        return undefined;
    }

    protected buildNode(syntaxNode: SyntaxNode): unknown {
        const ruleName = syntaxNode.type;

        // Data type rules return a primitive value, not an AstNode
        if (this.grammarRegistry.isDataTypeRule(ruleName)) {
            return this.buildDataTypeValue(syntaxNode);
        }

        // Handle infix rules: detect binary expressions (2 operand children)
        // and extract the operator from source text between them.
        const infixInfo = this.grammarRegistry.getInfixRuleInfo(ruleName);
        if (infixInfo) {
            // Avoid allocating a filtered array — collect up to 2 operand children inline
            let op1: SyntaxNode | undefined, op2: SyntaxNode | undefined;
            let opCount = 0;
            for (const c of syntaxNode.children) {
                if (!c.isHidden && !c.isError &&
                    (c.type === infixInfo.ruleName || c.type === infixInfo.operandRuleName)) {
                    if (opCount === 0) op1 = c;
                    else if (opCount === 1) op2 = c;
                    opCount++;
                    if (opCount > 2) break;
                }
            }
            if (opCount === 2 && op1 && op2) {
                return this.buildInfixExpression(syntaxNode, infixInfo, [op1, op2]);
            }
            // Single operand (pass-through) — fall through to normal build
        }

        // Handle chaining actions: {infer Type.prop=current} in repetitions.
        // Detects flat nodes with multiple field children that should be nested.
        const chainingActions = this.grammarRegistry.getChainingActions(ruleName);
        if (chainingActions.length > 0) {
            const result = this.tryBuildChainedNode(syntaxNode, chainingActions[0]);
            if (result !== undefined) {
                return result;
            }
            // No chaining needed — fall through to normal build
        }

        // Create the AstNode
        const node: GenericAstNode = { $type: ruleName } as GenericAstNode;

        // Process assignments from the grammar registry.
        // Deduplicate by property name: grammar rules like `items+=X (',' items+=X)*`
        // produce multiple AssignmentInfo entries for the same property. Since
        // childrenForField returns ALL matching children regardless, we must only
        // process each property once to avoid doubling array contents.
        const assignmentInfos = this.grammarRegistry.getAssignmentInfos(ruleName);
        const assignedFields = new Set<string>();

        for (const info of assignmentInfos) {
            if (assignedFields.has(info.property)) continue;
            assignedFields.add(info.property);
            this.processAssignment(node, syntaxNode, info);
        }

        // Handle unassigned composite children (type override / subrule without assignment)
        this.processUnassignedChildren(node, syntaxNode, assignedFields);

        // Set mandatory default values (empty arrays, default booleans, etc.)
        assignMandatoryProperties(this.reflection, node);

        // Apply type inference from {infer X} actions.
        // Match populated fields against infer action metadata to determine correct $type.
        const inferActions = this.grammarRegistry.getInferActions(ruleName);
        if (inferActions.length > 0) {
            this.applyTypeInference(node, inferActions);
        }

        // Associate SyntaxNode with AstNode (bidirectional).
        // If inlineChildNode already set $syntaxNode to the inlined child's SyntaxNode
        // (because $type changed from the original ruleName), don't overwrite it —
        // the inlined SyntaxNode is where the field children live.
        if ((node as Mutable<AstNode>).$type === ruleName) {
            this.defineSyntaxNodeProperty(node, syntaxNode);
        }
        this.syntaxNodeToAstNode.set(syntaxNode, node);
        // Store back-reference on SyntaxNode for findAstNodeForSyntaxNode()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (syntaxNode as any).$astNode = node;

        return node;
    }

    protected processAssignment(
        node: GenericAstNode,
        parentSN: SyntaxNode,
        info: AssignmentInfo
    ): void {
        const { property, operator } = info;

        if (operator === '+=') {
            // Array assignment: collect all children for this field
            const childNodes = parentSN.childrenForField(property);
            if (!Array.isArray(node[property])) {
                node[property] = [];
            }
            for (const childSN of childNodes) {
                const value = this.extractAssignmentValue(node, childSN, info);
                if (value !== undefined) {
                    (node[property] as unknown[]).push(value);
                }
            }
        } else if (operator === '?=') {
            // Boolean assignment: true if the field child exists
            const childSN = parentSN.childForField(property);
            node[property] = childSN !== undefined;
        } else {
            // Single assignment (=): get the first child for this field
            const childSN = parentSN.childForField(property);
            if (childSN) {
                node[property] = this.extractAssignmentValue(node, childSN, info);
            }
        }
    }

    protected extractAssignmentValue(
        node: GenericAstNode,
        childSN: SyntaxNode,
        info: AssignmentInfo
    ): unknown {
        // Unwrap Lezer field wrapper non-terminals (e.g., PersonName { Identifier })
        const unwrapped = this.unwrapFieldChild(childSN);

        if (info.isCrossReference) {
            // Cross-reference: build a Reference object
            const refText = this.getLeafText(unwrapped);
            if (info.isMultiReference) {
                return this.linker.buildMultiReferenceSN(
                    node as AstNode, info.property, unwrapped, refText
                );
            } else {
                return this.linker.buildReferenceSN(
                    node as AstNode, info.property, unwrapped, refText
                );
            }
        } else if (unwrapped.isLeaf) {
            // In Lezer, a parser rule whose children are all anonymous (e.g., keywords)
            // appears as a leaf because firstChild skips anonymous nodes.
            // Detect this by checking if the "leaf" has a known parser rule type with
            // assignments or infer actions, and force buildNode if so.
            if (!unwrapped.isKeyword && unwrapped.type) {
                const rule = this.grammarRegistry.getRuleByName(unwrapped.type);
                if (rule && !this.grammarRegistry.isDataTypeRule(unwrapped.type)) {
                    const hasAssignments = this.grammarRegistry.getAssignmentInfos(unwrapped.type).length > 0;
                    const hasInferActions = this.grammarRegistry.getInferActions(unwrapped.type).length > 0;
                    if (hasAssignments || hasInferActions) {
                        return this.buildNode(unwrapped);
                    }
                }
            }
            // Leaf token: convert the value
            if (unwrapped.isKeyword) {
                return unwrapped.text;
            }
            const ruleName = info.terminalRuleName;
            if (ruleName && this.valueConverter.convertByRuleName) {
                return this.valueConverter.convertByRuleName(unwrapped.text, ruleName);
            }
            return unwrapped.text;
        } else {
            // Composite child: recurse to build a sub-AstNode
            return this.buildNode(unwrapped);
        }
    }

    /**
     * Unwrap Lezer field wrapper non-terminals.
     * The Lezer grammar translator wraps assignments in nonterminals like
     * `PersonName { Identifier }`. `childForField("name")` returns the wrapper.
     * If the child has exactly one non-hidden, non-error child, unwrap it.
     */
    protected unwrapFieldChild(childSN: SyntaxNode): SyntaxNode {
        if (!childSN.isLeaf) {
            // Avoid allocating a filtered array — count and track the single real child inline
            let realChild: SyntaxNode | undefined;
            let count = 0;
            for (const c of childSN.children) {
                if (!c.isError && !c.isHidden) {
                    realChild = c;
                    count++;
                    if (count > 1) break;
                }
            }
            if (count === 1 && realChild) {
                return realChild;
            }
        }
        return childSN;
    }

    /**
     * Handle children that are not part of any assignment (type override pattern).
     * When a parser rule calls a subrule without an assignment, the subrule's
     * properties are inlined into the current node and its $type is updated.
     *
     * This handles alternative rules (e.g., `Element: Source | Target`) by
     * processing the child's assignments directly on the parent node, avoiding
     * the creation of an orphaned intermediate AstNode. Mirrors what Chevrotain's
     * action() callback does at parse time.
     */
    protected processUnassignedChildren(
        node: GenericAstNode,
        syntaxNode: SyntaxNode,
        assignedFields: Set<string>
    ): void {
        // Pre-collect all assigned children in a Set for O(1) lookup,
        // avoiding repeated childrenForField() calls in the inner loop.
        const assignedChildren = new Set<SyntaxNode>();
        for (const field of assignedFields) {
            for (const fc of syntaxNode.childrenForField(field)) {
                assignedChildren.add(fc);
            }
        }
        for (const child of syntaxNode.children) {
            if (child.isLeaf || child.isHidden || child.isError) {
                continue;
            }
            if (!assignedChildren.has(child)) {
                this.inlineChildNode(node, child);
            }
        }
    }

    /**
     * Inline a child SyntaxNode's content into the parent AstNode.
     * Sets $type from the child, processes the child's assignments on the parent,
     * recursively inlines the child's own unassigned children, and maps the child
     * SyntaxNode to the parent AstNode for correct findAstNode() lookups.
     */
    protected inlineChildNode(node: GenericAstNode, childSN: SyntaxNode): void {
        const childType = childSN.type;

        if (this.grammarRegistry.isDataTypeRule(childType)) {
            return;
        }

        // Handle infix rules: if the child is an infix rule (e.g., `Expression` in
        // `PrimaryExpression infers Expression: '(' Expression ')'`), build it as a
        // complete AstNode via buildNode() and copy its properties to the parent.
        // Without this, the operands would be flattened and only the last one survives.
        const infixInfo = this.grammarRegistry.getInfixRuleInfo(childType);
        if (infixInfo) {
            const operandChildren = childSN.children.filter(c =>
                !c.isHidden && !c.isError &&
                (c.type === infixInfo.ruleName || c.type === infixInfo.operandRuleName)
            );
            if (operandChildren.length === 2) {
                // Build the infix expression as a standalone AstNode
                const infixNode = this.buildInfixExpression(childSN, infixInfo, operandChildren) as GenericAstNode;
                // Copy all properties from the built infix node to the parent
                (node as Mutable<AstNode>).$type = (infixNode as AstNode).$type;
                for (const key of Object.keys(infixNode)) {
                    if (key.startsWith('$')) continue;
                    (node as Record<string, unknown>)[key] = (infixNode as Record<string, unknown>)[key];
                    // Re-parent child AstNodes
                    const val = (infixNode as Record<string, unknown>)[key];
                    if (val && typeof val === 'object' && '$type' in (val as object)) {
                        (val as Mutable<AstNode>).$container = node as unknown as AstNode;
                    }
                }
                this.defineSyntaxNodeProperty(node, childSN);
                this.syntaxNodeToAstNode.set(childSN, node);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (childSN as any).$astNode = node;
                return;
            }
            // Single operand (pass-through) — fall through to normal inlining
        }

        // Update $type to the child's type (mirrors Chevrotain's action callback)
        (node as Mutable<AstNode>).$type = childType;

        // Process the child's assignments directly on the parent node.
        // Deduplicate by property name (same as in buildNode).
        const childAssignments = this.grammarRegistry.getAssignmentInfos(childType);
        const childAssignedFields = new Set<string>();
        for (const info of childAssignments) {
            if (childAssignedFields.has(info.property)) continue;
            childAssignedFields.add(info.property);
            this.processAssignment(node, childSN, info);
        }
        this.processUnassignedChildren(node, childSN, childAssignedFields);

        // Apply type inference from {infer X} actions for the inlined child's rule.
        // Only do this if deeper inlining hasn't already changed the $type
        // (i.e., the type is still the child rule's type, not a more specific one).
        if ((node as Mutable<AstNode>).$type === childType) {
            const inferActions = this.grammarRegistry.getInferActions(childType);
            if (inferActions.length > 0) {
                this.applyTypeInference(node, inferActions);
            }
        }

        // Update $syntaxNode to point to the inlined child's SyntaxNode so that
        // findAssignmentSN can locate field children (e.g., SelectStmtTable) which
        // are direct children of the inlined SyntaxNode, not the outer wrapper.
        this.defineSyntaxNodeProperty(node, childSN);

        // Map child SyntaxNode → parent AstNode for correct findAstNode() lookups
        this.syntaxNodeToAstNode.set(childSN, node);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (childSN as any).$astNode = node;
    }

    // ---- Infix expression support ----

    /**
     * Build a binary expression from an infix rule's SyntaxNode.
     * Operators are anonymous tokens in Lezer infix rules, so we extract them
     * from the source text between the two operand children.
     */
    protected buildInfixExpression(
        syntaxNode: SyntaxNode,
        infixInfo: InfixRuleInfo,
        operandChildren: SyntaxNode[]
    ): unknown {
        const leftChild = operandChildren[0];
        const rightChild = operandChildren[1];

        // Extract operator from source text gap between children
        const fullText = syntaxNode.text;
        const nodeStart = syntaxNode.offset;
        const leftEnd = leftChild.offset + leftChild.length - nodeStart;
        const rightStart = rightChild.offset - nodeStart;
        const operator = fullText.substring(leftEnd, rightStart).trim();

        const left = this.buildNode(leftChild);
        const right = this.buildNode(rightChild);

        if (left && operator && right) {
            const node: GenericAstNode = {
                $type: infixInfo.binaryTypeName,
                left,
                operator,
                right,
            } as GenericAstNode;

            if (left && typeof left === 'object' && '$type' in left) {
                (left as Mutable<AstNode>).$container = node as unknown as AstNode;
                (left as Mutable<AstNode>).$containerProperty = 'left';
            }
            if (right && typeof right === 'object' && '$type' in right) {
                (right as Mutable<AstNode>).$container = node as unknown as AstNode;
                (right as Mutable<AstNode>).$containerProperty = 'right';
            }

            this.defineSyntaxNodeProperty(node, syntaxNode);
            this.syntaxNodeToAstNode.set(syntaxNode, node as unknown as AstNode);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (syntaxNode as any).$astNode = node;

            return node;
        }

        // Fallback: couldn't extract operator, build normally
        return undefined;
    }

    // ---- Chaining action support ----

    /**
     * Try to build a nested chain from a flat SyntaxNode with a chaining action.
     * Returns the outermost chain node, or undefined if no chaining is needed.
     *
     * Handles two patterns:
     * 1. Shared field: `element=X ({infer T.prev=current} '.' element=X)*`
     *    → All field children share the same name; first is base, rest are chain links.
     * 2. Separate base: `Base ({infer T.left=current} op=Op right=Base)*`
     *    → Base is an unassigned child; chain links have their own fields.
     */
    protected tryBuildChainedNode(
        syntaxNode: SyntaxNode,
        chainingInfo: ChainingActionInfo
    ): unknown | undefined {
        const ruleName = syntaxNode.type;
        const assignmentInfos = this.grammarRegistry.getAssignmentInfos(ruleName);

        // Shared field pattern: a field that appears in the grammar both before and inside
        // the repetition (e.g., `element=X ({infer T.prev=current} '.' element=X)*`).
        // In the Lezer tree, all instances share the same wrapper rule name.
        // Detect by finding a field with more children than expected for a single assignment.
        const allFieldNames = new Set(assignmentInfos.map(a => a.property));

        for (const fieldName of allFieldNames) {
            const fieldChildren = syntaxNode.childrenForField(fieldName);
            if (fieldChildren.length > 1) {
                // This field is shared — build chain with it
                return this.buildSharedFieldChain(syntaxNode, chainingInfo, fieldName, fieldChildren, assignmentInfos);
            }
        }

        // Separate base pattern: chain fields have children, base is unassigned
        if (chainingInfo.assignedFields.length > 0) {
            const firstChainField = chainingInfo.assignedFields[0];
            const chainFieldChildren = syntaxNode.childrenForField(firstChainField);
            if (chainFieldChildren.length > 0) {
                return this.buildSeparateBaseChain(syntaxNode, chainingInfo, assignmentInfos);
            }
        }

        return undefined;
    }

    /**
     * Build a chain from a shared-field pattern.
     * E.g., `GlobalReference: element=X ({infer GlobalReference.previous=current} '.' element=X)*`
     * All `element` children are collected; first is the base, rest create nested wrappers.
     */
    private buildSharedFieldChain(
        syntaxNode: SyntaxNode,
        chainingInfo: ChainingActionInfo,
        sharedFieldName: string,
        fieldChildren: readonly SyntaxNode[],
        assignmentInfos: AssignmentInfo[]
    ): unknown {
        const sharedFieldInfo = assignmentInfos.find(a => a.property === sharedFieldName);
        if (!sharedFieldInfo) return undefined;

        // Build the innermost node (first field child)
        let current = this.buildSingleChainNode(
            chainingInfo.typeName,
            sharedFieldInfo,
            fieldChildren[0]
        );

        // Build each subsequent chain link
        for (let i = 1; i < fieldChildren.length; i++) {
            const outer = this.buildSingleChainNode(
                chainingInfo.typeName,
                sharedFieldInfo,
                fieldChildren[i]
            );
            outer[chainingInfo.chainProperty] = current;
            (current as Mutable<AstNode>).$container = outer as unknown as AstNode;
            (current as Mutable<AstNode>).$containerProperty = chainingInfo.chainProperty;
            current = outer;
        }

        // Associate outermost node with the syntax node
        this.defineSyntaxNodeProperty(current, syntaxNode);
        this.syntaxNodeToAstNode.set(syntaxNode, current as unknown as AstNode);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (syntaxNode as any).$astNode = current;

        return current;
    }

    /**
     * Build a single node in a shared-field chain (e.g., one GlobalReference with element).
     */
    private buildSingleChainNode(
        typeName: string,
        fieldInfo: AssignmentInfo,
        fieldChild: SyntaxNode
    ): GenericAstNode {
        const node: GenericAstNode = { $type: typeName } as GenericAstNode;
        const unwrapped = this.unwrapFieldChild(fieldChild);

        if (fieldInfo.isCrossReference) {
            const refText = this.getLeafText(unwrapped);
            node[fieldInfo.property] = this.linker.buildReferenceSN(
                node as unknown as AstNode, fieldInfo.property, unwrapped, refText
            );
        } else if (unwrapped.isLeaf) {
            node[fieldInfo.property] = unwrapped.text;
        } else {
            node[fieldInfo.property] = this.buildNode(unwrapped);
        }

        return node;
    }

    /**
     * Build a chain from a separate-base pattern.
     * E.g., `UnionExpr: IntersectExpr ({infer BinaryTableExpr.left=current} op=Op right=IntersectExpr)*`
     * The base is an unassigned child; each repetition has its own assigned fields.
     */
    private buildSeparateBaseChain(
        syntaxNode: SyntaxNode,
        chainingInfo: ChainingActionInfo,
        assignmentInfos: AssignmentInfo[]
    ): unknown {
        // Find the unassigned child (the base)
        const assignedFields = new Set(assignmentInfos.map(a => a.property));
        let baseSN: SyntaxNode | undefined;
        for (const child of syntaxNode.children) {
            if (child.isLeaf || child.isHidden || child.isError) continue;
            let isAssigned = false;
            for (const field of assignedFields) {
                if (syntaxNode.childrenForField(field).some(fc => fc === child)) {
                    isAssigned = true;
                    break;
                }
            }
            if (!isAssigned) {
                baseSN = child;
                break;
            }
        }

        if (!baseSN) return undefined;

        // Build the base node
        let current = this.buildNode(baseSN) as GenericAstNode;
        if (!current || typeof current !== 'object') return undefined;

        // Count repetitions from the first chain field
        const firstChainField = chainingInfo.assignedFields[0];
        const repetitionCount = syntaxNode.childrenForField(firstChainField).length;

        // Build each chain link
        for (let i = 0; i < repetitionCount; i++) {
            const chainNode: GenericAstNode = {
                $type: chainingInfo.typeName
            } as GenericAstNode;

            // Set the chain property (e.g., "left") to the current node
            chainNode[chainingInfo.chainProperty] = current;
            (current as Mutable<AstNode>).$container = chainNode as unknown as AstNode;
            (current as Mutable<AstNode>).$containerProperty = chainingInfo.chainProperty;

            // Process chain fields for this repetition
            for (const fieldName of chainingInfo.assignedFields) {
                const info = assignmentInfos.find(a => a.property === fieldName);
                if (!info) continue;
                const fieldChildren = syntaxNode.childrenForField(fieldName);
                if (i < fieldChildren.length) {
                    chainNode[fieldName] = this.extractAssignmentValue(chainNode, fieldChildren[i], info);
                }
            }

            current = chainNode;
        }

        // Associate outermost node with the syntax node
        this.defineSyntaxNodeProperty(current, syntaxNode);
        this.syntaxNodeToAstNode.set(syntaxNode, current as unknown as AstNode);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (syntaxNode as any).$astNode = current;

        return current;
    }

    // ---- Type inference support ----

    /**
     * Apply type inference from `{infer X}` actions.
     * Matches populated fields against each infer action's required fields
     * to determine the correct `$type`. First match wins.
     */
    protected applyTypeInference(node: GenericAstNode, inferActions: InferActionInfo[]): void {
        // Try actions with required fields first (most specific match).
        // Fall back to actions with no required fields (catch-all) only if no specific match
        // AND the node has no populated fields. If the node has populated fields but none
        // matched any specific action, the node is from a branch without an {infer} action.
        let catchAll: InferActionInfo | undefined;
        for (const action of inferActions) {
            if (action.requiredFields.length === 0) {
                catchAll = catchAll ?? action;
                continue;
            }
            if (this.matchesInferAction(node, action)) {
                (node as Mutable<AstNode>).$type = action.typeName;
                return;
            }
        }
        if (catchAll && !this.hasPopulatedFields(node)) {
            (node as Mutable<AstNode>).$type = catchAll.typeName;
        }
    }

    /**
     * Check if a node has any populated fields beyond $type and mandatory defaults.
     */
    private hasPopulatedFields(node: GenericAstNode): boolean {
        for (const key of Object.keys(node)) {
            if (key.startsWith('$')) continue;
            const val = node[key];
            if (val === undefined || val === false) continue;
            if (Array.isArray(val) && val.length === 0) continue;
            return true;
        }
        return false;
    }

    /**
     * Check if a node's populated fields match an infer action's required fields.
     */
    private matchesInferAction(node: GenericAstNode, action: InferActionInfo): boolean {
        for (const field of action.requiredFields) {
            if (!this.hasField(node, field)) return false;
        }
        return true;
    }

    /**
     * Check if a field is present and non-empty on a node.
     */
    private hasField(node: GenericAstNode, field: string): boolean {
        if (!(field in node)) return false;
        const val = node[field];
        if (val === undefined || val === false) return false;
        if (Array.isArray(val) && val.length === 0) return false;
        return true;
    }

    protected buildDataTypeValue(syntaxNode: SyntaxNode): string {
        // Data type rules produce concatenated text from all leaf tokens
        return syntaxNode.text;
    }

    /**
     * Get the text of the first non-hidden leaf node (for cross-reference text).
     */
    protected getLeafText(node: SyntaxNode): string {
        if (node.isLeaf) return node.text;
        for (const child of node.children) {
            if (!child.isHidden && !child.isError) {
                return this.getLeafText(child);
            }
        }
        return node.text;
    }

    protected defineSyntaxNodeProperty(node: GenericAstNode, syntaxNode: SyntaxNode): void {
        Object.defineProperty(node, '$syntaxNode', {
            value: syntaxNode,
            configurable: true,
            enumerable: false,
            writable: false
        });
    }

    protected convertParserErrors(root: RootSyntaxNode): ParseError[] {
        const text = root.fullText;
        return root.diagnostics
            .filter(d => d.source === 'parser')
            .map(d => {
                const start = this.offsetToLineColumn(text, d.offset);
                const end = this.offsetToLineColumn(text, d.offset + d.length);
                return {
                    message: d.message,
                    token: {
                        image: text.substring(d.offset, d.offset + d.length),
                        startOffset: d.offset,
                        startLine: start.line,
                        startColumn: start.column,
                        endOffset: d.offset + d.length,
                        endLine: end.line,
                        endColumn: end.column
                    }
                };
            });
    }

    /**
     * Convert a byte offset to 1-based line/column (Chevrotain convention).
     */
    protected offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
        let line = 1;
        let lastLineStart = 0;
        for (let i = 0; i < offset && i < text.length; i++) {
            if (text.charCodeAt(i) === 10) { // '\n'
                line++;
                lastLineStart = i + 1;
            }
        }
        return { line, column: offset - lastLineStart + 1 };
    }

    protected convertLexerErrors(root: RootSyntaxNode): LexError[] {
        return root.diagnostics
            .filter(d => d.source === 'lexer')
            .map(d => ({
                message: d.message,
                offset: d.offset,
                length: d.length
            }));
    }
}
