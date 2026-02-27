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
 * Usage:
 * ```typescript
 * const services = inject(
 *     createDefaultCoreModule({ shared }),
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
        }
    };
}
