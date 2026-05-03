/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Range } from 'vscode-languageserver-types';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { GrammarMetadata, NodeMetadata } from '../generate/grammar-metadata.js';
import { URI } from '../utils/uri-utils.js';
import type { DeclarationInfo, DocumentIndex } from './document-index.js';

/**
 * Service responsible for walking a tree-sitter syntax tree and producing a
 * {@link DocumentIndex} that LSP adapters (Go-to-definition, Find-all-references,
 * Document-symbols, Rename, ...) can read without needing to know anything about
 * tree-sitter internals.
 *
 * The walker is driven entirely by the {@link GrammarMetadata} emitted by the
 * compiler — it has no language-specific knowledge of its own.
 */
export interface IndexBuilder {
    /**
     * Walk the given tree-sitter root node and build a per-document index.
     * @param tree   Root {@link SyntaxNode} of the parsed document.
     * @param metadata Compiler-emitted grammar metadata for the language.
     * @param uri    URI of the document being indexed (parsed via {@link URI.parse}).
     */
    build(tree: SyntaxNode, metadata: GrammarMetadata, uri: string): DocumentIndex;
}

/**
 * Default {@link IndexBuilder} implementation. The declarations walk visits
 * every node in the tree, looks the node's `type` up in
 * {@link GrammarMetadata.nodes}, and — for nodes whose metadata declares a
 * `name` field with operator `'='` — records a {@link DeclarationInfo} keyed by
 * the field's text value.
 */
export class DefaultIndexBuilder implements IndexBuilder {

    build(tree: SyntaxNode, metadata: GrammarMetadata, uri: string): DocumentIndex {
        const index: DocumentIndex = {
            declarations: new Map(),
            references: new Map(),
            diagnostics: []
        };
        this.walk(tree, metadata, URI.parse(uri), index);
        return index;
    }

    protected walk(node: SyntaxNode, metadata: GrammarMetadata, uri: URI, index: DocumentIndex): void {
        const nodeMeta = metadata.nodes[node.type];
        if (nodeMeta) {
            this.collectDeclaration(node, nodeMeta, uri, index);
        }
        for (const child of node.children) {
            if (child) {
                this.walk(child, metadata, uri, index);
            }
        }
    }

    protected collectDeclaration(node: SyntaxNode, nodeMeta: NodeMetadata, uri: URI, index: DocumentIndex): void {
        const nameField = nodeMeta.fields.find(field => field.name === 'name' && field.operator === '=');
        if (!nameField) {
            return;
        }
        const nameChild = node.childForFieldName('name');
        if (!nameChild) {
            return;
        }
        const text = nameChild.text;
        if (typeof text !== 'string' || text.length === 0) {
            return;
        }
        const declaration: DeclarationInfo = {
            name: text,
            nodeType: nodeMeta.nodeType,
            range: toRange(nameChild),
            uri
        };
        const existing = index.declarations.get(text);
        if (existing) {
            existing.push(declaration);
        } else {
            index.declarations.set(text, [declaration]);
        }
    }
}

/**
 * Convert a tree-sitter node's start/end {@link SyntaxNode.startPosition} and
 * {@link SyntaxNode.endPosition} (zero-based row + column) to an LSP
 * {@link Range}.
 */
export function toRange(node: SyntaxNode): Range {
    return {
        start: { line: node.startPosition.row, character: node.startPosition.column },
        end: { line: node.endPosition.row, character: node.endPosition.column }
    };
}
