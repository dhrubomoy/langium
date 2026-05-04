/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { TokenType } from './_chevrotain-types.js';
import type { Range } from 'vscode-languageserver-types';
import type { AbstractElement } from '../languages/generated/ast.js';
import type { AstNode, CompositeCstNode, CstNode, LeafCstNode, RootCstNode } from '../syntax-tree.js';
import { Position } from 'vscode-languageserver-types';

export abstract class AbstractCstNode implements CstNode {
    abstract get offset(): number;
    abstract get length(): number;
    abstract get end(): number;
    abstract get range(): Range;

    container?: CompositeCstNode;
    grammarSource?: AbstractElement;
    root: RootCstNode;
    private _astNode?: AstNode;

    get hidden(): boolean {
        return false;
    }

    get astNode(): AstNode {
        const node = typeof this._astNode?.$type === 'string' ? this._astNode : this.container?.astNode;
        if (!node) {
            throw new Error('This node has no associated AST element');
        }
        return node;
    }

    set astNode(value: AstNode | undefined) {
        this._astNode = value;
    }

    get text(): string {
        return this.root.fullText.substring(this.offset, this.end);
    }
}

export class LeafCstNodeImpl extends AbstractCstNode implements LeafCstNode {
    get offset(): number {
        return this._offset;
    }

    get length(): number {
        return this._length;
    }

    get end(): number {
        return this._offset + this._length;
    }

    override get hidden(): boolean {
        return this._hidden;
    }

    get tokenType(): TokenType {
        return this._tokenType;
    }

    get range(): Range {
        return this._range;
    }

    private _hidden: boolean;
    private _offset: number;
    private _length: number;
    private _range: Range;
    private _tokenType: TokenType;

    constructor(offset: number, length: number, range: Range, tokenType: TokenType, hidden = false) {
        super();
        this._hidden = hidden;
        this._offset = offset;
        this._tokenType = tokenType;
        this._length = length;
        this._range = range;
    }
}

export class CompositeCstNodeImpl extends AbstractCstNode implements CompositeCstNode {
    readonly content: CstNode[] = new CstNodeContainer(this);
    private _rangeCache?: Range;

    get offset(): number {
        return this.firstNonHiddenNode?.offset ?? 0;
    }

    get length(): number {
        return this.end - this.offset;
    }

    get end(): number {
        return this.lastNonHiddenNode?.end ?? 0;
    }

    get range(): Range {
        const firstNode = this.firstNonHiddenNode;
        const lastNode = this.lastNonHiddenNode;
        if (firstNode && lastNode) {
            if (this._rangeCache === undefined) {
                const { range: firstRange } = firstNode;
                const { range: lastRange } = lastNode;
                this._rangeCache = { start: firstRange.start, end: lastRange.end.line < firstRange.start.line ? firstRange.start : lastRange.end };
            }
            return this._rangeCache;
        } else {
            return { start: Position.create(0, 0), end: Position.create(0, 0) };
        }
    }

    private get firstNonHiddenNode(): CstNode | undefined {
        for (const child of this.content) {
            if (!child.hidden) {
                return child;
            }
        }
        return this.content[0];
    }

    private get lastNonHiddenNode(): CstNode | undefined {
        for (let i = this.content.length - 1; i >= 0; i--) {
            const child = this.content[i];
            if (!child.hidden) {
                return child;
            }
        }
        return this.content[this.content.length - 1];
    }
}

class CstNodeContainer extends Array<CstNode> {
    readonly parent: CompositeCstNode;

    constructor(parent: CompositeCstNode) {
        super();
        this.parent = parent;
        Object.setPrototypeOf(this, CstNodeContainer.prototype);
    }

    override push(...items: CstNode[]): number {
        this.addParents(items);
        return super.push(...items);
    }

    override unshift(...items: CstNode[]): number {
        this.addParents(items);
        return super.unshift(...items);
    }

    override splice(start: number, count: number, ...items: CstNode[]): CstNode[] {
        this.addParents(items);
        return super.splice(start, count, ...items);
    }

    private addParents(items: CstNode[]): void {
        for (const item of items) {
            (<AbstractCstNode>item).container = this.parent;
        }
    }
}

export class RootCstNodeImpl extends CompositeCstNodeImpl implements RootCstNode {
    private _text = '';

    override get text(): string {
        return this._text.substring(this.offset, this.end);
    }

    get fullText(): string {
        return this._text;
    }

    constructor(input?: string) {
        super();
        this._text = input ?? '';
    }
}
