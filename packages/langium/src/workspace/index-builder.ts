/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Diagnostic, Range } from 'vscode-languageserver-types';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { GrammarMetadata, NodeMetadata } from '../generate/grammar-metadata.js';
import { URI } from '../utils/uri-utils.js';
import type { DeclarationInfo, DocumentIndex, ReferenceInfo } from './document-index.js';

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
 * Default {@link IndexBuilder} implementation. A single recursive walk over the
 * tree visits every node, looks the node's `type` up in
 * {@link GrammarMetadata.nodes}, and — when the matched {@link NodeMetadata}
 * applies — records:
 *
 * - a {@link DeclarationInfo} for every node whose metadata declares a `name`
 *   field with operator `'='`, keyed by the field's text value;
 * - a {@link ReferenceInfo} for every metadata field marked `isRef: true`,
 *   keyed by the referenced child's text value;
 * - a {@link Diagnostic} for every tree-sitter ERROR node and every node the
 *   parser inserted as a recovery (`isMissing`).
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
        this.collectDiagnostics(node, index);
        const nodeMeta = metadata.nodes[node.type];
        if (nodeMeta) {
            this.collectDeclaration(node, nodeMeta, uri, index);
            this.collectReferences(node, nodeMeta, index);
        }
        for (const child of node.children) {
            if (child) {
                this.walk(child, metadata, uri, index);
            }
        }
    }

    protected collectDiagnostics(node: SyntaxNode, index: DocumentIndex): void {
        if (node.type !== 'ERROR' && !node.isMissing) {
            return;
        }
        const { row, column } = node.startPosition;
        const diagnostic: Diagnostic = {
            range: toRange(node),
            severity: DiagnosticSeverity.Error,
            message: `Syntax error at ${row}:${column}`
        };
        index.diagnostics.push(diagnostic);
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

    protected collectReferences(node: SyntaxNode, nodeMeta: NodeMetadata, index: DocumentIndex): void {
        for (const field of nodeMeta.fields) {
            if (!field.isRef) {
                continue;
            }
            const refChild = node.childForFieldName(field.name);
            if (!refChild) {
                continue;
            }
            const text = refChild.text;
            if (typeof text !== 'string' || text.length === 0) {
                continue;
            }
            const reference: ReferenceInfo = {
                name: text,
                range: toRange(refChild)
            };
            const existing = index.references.get(text);
            if (existing) {
                existing.push(reference);
            } else {
                index.references.set(text, [reference]);
            }
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
