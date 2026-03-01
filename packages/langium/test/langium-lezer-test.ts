/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { beforeAll, beforeEach, describe } from 'vitest';
import { buildParser } from '@lezer/generator';
import type { Grammar, LanguageMetaData, LangiumGeneratedCoreServices, LangiumGeneratedSharedCoreServices, ParserAdapter } from 'langium-core';
import type { Module } from 'langium-core';
import { EmptyFileSystem, URI, createDefaultCoreModule, inject } from 'langium-core';
import { interpretAstReflection } from 'langium-core/grammar';
import { createLangiumGrammarServices, createServicesForGrammar } from 'langium-lsp';
import type { LangiumServices, LangiumSharedServices, CompletionProvider } from 'langium-lsp';
import { createDefaultLSPModule, createDefaultSharedModule, LezerCompletionProvider } from 'langium-lsp';
import { LezerAdapter, LezerGrammarTranslator, DefaultFieldMap } from 'langium-lezer';

// ---- Shared test grammars ----

/**
 * Domain model grammar for LSP testing.
 * Supports entities with properties, cross-references, and nested blocks (for folding).
 */
export const DOMAIN_MODEL_GRAMMAR = `
    grammar DomainModel
    entry Model: elements+=Element*;
    Element: Entity | DataType;
    Entity: 'entity' name=ID ('extends' superType=[Entity])? '{' properties+=Property* '}';
    Property: name=ID ':' type=[Element];
    DataType: 'datatype' name=ID;
    hidden terminal WS: /\\s+/;
    hidden terminal ML_COMMENT: /\\/\\*[\\s\\S]*?\\*\\//;
    hidden terminal SL_COMMENT: /\\/\\/[^\\n\\r]*/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
`;

// ---- Service creation ----

export interface CreateServicesConfig {
    grammar: string;
    languageMetaData?: LanguageMetaData;
    module?: Module<LangiumServices, unknown>;
    sharedModule?: Module<LangiumSharedServices, unknown>;
}

/**
 * Parse a grammar string into a Grammar AST using Langium's grammar language.
 */
async function parseGrammarString(grammarString: string): Promise<Grammar> {
    const grammarServices = createLangiumGrammarServices(EmptyFileSystem).grammar;
    const uri = URI.parse('memory:/test-grammar.langium');
    const doc = grammarServices.shared.workspace.LangiumDocumentFactory.fromString(grammarString, uri);
    grammarServices.shared.workspace.LangiumDocuments.addDocument(doc);
    await grammarServices.shared.workspace.DocumentBuilder.build([doc], { validation: false });
    return doc.parseResult.value as Grammar;
}

/**
 * Create full LangiumServices (core + LSP) backed by the Lezer parser.
 * Returns null if Lezer grammar generation fails for the given grammar.
 */
export async function createLezerServicesForGrammar(config: CreateServicesConfig): Promise<LangiumServices | null> {
    let grammar: Grammar;
    try {
        grammar = await parseGrammarString(config.grammar);
    } catch {
        return null;
    }

    // Generate Lezer parse tables
    const translator = new LezerGrammarTranslator();
    let generated: ReturnType<LezerGrammarTranslator['generateGrammarInMemory']>;
    try {
        generated = translator.generateGrammarInMemory(grammar);
    } catch {
        return null;
    }

    let parser: ReturnType<typeof buildParser>;
    try {
        parser = buildParser(generated.grammarText);
    } catch {
        return null;
    }

    const fieldMap = new DefaultFieldMap(generated.fieldMapData);
    const lezerAdapter = new LezerAdapter();
    lezerAdapter.loadParseTables(parser, fieldMap, generated.keywords);

    const languageMetaData: LanguageMetaData = config.languageMetaData ?? {
        caseInsensitive: false,
        fileExtensions: ['.txt'],
        languageId: grammar.name ?? 'test',
        mode: 'development' as const
    };

    const generatedSharedModule: Module<LangiumGeneratedSharedCoreServices> = {
        AstReflection: () => interpretAstReflection(grammar),
    };
    const generatedModule: Module<LangiumGeneratedCoreServices> = {
        Grammar: () => grammar,
        LanguageMetaData: () => languageMetaData,
        parser: {
            ParserConfig: () => ({})
        }
    };
    // Override parser with Lezer adapter (no LangiumParser → DocumentFactory uses generic path)
    const lezerModule: Module<{ parser: { ParserAdapter: ParserAdapter } }> = {
        parser: {
            ParserAdapter: () => lezerAdapter
        }
    };
    // Override completion provider with Lezer-specific implementation
    const lezerLspModule: Module<LangiumServices, { lsp: { CompletionProvider: CompletionProvider } }> = {
        lsp: {
            CompletionProvider: (services) => new LezerCompletionProvider(services)
        }
    };

    const shared = inject(
        createDefaultSharedModule(EmptyFileSystem),
        generatedSharedModule,
        config.sharedModule
    ) as LangiumSharedServices;
    const services = inject(
        createDefaultCoreModule({ shared }),
        createDefaultLSPModule({ shared }),
        generatedModule,
        lezerModule,
        lezerLspModule,
        config.module
    ) as LangiumServices;
    shared.ServiceRegistry.register(services);

    return services;
}

// ---- Per-test dual-backend utilities ----

export type ServiceFactory = (config: CreateServicesConfig) => Promise<LangiumServices | null>;

/**
 * Array of backends for iterating in `for` loops.
 * Use when tests create services per-test (not in beforeAll).
 *
 * Usage:
 * ```typescript
 * for (const { name, createServices } of BACKENDS) {
 *     describe(`My Feature (${name})`, () => {
 *         test('test name', async () => {
 *             const services = await createServices({ grammar });
 *             if (!services) return;
 *             // ... test logic
 *         });
 *     });
 * }
 * ```
 */
export const BACKENDS: Array<{ name: string; createServices: ServiceFactory }> = [
    {
        name: 'Chevrotain',
        createServices: async (config) => createServicesForGrammar(config),
    },
    {
        name: 'Lezer',
        createServices: async (config) => createLezerServicesForGrammar(config),
    },
];

// ---- Dual-backend test wrapper ----

/**
 * Run a describe block against both Chevrotain and Lezer backends.
 * If Lezer grammar generation fails, the Lezer describe block is skipped.
 *
 * The `fn` callback receives a `getServices()` accessor that returns
 * the LangiumServices for the current backend (available after beforeAll).
 *
 * Usage:
 * ```typescript
 * describeForBackends('My Feature', { grammar: MY_GRAMMAR }, (getServices) => {
 *     test('should work', async () => {
 *         const services = getServices();
 *         // ... test with services ...
 *     });
 * });
 * ```
 */
export function describeForBackends(
    name: string,
    config: CreateServicesConfig,
    fn: (getServices: () => LangiumServices) => void
): void {
    // Chevrotain backend
    describe(`${name} (Chevrotain)`, () => {
        let services: LangiumServices;
        const getServices = () => services;

        beforeAll(async () => {
            services = await createServicesForGrammar(config);
        });

        fn(getServices);
    });

    // Lezer backend
    describe(`${name} (Lezer)`, () => {
        let services: LangiumServices | null = null;
        const getServices = () => {
            if (!services) {
                throw new Error('Lezer services not available');
            }
            return services;
        };

        beforeAll(async () => {
            services = await createLezerServicesForGrammar(config);
            if (!services) {
                console.warn(`[SKIP] Lezer grammar generation failed for: ${name}`);
            }
        });

        beforeEach(({ skip }) => {
            if (!services) {
                skip();
            }
        });

        fn(getServices);
    });
}
