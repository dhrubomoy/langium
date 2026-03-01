/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { SyntaxNode as LezerNode, Tree } from '@lezer/common';
import { IterMode } from '@lezer/common';
import type { Range } from 'vscode-languageserver-types';
import type { ParseDiagnostic, RootSyntaxNode, SyntaxNode } from 'langium-core';
import type { FieldMap } from './field-map.js';

/**
 * WeakMap cache to avoid creating duplicate wrapper instances for the same Lezer node.
 * Keyed by the Lezer SyntaxNode instance to ensure identity:
 * `wrapLezerNode(node) === wrapLezerNode(node)`.
 */
const wrapperCache = new WeakMap<LezerNode, LezerSyntaxNode>();

/**
 * Wraps a Lezer SyntaxNode as a Langium SyntaxNode.
 * Uses a WeakMap cache to ensure the same Lezer node always returns the same wrapper.
 */
export function wrapLezerNode(
    lezerNode: LezerNode,
    sourceText: string,
    fieldMap: FieldMap,
    keywordSet: ReadonlySet<string>
): LezerSyntaxNode {
    let wrapper = wrapperCache.get(lezerNode);
    if (!wrapper) {
        wrapper = new LezerSyntaxNode(lezerNode, sourceText, fieldMap, keywordSet);
        wrapperCache.set(lezerNode, wrapper);
    }
    return wrapper;
}

/**
 * Wraps a Lezer Tree's top node as a LezerRootSyntaxNode.
 */
export function wrapLezerTree(
    tree: Tree,
    sourceText: string,
    fieldMap: FieldMap,
    keywordSet: ReadonlySet<string>
): LezerRootSyntaxNode {
    return new LezerRootSyntaxNode(tree.topNode, sourceText, fieldMap, keywordSet);
}

/**
 * Computes line/column Range from byte offsets.
 * Lazily computes a line start offset index on first use.
 */
function computeRange(text: string, offset: number, end: number): Range {
    const startPos = offsetToPosition(text, offset);
    const endPos = offsetToPosition(text, end);
    return { start: startPos, end: endPos };
}

function offsetToPosition(text: string, offset: number): { line: number; character: number } {
    let line = 0;
    let lastLineStart = 0;
    for (let i = 0; i < offset; i++) {
        if (text.charCodeAt(i) === 10) { // '\n'
            line++;
            lastLineStart = i + 1;
        }
    }
    return { line, character: offset - lastLineStart };
}

/**
 * Zero-copy wrapper around Lezer's SyntaxNode implementing Langium's SyntaxNode interface.
 *
 * Design principles:
 * - **Zero-copy**: Wraps Lezer's SyntaxNode directly, no tree conversion.
 * - **Lazy children**: Children are materialized only when `.children` is accessed.
 * - **Cached**: Uses WeakMap for identity (same Lezer node → same wrapper).
 */
export class LezerSyntaxNode implements SyntaxNode {
    /** The wrapped Lezer SyntaxNode. */
    protected readonly lezerNode: LezerNode;
    /** Source text of the entire document (for .text access). */
    protected readonly sourceText: string;
    /** Field map from grammar translation. */
    protected readonly fieldMap: FieldMap;
    /** Set of keyword strings from the grammar. */
    protected readonly keywordSet: ReadonlySet<string>;

    private _children?: readonly SyntaxNode[];
    private _range?: Range;

    constructor(
        lezerNode: LezerNode,
        sourceText: string,
        fieldMap: FieldMap,
        keywordSet: ReadonlySet<string>
    ) {
        this.lezerNode = lezerNode;
        this.sourceText = sourceText;
        this.fieldMap = fieldMap;
        this.keywordSet = keywordSet;
    }

    // --- Type information ---

    get type(): string {
        return this.lezerNode.type.name;
    }

    // --- Positional data ---

    get offset(): number {
        return this.lezerNode.from;
    }

    get end(): number {
        return this.lezerNode.to;
    }

    get length(): number {
        return this.end - this.offset;
    }

    get text(): string {
        return this.sourceText.slice(this.offset, this.end);
    }

    get range(): Range {
        if (!this._range) {
            this._range = computeRange(this.sourceText, this.offset, this.end);
        }
        return this._range;
    }

    // --- Tree structure ---

    get parent(): SyntaxNode | null {
        const p = this.lezerNode.parent;
        return p ? wrapLezerNode(p, this.sourceText, this.fieldMap, this.keywordSet) : null;
    }

    get children(): readonly SyntaxNode[] {
        if (!this._children) {
            const kids: SyntaxNode[] = [];
            // Use cursor with IncludeAnonymous to include keyword literals
            // (Lezer's firstChild/nextSibling skip anonymous leaf nodes by default)
            const cursor = this.lezerNode.cursor(IterMode.IncludeAnonymous);
            if (cursor.firstChild()) {
                do {
                    kids.push(wrapLezerNode(cursor.node, this.sourceText, this.fieldMap, this.keywordSet));
                } while (cursor.nextSibling());
            }
            this._children = kids;
        }
        return this._children;
    }

    // --- Node classification ---

    get isLeaf(): boolean {
        return this.lezerNode.firstChild === null;
    }

    get isHidden(): boolean {
        // In Lezer, @skip tokens (whitespace, comments) do not appear in the parse tree.
        // Anonymous nodes (type.name === "") that ARE in the tree are typically keyword literals.
        // Since all truly hidden tokens are already excluded by Lezer, nothing in the tree is hidden.
        return false;
    }

    get isError(): boolean {
        return this.lezerNode.type.isError;
    }

    get isKeyword(): boolean {
        // With @specialize, keyword nodes have the keyword value as their type name
        // (e.g., type.name === '"model"' for a kw<"model"> node).
        // Check the type name against the keyword set.
        if (!this.isLeaf) return false;
        return this.keywordSet.has(this.lezerNode.type.name);
    }

    get tokenType(): string | undefined {
        if (this.isLeaf) {
            const name = this.lezerNode.type.name;
            return name || undefined;
        }
        return undefined;
    }

    // --- Field access ---

    childForField(name: string): SyntaxNode | undefined {
        const childTypes = this.fieldMap.getChildTypes(this.type, name);
        if (!childTypes) return undefined;
        return this.children.find(c => childTypes.includes(c.type));
    }

    childrenForField(name: string): readonly SyntaxNode[] {
        const childTypes = this.fieldMap.getChildTypes(this.type, name);
        if (!childTypes) return [];
        return this.children.filter(c => childTypes.includes(c.type));
    }
}

/**
 * Root syntax node wrapping the top node of a Lezer parse tree.
 * Adds document-level metadata (fullText, diagnostics).
 */
export class LezerRootSyntaxNode extends LezerSyntaxNode implements RootSyntaxNode {
    private _diagnostics: readonly ParseDiagnostic[] = [];

    get fullText(): string {
        return this.sourceText;
    }

    get diagnostics(): readonly ParseDiagnostic[] {
        return this._diagnostics;
    }

    /**
     * @internal Set diagnostics from parse errors. Called by LezerAdapter.
     */
    setDiagnostics(diagnostics: readonly ParseDiagnostic[]): void {
        this._diagnostics = diagnostics;
    }
}
