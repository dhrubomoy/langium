/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { LangiumCoreServices, ParserAdapter, GrammarTranslator } from 'langium-core';

/**
 * Lezer-specific parser services that extend the core services.
 * These are only available when using the Lezer parser backend.
 */
export type LangiumLezerParserServices = {
    readonly parser: {
        readonly ParserAdapter: ParserAdapter
        readonly GrammarTranslator: GrammarTranslator
    }
};

/**
 * Full services type for Lezer-based language implementations.
 * Combines core services with Lezer-specific parser services.
 */
export type LangiumLezerServices = LangiumCoreServices & LangiumLezerParserServices;
