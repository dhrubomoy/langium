/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Assignment } from '../languages/generated/ast.js';
import type { ChevrotainSyntaxNode } from '../parser/chevrotain-syntax-node.js';
import type { SyntaxNode } from '../parser/syntax-node.js';
import type { AstNode } from '../syntax-tree.js';
import type { Stream, TreeStream } from './stream.js';
import type { DocumentSegment } from '../workspace/documents.js';
import { wrapCstNode } from '../parser/chevrotain-syntax-node.js';
import { TreeStreamImpl } from './stream.js';
import { findNodeForProperty, findNodesForProperty, findNodesForKeyword, findAssignment as findAssignmentCst } from './grammar-utils.js';
import { findLeafNodeAtOffset as findLeafCstNodeAtOffset, findLeafNodeBeforeOffset as findLeafCstNodeBeforeOffset, findCommentNode as findCommentCstNode, isCommentNode as isCommentCstNode, getDatatypeNode as getDatatypeCstNode, getInteriorNodes as getInteriorCstNodes, DefaultNameRegexp } from './cst-utils.js';

/**
 * Checks if a SyntaxNode is a ChevrotainSyntaxNode (bridge pattern).
 * Used internally to delegate to CstNode-based functions during Phase 1.
 */
function isChevrotainSyntaxNode(node: SyntaxNode): node is ChevrotainSyntaxNode {
    return 'underlyingCstNode' in node;
}

// --- Tree streaming ---

/**
 * Create a stream of all SyntaxNode nodes that are directly and indirectly
 * contained in the given root node, including the root node itself.
 */
export function streamSyntaxTree(node: SyntaxNode): TreeStream<SyntaxNode> {
    return new TreeStreamImpl(node, element => {
        return element.children as SyntaxNode[];
    }, { includeRoot: true });
}

/**
 * Create a stream of all leaf nodes that are directly and indirectly
 * contained in the given root node.
 */
export function flattenSyntaxTree(node: SyntaxNode): Stream<SyntaxNode> {
    return streamSyntaxTree(node).filter(n => n.isLeaf);
}

// --- Positional lookup ---

/**
 * Finds the leaf SyntaxNode at the specified 0-based offset.
 * Returns undefined if the offset doesn't point to a node.
 */
export function findLeafSyntaxNodeAtOffset(node: SyntaxNode, offset: number): SyntaxNode | undefined {
    if (isChevrotainSyntaxNode(node)) {
        const cstResult = findLeafCstNodeAtOffset(node.underlyingCstNode, offset);
        return cstResult ? wrapCstNode(cstResult) : undefined;
    }
    // Generic SyntaxNode implementation
    if (node.isLeaf) {
        return node;
    }
    for (const child of node.children) {
        if (child.offset <= offset && child.end > offset) {
            return findLeafSyntaxNodeAtOffset(child, offset);
        }
    }
    return undefined;
}

/**
 * Finds the leaf SyntaxNode before the specified offset.
 * If no node exists at the position, returns the closest leaf before it.
 */
export function findLeafSyntaxNodeBeforeOffset(node: SyntaxNode, offset: number): SyntaxNode | undefined {
    if (isChevrotainSyntaxNode(node)) {
        const cstResult = findLeafCstNodeBeforeOffset(node.underlyingCstNode, offset);
        return cstResult ? wrapCstNode(cstResult) : undefined;
    }
    // Generic SyntaxNode implementation
    if (node.isLeaf) {
        return node;
    }
    let closest: SyntaxNode | undefined;
    for (const child of node.children) {
        if (child.offset <= offset && child.end > offset) {
            return findLeafSyntaxNodeBeforeOffset(child, offset);
        }
        if (child.end <= offset) {
            closest = child;
        }
    }
    return closest ? findLeafSyntaxNodeBeforeOffset(closest, offset) : undefined;
}

/**
 * Performs `findLeafSyntaxNodeAtOffset` with a minor difference: When encountering a
 * character that matches the `nameRegexp`, it will instead return the leaf node at
 * the `offset - 1` position. For LSP services, users expect the declaration to be
 * available if the cursor is directly after the element.
 */
export function findDeclarationSyntaxNodeAtOffset(node: SyntaxNode | undefined, offset: number, nameRegexp = DefaultNameRegexp): SyntaxNode | undefined {
    if (!node) {
        return undefined;
    }
    if (offset > 0) {
        const localOffset = offset - node.offset;
        const textAtOffset = node.text.charAt(localOffset);
        if (!nameRegexp.test(textAtOffset)) {
            offset--;
        }
    }
    return findLeafSyntaxNodeAtOffset(node, offset);
}

// --- Comment finding ---

/**
 * Find the comment node that precedes the given syntax node.
 */
export function findCommentSyntaxNode(node: SyntaxNode | undefined, commentNames: string[]): SyntaxNode | undefined {
    if (!node) {
        return undefined;
    }
    if (isChevrotainSyntaxNode(node)) {
        const cstResult = findCommentCstNode(node.underlyingCstNode, commentNames);
        return cstResult ? wrapCstNode(cstResult) : undefined;
    }
    // Generic implementation: look for hidden preceding sibling with matching token type
    const prev = getPreviousSyntaxNode(node, true);
    if (prev && isCommentSyntaxNode(prev, commentNames)) {
        return prev;
    }
    return undefined;
}

/**
 * Check if a SyntaxNode is a comment node.
 */
export function isCommentSyntaxNode(node: SyntaxNode, commentNames: string[]): boolean {
    if (isChevrotainSyntaxNode(node)) {
        return isCommentCstNode(node.underlyingCstNode, commentNames);
    }
    return node.isLeaf && node.tokenType !== undefined && commentNames.includes(node.tokenType);
}

// --- Navigation ---

/**
 * Get the previous sibling node.
 */
export function getPreviousSyntaxNode(node: SyntaxNode, hidden = true): SyntaxNode | undefined {
    let current: SyntaxNode | null = node;
    while (current?.parent) {
        const parent: SyntaxNode = current.parent;
        const siblings = parent.children;
        let index = siblings.indexOf(current);
        while (index > 0) {
            index--;
            const previous = siblings[index];
            if (hidden || !previous.isHidden) {
                return previous;
            }
        }
        current = parent;
    }
    return undefined;
}

/**
 * Get the next sibling node.
 */
export function getNextSyntaxNode(node: SyntaxNode, hidden = true): SyntaxNode | undefined {
    let current: SyntaxNode | null = node;
    while (current?.parent) {
        const parent: SyntaxNode = current.parent;
        const siblings = parent.children;
        let index = siblings.indexOf(current);
        const last = siblings.length - 1;
        while (index < last) {
            index++;
            const next = siblings[index];
            if (hidden || !next.isHidden) {
                return next;
            }
        }
        current = parent;
    }
    return undefined;
}

// --- Grammar-aware functions (bridging) ---

/**
 * Find all SyntaxNodes within the given node that contribute to the specified property.
 * For ChevrotainSyntaxNode: delegates to existing CstNode-based functions.
 * For future backends: uses SyntaxNode.childrenForField().
 */
export function findNodesForPropertySN(node: SyntaxNode | undefined, property: string | undefined): SyntaxNode[] {
    if (!node || !property) {
        return [];
    }
    if (isChevrotainSyntaxNode(node)) {
        const cstResults = findNodesForProperty(node.underlyingCstNode, property);
        return cstResults.map(wrapCstNode);
    }
    return node.childrenForField(property) as SyntaxNode[];
}

/**
 * Find a single SyntaxNode within the given node that contributes to the specified property.
 */
export function findNodeForPropertySN(node: SyntaxNode | undefined, property: string | undefined, index?: number): SyntaxNode | undefined {
    if (!node || !property) {
        return undefined;
    }
    if (isChevrotainSyntaxNode(node)) {
        const cstResult = findNodeForProperty(node.underlyingCstNode, property, index);
        return cstResult ? wrapCstNode(cstResult) : undefined;
    }
    const children = node.childrenForField(property);
    if (children.length === 0) {
        return undefined;
    }
    if (index !== undefined) {
        index = Math.max(0, Math.min(index, children.length - 1));
    } else {
        index = 0;
    }
    return children[index];
}

/**
 * Find all SyntaxNodes within the given node that correspond to the specified keyword.
 */
export function findNodesForKeywordSN(node: SyntaxNode | undefined, keyword: string): SyntaxNode[] {
    if (!node) {
        return [];
    }
    if (isChevrotainSyntaxNode(node)) {
        const cstResults = findNodesForKeyword(node.underlyingCstNode, keyword);
        return cstResults.map(wrapCstNode);
    }
    // Generic implementation: walk children looking for keyword nodes
    const results: SyntaxNode[] = [];
    for (const child of streamSyntaxTree(node)) {
        if (child.isKeyword && child.text === keyword) {
            results.push(child);
        }
    }
    return results;
}

/**
 * Find a single SyntaxNode within the given node that corresponds to the specified keyword.
 */
export function findNodeForKeywordSN(node: SyntaxNode | undefined, keyword: string, index?: number): SyntaxNode | undefined {
    if (!node) {
        return undefined;
    }
    const nodes = findNodesForKeywordSN(node, keyword);
    if (nodes.length === 0) {
        return undefined;
    }
    if (index !== undefined) {
        index = Math.max(0, Math.min(index, nodes.length - 1));
    } else {
        index = 0;
    }
    return nodes[index];
}

/**
 * If the given SyntaxNode was parsed in the context of a property assignment,
 * the respective Assignment grammar node is returned.
 */
export function findAssignmentSN(node: SyntaxNode): Assignment | undefined {
    if (isChevrotainSyntaxNode(node)) {
        return findAssignmentCst(node.underlyingCstNode);
    }
    // For future backends: use GrammarRegistry lookup
    return undefined;
}

// --- Datatype node ---

/**
 * If the given SyntaxNode was parsed as part of a data type rule,
 * the full datatype SyntaxNode is returned. Otherwise undefined.
 * For Chevrotain: delegates to CstNode-based getDatatypeNode.
 */
export function getDatatypeSyntaxNode(node: SyntaxNode): SyntaxNode | undefined {
    if (isChevrotainSyntaxNode(node)) {
        const cstResult = getDatatypeCstNode(node.underlyingCstNode);
        return cstResult ? wrapCstNode(cstResult) : undefined;
    }
    // Generic: not yet implemented for non-Chevrotain backends
    return undefined;
}

// --- Interior nodes ---

/**
 * Get all SyntaxNodes between (exclusive) two given nodes within their common parent.
 * For Chevrotain: delegates to CstNode-based getInteriorNodes.
 */
export function getInteriorSyntaxNodes(start: SyntaxNode, end: SyntaxNode): SyntaxNode[] {
    if (isChevrotainSyntaxNode(start) && isChevrotainSyntaxNode(end)) {
        const cstResults = getInteriorCstNodes(start.underlyingCstNode, end.underlyingCstNode);
        return cstResults.map(wrapCstNode);
    }
    // Generic implementation: find common parent, return children in between
    if (!start.parent || start.parent !== end.parent) {
        return [];
    }
    const siblings = start.parent.children;
    const startIdx = siblings.indexOf(start);
    const endIdx = siblings.indexOf(end);
    if (startIdx < 0 || endIdx < 0) {
        return [];
    }
    const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    return siblings.slice(lo + 1, hi) as SyntaxNode[];
}

// --- Document segment ---

/**
 * Converts a SyntaxNode to a DocumentSegment for use in LSP responses.
 * SyntaxNode already carries all required positional information.
 */
export function toDocumentSegmentSN(node: SyntaxNode): DocumentSegment;
export function toDocumentSegmentSN(node?: SyntaxNode): DocumentSegment | undefined;
export function toDocumentSegmentSN(node?: SyntaxNode): DocumentSegment | undefined {
    if (!node) {
        return undefined;
    }
    const { offset, end, range } = node;
    return {
        range,
        offset,
        end,
        length: end - offset
    };
}

// --- Containment check ---

/**
 * Checks whether `child` is a descendant of `parent` by walking up the parent chain.
 * Mirrors `isChildNode` from cst-utils.ts.
 */
export function isChildSyntaxNode(child: SyntaxNode, parent: SyntaxNode): boolean {
    let current: SyntaxNode | null = child;
    while (current?.parent) {
        current = current.parent;
        if (current === parent) {
            return true;
        }
    }
    return false;
}

// --- AST mapping ---

/**
 * Maps a SyntaxNode back to its corresponding AstNode.
 * For ChevrotainSyntaxNode: accesses the underlying CstNode's astNode.
 * For other backends: use {@link SyntaxNodeAstBuilder.findAstNode} instead,
 * which is accessible via `services.parser.SyntaxNodeAstBuilder`.
 */
export function findAstNodeForSyntaxNode(node: SyntaxNode): AstNode | undefined {
    if (isChevrotainSyntaxNode(node)) {
        try {
            return node.underlyingCstNode.astNode;
        } catch {
            return undefined;
        }
    }
    return undefined;
}
