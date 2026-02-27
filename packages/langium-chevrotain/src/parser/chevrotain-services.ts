/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { IParserErrorMessageProvider, ILexerErrorMessageProvider } from 'chevrotain';
import type { LangiumCoreServices } from 'langium-core';
import type { LangiumCompletionParser, LangiumParser } from './langium-parser.js';
import type { Lexer } from './lexer.js';
import type { TokenBuilder } from './token-builder.js';

/**
 * Chevrotain-specific parser services that extend the core services.
 * These are only available when using the Chevrotain parser backend.
 */
export type LangiumChevrotainParserServices = {
    readonly parser: {
        readonly LangiumParser: LangiumParser
        readonly CompletionParser: LangiumCompletionParser
        readonly Lexer: Lexer
        readonly TokenBuilder: TokenBuilder
        readonly ParserErrorMessageProvider: IParserErrorMessageProvider
        readonly LexerErrorMessageProvider: ILexerErrorMessageProvider
    }
}

/**
 * Full services type for Chevrotain-based language implementations.
 * Combines core services with Chevrotain-specific parser services.
 */
export type LangiumChevrotainServices = LangiumCoreServices & LangiumChevrotainParserServices;
