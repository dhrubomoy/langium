/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Module } from 'langium-core';
import type { LangiumChevrotainParserServices, LangiumChevrotainServices } from './chevrotain-services.js';
import { createCompletionParser } from './completion-parser-builder.js';
import { createLangiumParser } from './langium-parser-builder.js';
import { LangiumParserErrorMessageProvider } from './langium-parser.js';
import { DefaultLexer, DefaultLexerErrorMessageProvider } from './lexer.js';
import { DefaultTokenBuilder } from './token-builder.js';

/**
 * Creates a dependency injection module configuring the Chevrotain-specific parser services.
 * This must be merged with the core module when using the Chevrotain parser backend.
 */
export function createChevrotainParserModule(): Module<LangiumChevrotainServices, LangiumChevrotainParserServices> {
    return {
        parser: {
            LangiumParser: (services) => createLangiumParser(services),
            CompletionParser: (services) => createCompletionParser(services),
            Lexer: (services) => new DefaultLexer(services),
            TokenBuilder: () => new DefaultTokenBuilder(),
            ParserErrorMessageProvider: () => new LangiumParserErrorMessageProvider(),
            LexerErrorMessageProvider: () => new DefaultLexerErrorMessageProvider(),
        }
    };
}
