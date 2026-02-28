/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { LangiumCoreServices } from '../services.js';
import type { AstNode, AstReflection, GenericAstNode, Mutable } from '../syntax-tree.js';
import type { Linker } from '../references/linker.js';
import type { GrammarRegistry, AssignmentInfo } from '../grammar/grammar-registry.js';
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

        // Create the AstNode
        const node: GenericAstNode = { $type: ruleName } as GenericAstNode;

        // Process assignments from the grammar registry
        const assignmentInfos = this.grammarRegistry.getAssignmentInfos(ruleName);
        const assignedFields = new Set<string>();

        for (const info of assignmentInfos) {
            assignedFields.add(info.property);
            this.processAssignment(node, syntaxNode, info);
        }

        // Handle unassigned composite children (type override / subrule without assignment)
        this.processUnassignedChildren(node, syntaxNode, assignedFields);

        // Set mandatory default values (empty arrays, default booleans, etc.)
        assignMandatoryProperties(this.reflection, node);

        // Associate SyntaxNode with AstNode
        this.defineSyntaxNodeProperty(node, syntaxNode);
        this.syntaxNodeToAstNode.set(syntaxNode, node);

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
            const realChildren = childSN.children.filter(c => !c.isError && !c.isHidden);
            if (realChildren.length === 1) {
                return realChildren[0];
            }
        }
        return childSN;
    }

    /**
     * Handle children that are not part of any assignment (type override pattern).
     * When a parser rule calls a subrule without an assignment, the subrule's
     * result becomes the current node (its properties are merged).
     */
    protected processUnassignedChildren(
        node: GenericAstNode,
        syntaxNode: SyntaxNode,
        assignedFields: Set<string>
    ): void {
        for (const child of syntaxNode.children) {
            if (child.isLeaf || child.isHidden || child.isError) {
                continue;
            }
            // Check if this child is part of an assigned field
            let isAssigned = false;
            for (const field of assignedFields) {
                const fieldChildren = syntaxNode.childrenForField(field);
                if (fieldChildren.some(fc => fc === child)) {
                    isAssigned = true;
                    break;
                }
            }
            if (!isAssigned) {
                // Unassigned composite child: this is a type override
                const childResult = this.buildNode(child);
                if (isAstNode(childResult)) {
                    // Merge properties from the child into the current node
                    // (mirrors Chevrotain's assignWithoutOverride)
                    this.assignWithoutOverride(childResult as GenericAstNode, node);
                } else if (typeof childResult === 'string') {
                    // Data type rule result — unlikely in this context but handle it
                }
            }
        }
    }

    /**
     * Merge properties from source into target, without overriding existing values.
     * Arrays are concatenated. Mirrors Chevrotain's assignWithoutOverride.
     */
    protected assignWithoutOverride(source: GenericAstNode, target: GenericAstNode): void {
        for (const [name, sourceValue] of Object.entries(source)) {
            if (name.startsWith('$')) continue; // Skip $ properties
            const targetValue = target[name];
            if (targetValue === undefined) {
                target[name] = sourceValue;
            } else if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
                targetValue.push(...sourceValue);
            }
        }
        // The source's $type may be more specific — use it
        if (source.$type && source.$type !== target.$type) {
            (target as Mutable<AstNode>).$type = source.$type;
        }
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
        return root.diagnostics
            .filter(d => d.source === 'parser')
            .map(d => ({
                message: d.message,
                token: {
                    image: '',
                    startOffset: d.offset,
                    endOffset: d.offset + d.length
                }
            }));
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
