/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Range } from 'vscode-languageserver-types';

/**
 * A node in the concrete/parse syntax tree. Backend-agnostic.
 *
 * Each parser backend implements this by wrapping its native tree nodes:
 * - Chevrotain: wraps existing CstNode
 * - Lezer: cursor-based view over Lezer's buffer tree (zero copy)
 * - Tree-sitter: wraps web-tree-sitter SyntaxNode (near 1:1 mapping)
 *
 * Design principles:
 * - No back-pointer to AST (avoids circular references; use positional lookup instead)
 * - No back-pointer to Grammar AST (use type string + grammar lookup instead)
 * - Lazy children (don't inflate the full tree unless walked)
 * - Immutable (parse produces a new tree; old one can be GC'd or reused)
 */
export interface SyntaxNode {
    /** Node type name. Corresponds to the grammar rule or token name. */
    readonly type: string;

    /** Start offset in source text (0-based byte offset). */
    readonly offset: number;

    /** End offset in source text (exclusive). */
    readonly end: number;

    /** Length in bytes (end - offset). */
    readonly length: number;

    /** The source text matched by this node. */
    readonly text: string;

    /** The range in line/column coordinates (for LSP compatibility). */
    readonly range: Range;

    /** Parent node. Null for the root. */
    readonly parent: SyntaxNode | null;

    /** All child nodes (including hidden/whitespace if retained by backend). */
    readonly children: readonly SyntaxNode[];

    /** True if this is a leaf/token node with no children. */
    readonly isLeaf: boolean;

    /** True if this node is a hidden token (whitespace, comment). */
    readonly isHidden: boolean;

    /** True if this node is an error/recovery node. */
    readonly isError: boolean;

    /**
     * Whether this is a keyword token.
     * Backends determine this differently:
     * - Chevrotain: token is in the keyword set / grammarSource is a Keyword
     * - Lezer: anonymous string tokens
     * - Tree-sitter: anonymous nodes matching a string literal
     */
    readonly isKeyword: boolean;

    /**
     * For leaf nodes: the token type name (e.g., "ID", "STRING", "NUMBER").
     * For composite nodes: undefined.
     */
    readonly tokenType: string | undefined;

    /**
     * Get a single named child (by field/assignment name from the grammar).
     * Used by AST builder to map grammar assignments to AST properties.
     *
     * Example: for grammar `Person: 'person' name=ID;`
     *   node.childForField("name") returns the ID leaf node.
     */
    childForField(name: string): SyntaxNode | undefined;

    /**
     * Get all named children for a list field.
     * Example: for grammar `Model: items+=Item*;`
     *   node.childrenForField("items") returns all Item nodes.
     */
    childrenForField(name: string): readonly SyntaxNode[];
}

/**
 * The root syntax node with document-level metadata.
 */
export interface RootSyntaxNode extends SyntaxNode {
    /** The full source text of the document. */
    readonly fullText: string;

    /** All lexer/parser diagnostics from this parse. */
    readonly diagnostics: readonly ParseDiagnostic[];
}

/**
 * A parser diagnostic (lexer error, parse error, recovery).
 */
export interface ParseDiagnostic {
    readonly message: string;
    readonly offset: number;
    readonly length: number;
    readonly severity: 'error' | 'warning';
    readonly source: 'lexer' | 'parser';
}
