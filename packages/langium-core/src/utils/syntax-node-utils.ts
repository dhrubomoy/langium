/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Assignment } from '../languages/generated/ast.js';
import type { GrammarRegistry } from '../grammar/grammar-registry.js';
import type { SyntaxNode } from '../parser/syntax-node.js';
import type { AstNode } from '../syntax-tree.js';
import type { Stream, TreeStream } from './stream.js';
import type { DocumentSegment } from '../workspace/documents.js';
import { TreeStreamImpl } from './stream.js';
import { DefaultNameRegexp } from './cst-utils.js';

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
        // Use indexOf first (works when wrapper identity is stable, e.g., Chevrotain).
        // Fall back to position-based matching for backends where navigation creates
        // distinct wrapper instances for the same logical node (e.g., Lezer).
        let index = siblings.indexOf(current);
        if (index < 0) {
            index = siblings.findIndex(s => s.offset === current!.offset && s.end === current!.end && s.type === current!.type);
        }
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
        if (index < 0) {
            index = siblings.findIndex(s => s.offset === current!.offset && s.end === current!.end && s.type === current!.type);
        }
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

// --- Grammar-aware functions ---

/**
 * Find all SyntaxNodes within the given node that contribute to the specified property.
 * Uses SyntaxNode.childrenForField() which each backend implements.
 */
export function findNodesForPropertySN(node: SyntaxNode | undefined, property: string | undefined): SyntaxNode[] {
    if (!node || !property) {
        return [];
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
 * Only searches within the same AST node boundary (does not descend into children
 * that belong to a different AstNode).
 */
export function findNodesForKeywordSN(node: SyntaxNode | undefined, keyword: string): SyntaxNode[] {
    if (!node) {
        return [];
    }
    const results: SyntaxNode[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ownerAstNode = (node as any).$astNode;
    findKeywordsInBoundary(node, keyword, ownerAstNode, results);
    return results;
}

function findKeywordsInBoundary(node: SyntaxNode, keyword: string, ownerAstNode: AstNode | undefined, results: SyntaxNode[]): void {
    for (const child of node.children) {
        if (child.isKeyword && child.text === keyword) {
            results.push(child);
        } else if (!child.isLeaf) {
            // Only recurse into children that belong to the same AST node
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const childAstNode = (child as any).$astNode;
            if (childAstNode === ownerAstNode || childAstNode === undefined) {
                findKeywordsInBoundary(child, keyword, ownerAstNode, results);
            }
        }
    }
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
 * Walks up the SyntaxNode parent chain looking for an ancestor whose type
 * corresponds to a known grammar rule, then checks which assignment
 * contains the given node.
 */
export function findAssignmentSN(node: SyntaxNode, grammarRegistry?: GrammarRegistry): Assignment | undefined {
    if (!grammarRegistry) {
        return undefined;
    }
    // Strategy 1: Check if the backend exposes grammarSource-based assignment info.
    // ChevrotainSyntaxNode provides $grammarAssignment by walking up the CstNode
    // chain within the same AST node, replicating the old findAssignment() logic.
    // This handles inferred types ({infer X}) and infix rules where the AST type
    // isn't indexed by GrammarRegistry.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const directAssignment = (node as any).$grammarAssignment as Assignment | undefined;
    if (directAssignment) {
        return directAssignment;
    }
    // Strategy 2: Walk up to find $grammarAssignment on ancestors within the same AST node
    const astNode = findAstNodeForSyntaxNode(node);
    let current: SyntaxNode | null = node.parent;
    while (current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const currentAstNode = (current as any).$astNode as AstNode | undefined;
        if (currentAstNode && currentAstNode !== astNode) {
            break; // Crossed AST node boundary
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parentAssignment = (current as any).$grammarAssignment as Assignment | undefined;
        if (parentAssignment) {
            return parentAssignment;
        }
        current = current.parent;
    }
    // Strategy 3: Use GrammarRegistry to find assignment by type and field matching
    if (astNode?.$syntaxNode) {
        const parentSN = astNode.$syntaxNode;
        const assignments = grammarRegistry.getAssignments(astNode.$type);
        for (const assignment of assignments) {
            for (const fieldChild of parentSN.childrenForField(assignment.feature)) {
                if (fieldChild === node || (node.offset >= fieldChild.offset && node.end <= fieldChild.end)) {
                    return assignment;
                }
            }
        }
    }
    return undefined;
}

// --- Datatype node ---

/**
 * If the given SyntaxNode was parsed as part of a data type rule,
 * the full datatype SyntaxNode is returned. Otherwise undefined.
 * Walks up the parent chain using GrammarRegistry to detect datatype rules.
 */
export function getDatatypeSyntaxNode(node: SyntaxNode, grammarRegistry?: GrammarRegistry): SyntaxNode | undefined {
    if (!grammarRegistry) {
        return undefined;
    }
    // Replicate the old getDatatypeNode logic: walk up from the leaf, checking
    // whether each node is in a datatype rule context. Once we leave a datatype
    // context, return the container (which spans all the datatype tokens).
    let current: SyntaxNode | null = node;
    let found = false;
    while (current) {
        if (isInDataTypeContext(current, grammarRegistry)) {
            current = current.parent;
            found = true;
        } else if (found) {
            return current;
        } else {
            return undefined;
        }
    }
    return undefined;
}

function isInDataTypeContext(node: SyntaxNode, grammarRegistry: GrammarRegistry): boolean {
    // Prefer backend-specific check when available. ChevrotainSyntaxNode provides
    // $isInDataTypeRule by inspecting the CstNode's grammarSource chain to find
    // the containing parser rule — this correctly distinguishes between a node
    // being a datatype rule vs. being CALLED FROM a datatype rule context.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backendCheck = (node as any).$isInDataTypeRule;
    if (backendCheck !== undefined) {
        return backendCheck;
    }
    // Fallback for other backends: check node type against GrammarRegistry
    return !!(node.type && grammarRegistry.isDataTypeRule(node.type));
}

// --- Interior nodes ---

/**
 * Get all SyntaxNodes between (exclusive) two given nodes within their common parent.
 */
export function getInteriorSyntaxNodes(start: SyntaxNode, end: SyntaxNode): SyntaxNode[] {
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
 * Walks up the SyntaxNode parent chain looking for the `$astNode` back-reference
 * set by each backend (ChevrotainSyntaxNode.$astNode, or SyntaxNodeAstBuilder for other backends).
 */
export function findAstNodeForSyntaxNode(node: SyntaxNode): AstNode | undefined {
    let current: SyntaxNode | null = node;
    while (current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const astNode = (current as any).$astNode as AstNode | undefined;
        if (astNode) return astNode;
        current = current.parent;
    }
    return undefined;
}
