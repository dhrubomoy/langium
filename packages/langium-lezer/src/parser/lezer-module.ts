/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Module } from 'langium-core';
import type { LangiumLezerParserServices, LangiumLezerServices } from './lezer-services.js';
import { LezerAdapter } from './lezer-adapter.js';
import { LezerGrammarTranslator } from './lezer-grammar-translator.js';

/**
 * Creates a dependency injection module configuring the Lezer-specific parser services.
 * This must be merged with the core module when using the Lezer parser backend.
 *
 * When used alongside `createDefaultModule()` (which bundles Chevrotain services),
 * this module explicitly nulls out Chevrotain-specific services (`LangiumParser`,
 * `CompletionParser`, `Lexer`, `TokenBuilder`) so the document factory and async
 * parser correctly use the Lezer-based `ParserAdapter` path instead of the Chevrotain
 * fast path.
 *
 * Usage:
 * ```typescript
 * const services = inject(
 *     createDefaultModule({ shared }),
 *     createLezerParserModule(),
 *     MyLanguageModule
 * );
 * ```
 */
export function createLezerParserModule(): Module<LangiumLezerServices, LangiumLezerParserServices> {
    return {
        parser: {
            ParserAdapter: () => new LezerAdapter(),
            GrammarTranslator: () => new LezerGrammarTranslator(),
            // Null out Chevrotain-specific services so the document factory
            // uses the ParserAdapter path (not the LangiumParser fast path).
            // These may be present when createDefaultModule() is used.
            LangiumParser: () => undefined,
            CompletionParser: () => undefined,
            Lexer: () => undefined,
            TokenBuilder: () => undefined,
        }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}
