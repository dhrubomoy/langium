/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Grammar } from '../languages/generated/ast.js';
import type { RootSyntaxNode } from './syntax-node.js';

/**
 * Interface that each parser backend implements.
 * Registered via DI. The document builder delegates all parsing to this.
 */
export interface ParserAdapter {
    /** Human-readable backend name (e.g., "chevrotain", "lezer", "tree-sitter"). */
    readonly name: string;

    /** Whether this backend supports incremental parsing. */
    readonly supportsIncremental: boolean;

    /**
     * Initialize the parser from a Langium Grammar AST.
     * Called once at startup (or when grammar changes in dev mode).
     *
     * For Chevrotain: wraps the already-built in-memory interpreted parser.
     * For Lezer: loads pre-compiled parse tables (built at CLI time).
     * For Tree-sitter: loads WASM module (built at CLI time).
     */
    configure(grammar: Grammar, config?: ParserAdapterConfig): void;

    /**
     * Parse a document from scratch. Returns the root SyntaxNode.
     */
    parse(text: string, entryRule?: string): AdapterParseResult;

    /**
     * Incremental parse. Only available if supportsIncremental is true.
     *
     * Takes the previous parse state (opaque, backend-specific) and the
     * text changes since the last parse. Returns a new tree that reuses
     * unchanged subtrees from the previous parse.
     */
    parseIncremental?(
        text: string,
        previousState: IncrementalParseState,
        changes: readonly TextChange[]
    ): AdapterParseResult;

    /**
     * Compute tokens expected at a given offset. Used for code completion.
     *
     * Different backends implement this differently:
     * - Chevrotain: computeContentAssist()
     * - Lezer: analyze parse state at position
     * - Tree-sitter: analyze valid tokens from parse table state
     */
    getExpectedTokens(text: string, offset: number): ExpectedToken[];

    /**
     * Release resources (WASM modules, etc.).
     */
    dispose?(): void;
}

/**
 * Result of a parse operation via the adapter.
 * Named `AdapterParseResult` to avoid collision with Langium's existing `ParseResult`.
 */
export interface AdapterParseResult {
    /** Root syntax node of the parsed tree. */
    readonly root: RootSyntaxNode;
    /** Opaque state for incremental re-parse. Store on the LangiumDocument. */
    readonly incrementalState?: IncrementalParseState;
}

/** Opaque — each backend stores whatever it needs for incremental re-parse. */
export type IncrementalParseState = unknown;

/**
 * Describes a text change for incremental parsing.
 */
export interface TextChange {
    /** Start offset in the OLD text. */
    readonly rangeOffset: number;
    /** Number of characters removed from OLD text. */
    readonly rangeLength: number;
    /** New text inserted at rangeOffset. */
    readonly text: string;
}

/**
 * Describes a token expected at a given position. Used for code completion.
 */
export interface ExpectedToken {
    readonly name: string;
    readonly isKeyword: boolean;
    readonly pattern?: RegExp | string;
}

/**
 * Configuration for parser adapter initialization.
 */
export interface ParserAdapterConfig {
    /** Enable error recovery (default: true). */
    recoveryEnabled?: boolean;
    /** Max lookahead for LL parsers. Ignored by LR backends. */
    maxLookahead?: number;
    /** Arbitrary backend-specific config. */
    backendConfig?: Record<string, unknown>;
}
