/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { AstNode } from '../syntax-tree.js';

/**
 * Backend-agnostic token shape used in parse error reporting.
 * Chevrotain's `IToken` is a structural supertype of this interface.
 */
export interface ErrorToken {
    image: string;
    startOffset: number;
    startLine?: number;
    startColumn?: number;
    endOffset?: number;
    endLine?: number;
    endColumn?: number;
}

/**
 * Backend-agnostic parser error. Structurally compatible with Chevrotain's `IRecognitionException`.
 */
export interface ParseError {
    message: string;
    token: ErrorToken;
    previousToken?: ErrorToken;
    name?: string;
}

/**
 * Backend-agnostic lexer error. Structurally compatible with Chevrotain's `ILexingError`.
 */
export interface LexError {
    offset: number;
    line?: number;
    column?: number;
    length: number;
    message: string;
}

export type LexDiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

/**
 * Backend-agnostic lexer diagnostic. Extends LexError with severity.
 */
export interface LexDiagnostic extends LexError {
    severity?: LexDiagnosticSeverity;
}

/**
 * Backend-agnostic lexing report.
 */
export interface LexReport {
    diagnostics: LexDiagnostic[];
}

/**
 * Result of a parse operation.
 */
export type ParseResult<T = AstNode> = {
    value: T;
    parserErrors: ParseError[];
    lexerErrors: LexError[];
    lexerReport?: LexReport;
}

/**
 * Options for the parser.
 */
export interface ParserOptions {
    rule?: string;
}

/**
 * Backend-agnostic parser configuration.
 * Chevrotain's `IParserConfig` is a structural supertype of this interface.
 */
export interface ParserConfig {
    maxLookahead?: number;
}
