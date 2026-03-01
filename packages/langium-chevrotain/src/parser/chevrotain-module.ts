/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Module } from 'langium-core';
import type { LangiumChevrotainParserServices, LangiumChevrotainServices } from './chevrotain-services.js';
import { ChevrotainAdapter } from './chevrotain-adapter.js';
import { createCompletionParser } from './completion-parser-builder.js';
import { createLangiumParser } from './langium-parser-builder.js';
import { LangiumParserErrorMessageProvider } from './langium-parser.js';
import { DefaultLexer, DefaultLexerErrorMessageProvider } from './lexer.js';
import { DefaultTokenBuilder } from './token-builder.js';
import { DefaultHydrator } from '../serializer/hydrator.js';

/**
 * Creates a dependency injection module configuring the Chevrotain-specific parser services.
 * This provides only the Chevrotain parser internals (LangiumParser, Lexer, TokenBuilder, etc.)
 * without the adapter or serializer services. For a complete Chevrotain backend module,
 * use {@link createChevrotainModule} instead.
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

/**
 * Creates a complete Chevrotain backend module including parser, adapter, and serializer services.
 * Merge this with `createDefaultModule()` (from langium-lsp) to get a fully configured
 * Chevrotain-backed language implementation.
 *
 * Usage:
 * ```typescript
 * const services = inject(
 *     createDefaultModule({ shared }),
 *     createChevrotainModule(),
 *     MyLanguageGeneratedModule,
 *     MyLanguageModule
 * );
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createChevrotainModule(): Module<any, any> {
    return {
        parser: {
            LangiumParser: (services) => createLangiumParser(services),
            CompletionParser: (services) => createCompletionParser(services),
            Lexer: (services) => new DefaultLexer(services),
            TokenBuilder: () => new DefaultTokenBuilder(),
            ParserErrorMessageProvider: () => new LangiumParserErrorMessageProvider(),
            LexerErrorMessageProvider: () => new DefaultLexerErrorMessageProvider(),
            ParserAdapter: (services) => new ChevrotainAdapter(services),
        },
        serializer: {
            Hydrator: (services) => new DefaultHydrator(services),
        }
    };
}
