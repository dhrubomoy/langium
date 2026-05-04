/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { ILexingError, TokenVocabulary } from './_chevrotain-types.js';
import type { Grammar } from '../languages/generated/ast.js';

/**
 * After the Chevrotain → tree-sitter migration (US-026/US-027), the legacy
 * Chevrotain-backed token builder is no longer the runtime backbone.
 * This module retains the `TokenBuilder` / `LexingReport` / `LexingDiagnostic`
 * interfaces and a `DefaultTokenBuilder` stub so existing imports continue
 * to type-check; the runtime implementation now throws — consumers should
 * migrate to the tree-sitter pipeline.
 */

export interface TokenBuilderOptions {
    caseInsensitive?: boolean
}

export interface TokenBuilder {
    buildTokens(grammar: Grammar, options?: TokenBuilderOptions): TokenVocabulary;
    /**
     * Produces a lexing report for the given text that was just tokenized using the tokens provided by this builder.
     *
     * @param text The text that was tokenized.
     */
    flushLexingReport?(text: string): LexingReport;
}

/**
 * A custom lexing report that can be produced by the token builder during the lexing process.
 * Adopters need to ensure that the any custom fields are serializable so they can be sent across worker threads.
 */
export interface LexingReport {
    diagnostics: LexingDiagnostic[];
}

export type LexingDiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface LexingDiagnostic extends ILexingError {
    severity?: LexingDiagnosticSeverity;
}

export class DefaultTokenBuilder implements TokenBuilder {

    buildTokens(_grammar: Grammar, _options?: TokenBuilderOptions): TokenVocabulary {
        throw new Error('Chevrotain-based token builder has been removed; use the tree-sitter pipeline.');
    }

    flushLexingReport(_text: string): LexingReport {
        return { diagnostics: [] };
    }
}
