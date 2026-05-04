/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

/**
 * Local stand-in types for the few Chevrotain types that the public Langium
 * API surface still references after the Chevrotain → tree-sitter migration
 * (US-026/US-027).
 *
 * These exist purely so the public types in `syntax-tree.ts`, `services.ts`
 * etc. continue to compile after the `chevrotain` package was removed.
 * The runtime parser is now the tree-sitter pipeline; consumers that still
 * relied on these chevrotain-shaped types should migrate to the new
 * `DocumentIndex` API exported from `langium/workspace/document-index`.
 */

/** Replacement for chevrotain's `IToken`. */
export interface IToken {
    image: string;
    startOffset: number;
    endOffset?: number;
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
    tokenTypeIdx?: number;
    tokenType: TokenType;
}

/** Replacement for chevrotain's `TokenType`. */
export interface TokenType {
    name: string;
    PATTERN?: unknown;
    GROUP?: string;
    LINE_BREAKS?: boolean;
    LONGER_ALT?: TokenType | TokenType[];
    PUSH_MODE?: string;
    POP_MODE?: boolean;
    CATEGORIES?: TokenType[];
    [key: string]: unknown;
}

/** Replacement for chevrotain's `IParserConfig`. */
export interface IParserConfig {
    recoveryEnabled?: boolean;
    maxLookahead?: number;
    nodeLocationTracking?: 'full' | 'onlyOffset' | 'none';
    skipValidations?: boolean;
    [key: string]: unknown;
}

/** Replacement for chevrotain's `ILexingError`. */
export interface ILexingError {
    offset: number;
    line?: number;
    column?: number;
    length: number;
    message: string;
}

/** Replacement for chevrotain's `IRecognitionException`. */
export interface IRecognitionException {
    name: string;
    message: string;
    token: IToken;
    resyncedTokens?: IToken[];
    context?: unknown;
    previousToken?: IToken;
}

/** Replacement for chevrotain's `MismatchedTokenException`. */
export interface MismatchedTokenException extends IRecognitionException {
    previousToken: IToken;
}

/** Replacement for chevrotain's `IParserErrorMessageProvider`. */
export interface IParserErrorMessageProvider {
    buildMismatchTokenMessage?(options: unknown): string;
    buildNotAllInputParsedMessage?(options: unknown): string;
    buildNoViableAltMessage?(options: unknown): string;
    buildEarlyExitMessage?(options: unknown): string;
}

/** Replacement for chevrotain's `ILexerErrorMessageProvider`. */
export interface ILexerErrorMessageProvider {
    buildUnexpectedCharactersMessage?(
        fullText: string,
        startOffset: number,
        length: number,
        line?: number,
        column?: number
    ): string;
    buildUnableToPopLexerModeMessage?(token: IToken): string;
}

/** Replacement for chevrotain's `TokenTypeDictionary`. */
export interface TokenTypeDictionary {
    [tokenName: string]: TokenType;
}

/** Replacement for chevrotain's `IMultiModeLexerDefinition`. */
export interface IMultiModeLexerDefinition {
    modes: { [modeName: string]: TokenType[] };
    defaultMode: string;
}

/** Replacement for chevrotain's `TokenVocabulary`. */
export type TokenVocabulary = TokenType[] | TokenTypeDictionary | IMultiModeLexerDefinition;

/** Replacement for chevrotain's `CustomPatternMatcherFunc`. */
export type CustomPatternMatcherFunc = (
    text: string,
    offset: number,
    tokens?: IToken[],
    groups?: { [groupName: string]: IToken[] }
) => RegExpExecArray | null;

/** Replacement for chevrotain's `TokenPattern`. */
export type TokenPattern = string | RegExp | CustomPatternMatcherFunc;

/** Replacement for chevrotain's `IOrAlt`. */
export interface IOrAlt<TS = unknown> {
    GATE?: () => boolean;
    ALT: () => TS;
    NAME?: string;
    IGNORE_AMBIGUITIES?: boolean;
}

/** Replacement for chevrotain's `IRuleConfig`. */
export interface IRuleConfig<T = unknown> {
    recoveryValueFunc?: () => T;
    resyncEnabled?: boolean;
}

/** Replacement for chevrotain's `SubruleMethodOpts`. */
export interface SubruleMethodOpts<ARGS = unknown[]> {
    LABEL?: string;
    ARGS?: ARGS;
}

/** Replacement for chevrotain's `DSLMethodOpts`. */
export interface DSLMethodOpts<T = unknown> {
    NAME?: string;
    DEF: () => T;
    GATE?: () => boolean;
}

/** Replacement for chevrotain's `ParserMethod`. */
export type ParserMethod<ARGS extends unknown[] = unknown[], R = unknown> = (...args: ARGS) => R;
