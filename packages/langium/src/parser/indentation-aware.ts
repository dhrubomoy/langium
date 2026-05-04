/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { IToken, TokenType, TokenVocabulary } from './_chevrotain-types.js';
import type { LangiumCoreServices } from '../services.js';
import type { LexingReport, TokenBuilderOptions } from './token-builder.js';
import type { LexerResult, TokenizeOptions } from './lexer.js';
import type { Grammar } from '../languages/generated/ast.js';
import { DefaultTokenBuilder } from './token-builder.js';
import { DEFAULT_TOKENIZE_OPTIONS, DefaultLexer } from './lexer.js';

/**
 * After the Chevrotain → tree-sitter migration (US-026/US-027) the
 * indentation-aware token builder/lexer no longer have a Chevrotain runtime
 * to drive. The exports remain so that consumers' custom modules continue
 * to type-check; runtime usage now throws.
 */

const REMOVED_MESSAGE = 'Chevrotain-based indentation-aware lexer has been removed; use the tree-sitter pipeline.';

type IndentationAwareDelimiter<TokenName extends string> = [begin: TokenName, end: TokenName];

export interface IndentationTokenBuilderOptions<TerminalName extends string = string, KeywordName extends string = string> {
    /**
     * The name of the token used to denote indentation in the grammar.
     */
    indentTokenName: TerminalName;
    /**
     * The name of the token used to denote deindentation in the grammar.
     */
    dedentTokenName: TerminalName;
    /**
     * The name of the token used to denote whitespace other than indentation and newlines.
     */
    whitespaceTokenName: TerminalName;
    /**
     * The delimiter tokens inside of which indentation should be ignored.
     */
    ignoreIndentationDelimiters: Array<IndentationAwareDelimiter<TerminalName | KeywordName>>
}

export const indentationBuilderDefaultOptions: IndentationTokenBuilderOptions = {
    indentTokenName: 'INDENT',
    dedentTokenName: 'DEDENT',
    whitespaceTokenName: 'WS',
    ignoreIndentationDelimiters: [],
};

export enum LexingMode {
    REGULAR = 'indentation-sensitive',
    IGNORE_INDENTATION = 'ignore-indentation',
}

export interface IndentationLexingReport extends LexingReport {
    /** Dedent tokens that are necessary to close the remaining indents. */
    remainingDedents: IToken[];
}

/**
 * A token builder that is sensitive to indentation in the input text.
 * Stub after Chevrotain removal — runtime methods throw.
 */
export class IndentationAwareTokenBuilder<Terminals extends string = string, KeywordName extends string = string> extends DefaultTokenBuilder {

    readonly options: IndentationTokenBuilderOptions<Terminals, KeywordName>;

    readonly indentTokenType: TokenType = { name: 'INDENT' };
    readonly dedentTokenType: TokenType = { name: 'DEDENT' };

    constructor(options: Partial<IndentationTokenBuilderOptions<NoInfer<Terminals>, NoInfer<KeywordName>>> = indentationBuilderDefaultOptions as IndentationTokenBuilderOptions<Terminals, KeywordName>) {
        super();
        this.options = {
            ...indentationBuilderDefaultOptions as IndentationTokenBuilderOptions<Terminals, KeywordName>,
            ...options,
        };
    }

    override buildTokens(_grammar: Grammar, _options?: TokenBuilderOptions): TokenVocabulary {
        throw new Error(REMOVED_MESSAGE);
    }

    override flushLexingReport(_text: string): IndentationLexingReport {
        return { diagnostics: [], remainingDedents: [] };
    }

    flushRemainingDedents(_text: string): IToken[] {
        return [];
    }
}

/**
 * A lexer that is aware of indentation in the input text.
 * Stub after Chevrotain removal — runtime methods throw.
 */
export class IndentationAwareLexer extends DefaultLexer {

    protected readonly indentationTokenBuilder: IndentationAwareTokenBuilder;

    constructor(services: LangiumCoreServices) {
        super(services);
        if (services.parser.TokenBuilder instanceof IndentationAwareTokenBuilder) {
            this.indentationTokenBuilder = services.parser.TokenBuilder;
        } else {
            throw new Error('IndentationAwareLexer requires an accompanying IndentationAwareTokenBuilder');
        }
    }

    override tokenize(_text: string, _options: TokenizeOptions = DEFAULT_TOKENIZE_OPTIONS): LexerResult {
        throw new Error(REMOVED_MESSAGE);
    }
}
