/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Module, LangiumCoreServices } from 'langium-core';
import { createGrammarConfig } from 'langium-core';
import type { LangiumLezerParserServices, LangiumLezerServices } from './lezer-services.js';
import { LezerAdapter } from './lezer-adapter.js';
import { LezerGrammarTranslator } from './lezer-grammar-translator.js';

/**
 * Mapping from Langium terminal names to Lezer node type names.
 * The Lezer grammar translator renames terminals using conventions from
 * the CodeMirror/Lezer ecosystem (e.g., ML_COMMENT → BlockComment).
 * This map ensures services like CommentProvider can find comment nodes
 * in the Lezer tree by their actual type names.
 */
const LANGIUM_TO_LEZER_TERMINAL_NAMES: Record<string, string> = {
    'WS': 'whitespace',
    'ML_COMMENT': 'BlockComment',
    'SL_COMMENT': 'LineComment',
    'ID': 'Identifier',
    'INT': 'Number',
    'NUMBER': 'Number',
    'STRING': 'String',
};

/**
 * Creates a dependency injection module configuring the Lezer-specific parser services.
 * Merge this with `createDefaultModule()` (from langium-lsp) to get a fully configured
 * Lezer-backed language implementation.
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
            GrammarConfig: (services: LangiumCoreServices) => {
                const config = createGrammarConfig(services);
                // Map Langium terminal names to Lezer tree type names so that
                // CommentProvider can find comment nodes in the Lezer parse tree.
                config.multilineCommentRules = config.multilineCommentRules.map(
                    name => LANGIUM_TO_LEZER_TERMINAL_NAMES[name] ?? name
                );
                return config;
            },
        }
    };
}
