/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { ILexerErrorMessageProvider, ILexingError, IMultiModeLexerDefinition, IToken, TokenType, TokenTypeDictionary, TokenVocabulary } from './_chevrotain-types.js';
import type { LangiumCoreServices } from '../services.js';
import type { LexingReport, TokenBuilder } from './token-builder.js';

/**
 * After the Chevrotain → tree-sitter migration (US-026/US-027), the legacy
 * Chevrotain-backed Langium parser is no longer the runtime parser.
 * This module retains the public interfaces (`Lexer`, `LexerResult`,
 * `DefaultLexer`, ...) so existing imports continue to type-check, but the
 * runtime implementations now throw — consumers should migrate to the
 * tree-sitter pipeline in `parser/wasm-loader.ts` and the LSP adapters in
 * `lsp/tree-sitter-*-provider.ts`.
 */

const REMOVED_MESSAGE = 'Chevrotain-based lexer has been removed; use the tree-sitter pipeline (WasmLoader, IndexBuilder).';

export class DefaultLexerErrorMessageProvider implements ILexerErrorMessageProvider {

    buildUnexpectedCharactersMessage(_fullText: string, _startOffset: number, _length: number, _line?: number, _column?: number): string {
        return 'Unexpected characters';
    }

    buildUnableToPopLexerModeMessage(_token: IToken): string {
        return 'Unable to pop lexer mode';
    }
}

export interface LexerResult {
    /**
     * A list of all tokens that were lexed from the input.
     *
     * Note that Langium requires the optional properties
     * `startLine`, `startColumn`, `endOffset`, `endLine` and `endColumn` to be set on each token.
     */
    tokens: IToken[];
    /**
     * Contains hidden tokens, usually comments.
     */
    hidden: IToken[];
    errors: ILexingError[];
    report?: LexingReport;
}

export type TokenizeMode = 'full' | 'partial';

export interface TokenizeOptions {
    mode?: TokenizeMode;
}

export const DEFAULT_TOKENIZE_OPTIONS: TokenizeOptions = { mode: 'full' };

export interface Lexer {
    readonly definition: TokenTypeDictionary;
    tokenize(text: string, options?: TokenizeOptions): LexerResult;
}

export class DefaultLexer implements Lexer {

    protected readonly tokenBuilder: TokenBuilder;
    protected readonly errorMessageProvider: ILexerErrorMessageProvider;

    constructor(services: LangiumCoreServices) {
        this.errorMessageProvider = services.parser.LexerErrorMessageProvider;
        this.tokenBuilder = services.parser.TokenBuilder;
    }

    get definition(): TokenTypeDictionary {
        return {};
    }

    tokenize(_text: string, _options: TokenizeOptions = DEFAULT_TOKENIZE_OPTIONS): LexerResult {
        throw new Error(REMOVED_MESSAGE);
    }
}

/**
 * Returns a check whether the given TokenVocabulary is TokenType array
 */
export function isTokenTypeArray(tokenVocabulary: TokenVocabulary): tokenVocabulary is TokenType[] {
    return Array.isArray(tokenVocabulary) && (tokenVocabulary.length === 0 || 'name' in tokenVocabulary[0]);
}

/**
 * Returns a check whether the given TokenVocabulary is IMultiModeLexerDefinition
 */
export function isIMultiModeLexerDefinition(tokenVocabulary: TokenVocabulary): tokenVocabulary is IMultiModeLexerDefinition {
    return Boolean(tokenVocabulary) && typeof tokenVocabulary === 'object' && 'modes' in tokenVocabulary && 'defaultMode' in tokenVocabulary;
}

/**
 * Returns a check whether the given TokenVocabulary is TokenTypeDictionary
 */
export function isTokenTypeDictionary(tokenVocabulary: TokenVocabulary): tokenVocabulary is TokenTypeDictionary {
    return !isTokenTypeArray(tokenVocabulary) && !isIMultiModeLexerDefinition(tokenVocabulary);
}
