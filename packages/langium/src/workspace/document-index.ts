/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Diagnostic, Range } from 'vscode-languageserver-types';
import type { URI } from '../utils/uri-utils.js';

/**
 * Information about a single named declaration discovered while walking a
 * tree-sitter syntax tree. Produced by the runtime IndexBuilder using the
 * grammar metadata emitted by the compiler.
 */
export interface DeclarationInfo {
    /** The declared name as it appears in the source text. */
    name: string;
    /** Tree-sitter / AST node type that declared the name (e.g. `Definition`). */
    nodeType: string;
    /** Source range of the name token, in LSP coordinates (zero-based). */
    range: Range;
    /** URI of the document the declaration lives in. */
    uri: URI;
}

/**
 * Information about a single cross-reference (an identifier that points to a
 * declaration). Produced for fields whose grammar metadata is marked
 * `isRef: true`.
 */
export interface ReferenceInfo {
    /** The referenced name as it appears in the source text. */
    name: string;
    /** Source range of the reference token, in LSP coordinates (zero-based). */
    range: Range;
    /**
     * URI of the document that owns the *target* declaration once linked.
     * Left undefined for unresolved references.
     */
    targetUri?: URI;
}

/**
 * Per-document index produced from a parsed tree-sitter tree.
 *
 * `declarations` and `references` are keyed by *name* so that LSP adapters
 * (Go-to-definition, Find-all-references, Rename, ...) can do cheap lookups
 * without re-walking the syntax tree. `diagnostics` is the flat list of all
 * parse-error / unresolved-reference diagnostics for the document.
 */
export interface DocumentIndex {
    /** Map of declaration name → all declarations of that name in the document. */
    declarations: Map<string, DeclarationInfo[]>;
    /** Map of reference name → all references to that name in the document. */
    references: Map<string, ReferenceInfo[]>;
    /** Diagnostics produced during index construction (parse errors, etc.). */
    diagnostics: Diagnostic[];
}

/**
 * Workspace-wide index: the IndexBuilder returns one of these per call,
 * keyed by document URI string.
 */
export type DocumentIndexMap = Map<string, DocumentIndex>;
