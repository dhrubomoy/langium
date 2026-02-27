/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Range } from 'vscode-languageserver-types';
import type { AbstractElement } from '../languages/generated/ast.js';
import type { CompositeCstNode, CstNode, RootCstNode } from '../syntax-tree.js';
import type { ParseDiagnostic, RootSyntaxNode, SyntaxNode } from './syntax-node.js';
import { isCompositeCstNode, isLeafCstNode } from '../syntax-tree.js';
import { isAssignment, isKeyword, isRuleCall } from '../languages/generated/ast.js';
import { getContainerOfType } from '../utils/ast-utils.js';

/**
 * WeakMap cache to avoid creating duplicate wrapper instances for the same CstNode.
 * This ensures identity: `wrapCstNode(cst) === wrapCstNode(cst)`.
 */
const wrapperCache = new WeakMap<CstNode, ChevrotainSyntaxNode>();

/**
 * Wraps a CstNode as a SyntaxNode. Uses a WeakMap cache to ensure
 * the same CstNode always returns the same wrapper instance.
 */
export function wrapCstNode(cstNode: CstNode): ChevrotainSyntaxNode {
    let wrapper = wrapperCache.get(cstNode);
    if (!wrapper) {
        wrapper = new ChevrotainSyntaxNode(cstNode);
        wrapperCache.set(cstNode, wrapper);
    }
    return wrapper;
}

/**
 * Wraps a RootCstNode as a RootSyntaxNode.
 */
export function wrapRootCstNode(rootCstNode: RootCstNode): ChevrotainRootSyntaxNode {
    let wrapper = wrapperCache.get(rootCstNode);
    if (!wrapper || !(wrapper instanceof ChevrotainRootSyntaxNode)) {
        wrapper = new ChevrotainRootSyntaxNode(rootCstNode);
        wrapperCache.set(rootCstNode, wrapper);
    }
    return wrapper as ChevrotainRootSyntaxNode;
}

/**
 * Derives a type name from a CstNode's grammarSource.
 *
 * For leaf nodes: returns the token type name (e.g., "ID", "STRING").
 * For composite nodes: derives from the grammar element:
 * - RuleCall → referenced rule name (most common for subrule invocations)
 * - Keyword → the keyword value
 * - Other AbstractElement → grammar element $type name
 */
function deriveTypeName(cstNode: CstNode): string {
    if (isLeafCstNode(cstNode)) {
        return cstNode.tokenType.name;
    }
    const source = cstNode.grammarSource;
    if (!source) {
        return '';
    }
    if (isRuleCall(source)) {
        return source.rule.ref?.name ?? '';
    }
    if (isKeyword(source)) {
        return source.value;
    }
    // For other grammar elements (Group, Alternatives, Assignment, etc.), use the $type
    return source.$type;
}

/**
 * Checks if a CstNode represents a keyword token.
 */
function isKeywordNode(cstNode: CstNode): boolean {
    return isKeyword(cstNode.grammarSource);
}

/**
 * Thin wrapper that adapts Langium's CstNode to the backend-agnostic SyntaxNode interface.
 *
 * Properties are computed lazily from the underlying CstNode.
 * The `underlyingCstNode` accessor (marked @internal) allows gradual migration:
 * services can start accepting SyntaxNode but "peek" at the CstNode during transition.
 */
export class ChevrotainSyntaxNode implements SyntaxNode {

    /** @internal The wrapped CstNode. Used during migration to bridge old and new APIs. */
    readonly underlyingCstNode: CstNode;

    private _children?: readonly SyntaxNode[];
    private _type?: string;

    constructor(cstNode: CstNode) {
        this.underlyingCstNode = cstNode;
    }

    // --- Positional data: direct passthrough ---

    get offset(): number {
        return this.underlyingCstNode.offset;
    }

    get end(): number {
        return this.underlyingCstNode.end;
    }

    get length(): number {
        return this.underlyingCstNode.length;
    }

    get text(): string {
        return this.underlyingCstNode.text;
    }

    get range(): Range {
        return this.underlyingCstNode.range;
    }

    // --- Tree structure ---

    get parent(): SyntaxNode | null {
        const container = this.underlyingCstNode.container;
        return container ? wrapCstNode(container) : null;
    }

    get children(): readonly SyntaxNode[] {
        if (!this._children) {
            if (isCompositeCstNode(this.underlyingCstNode)) {
                this._children = this.underlyingCstNode.content.map(wrapCstNode);
            } else {
                this._children = [];
            }
        }
        return this._children;
    }

    // --- Node classification ---

    get isLeaf(): boolean {
        return isLeafCstNode(this.underlyingCstNode);
    }

    get isHidden(): boolean {
        return this.underlyingCstNode.hidden;
    }

    get isError(): boolean {
        // Chevrotain CST doesn't have explicit error nodes.
        // Error recovery creates regular nodes; errors are reported separately.
        return false;
    }

    get isKeyword(): boolean {
        return isKeywordNode(this.underlyingCstNode);
    }

    // --- Type information ---

    get type(): string {
        if (this._type === undefined) {
            this._type = deriveTypeName(this.underlyingCstNode);
        }
        return this._type;
    }

    get tokenType(): string | undefined {
        if (isLeafCstNode(this.underlyingCstNode)) {
            return this.underlyingCstNode.tokenType.name;
        }
        return undefined;
    }

    // --- Field access ---

    childForField(name: string): SyntaxNode | undefined {
        if (!isCompositeCstNode(this.underlyingCstNode)) {
            return undefined;
        }
        return this.findChildrenForField(name)[0];
    }

    childrenForField(name: string): readonly SyntaxNode[] {
        if (!isCompositeCstNode(this.underlyingCstNode)) {
            return [];
        }
        return this.findChildrenForField(name);
    }

    /**
     * Finds children whose grammarSource is an Assignment with the given feature name.
     * This uses the underlying CstNode's grammarSource for the Chevrotain backend.
     *
     * Matches the behavior of `findNodesForPropertyInternal` in grammar-utils:
     * - Check the assignment FIRST (sub-rule children have different astNode but
     *   their grammarSource still references the parent rule's assignment)
     * - Only recurse into composites that share the same astNode
     */
    private findChildrenForField(name: string): SyntaxNode[] {
        const composite = this.underlyingCstNode as CompositeCstNode;
        const results: SyntaxNode[] = [];
        const targetAstNode = composite.astNode;

        for (const child of composite.content) {
            // Check assignment first - sub-rule children (e.g., items+=Item*)
            // have different astNode but their grammarSource still references
            // the parent's assignment
            const assignment = findAssignmentForNode(child);
            if (assignment && assignment.feature === name) {
                results.push(wrapCstNode(child));
            } else if (isCompositeCstNode(child) && child.astNode === targetAstNode) {
                // Recurse into composite children that belong to the same AST node
                const wrapped = wrapCstNode(child) as ChevrotainSyntaxNode;
                results.push(...wrapped.findChildrenForField(name));
            }
        }
        return results;
    }
}

/**
 * Root syntax node wrapping a RootCstNode.
 * Adds document-level metadata (fullText, diagnostics).
 */
export class ChevrotainRootSyntaxNode extends ChevrotainSyntaxNode implements RootSyntaxNode {

    private _diagnostics?: readonly ParseDiagnostic[];

    get fullText(): string {
        return (this.underlyingCstNode as RootCstNode).fullText;
    }

    get diagnostics(): readonly ParseDiagnostic[] {
        if (!this._diagnostics) {
            // Diagnostics are populated externally via setDiagnostics
            this._diagnostics = [];
        }
        return this._diagnostics;
    }

    /**
     * @internal Set diagnostics from parse errors. Called by ChevrotainAdapter.
     */
    setDiagnostics(diagnostics: readonly ParseDiagnostic[]): void {
        this._diagnostics = diagnostics;
    }
}

/**
 * Finds the Assignment grammar element for a given CstNode by walking up grammarSource.
 */
function findAssignmentForNode(node: CstNode): { feature: string } | undefined {
    const assignment = getContainerOfType(node.grammarSource as AbstractElement | undefined, isAssignment);
    if (assignment) {
        return { feature: assignment.feature };
    }
    return undefined;
}
