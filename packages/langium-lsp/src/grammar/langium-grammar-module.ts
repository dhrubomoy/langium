/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { inject, DocumentState, EmptyFileSystem, AstUtils, URI, GrammarAST } from 'langium-core';
import type { Module, DeepPartial, Grammar, LangiumGeneratedSharedCoreServices, LangiumGeneratedCoreServices, LanguageMetaData, ParserConfig } from 'langium-core';
import { LangiumGrammarGeneratedModule, LangiumGrammarGeneratedSharedModule, LangiumGrammarScopeComputation, LangiumGrammarScopeProvider, LangiumGrammarValidator, registerValidationChecks, LangiumGrammarNameProvider, LangiumGrammarReferences, LangiumGrammarValidationResourcesCollector, LangiumGrammarTypesValidator, registerTypeValidationChecks, interpretAstReflection } from 'langium-core/grammar';
import type { LangiumGrammarDocument } from 'langium-core/grammar';
import type { LangiumServices, LangiumSharedServices, PartialLangiumServices, PartialLangiumSharedServices } from '../lsp/lsp-services.js';
import { LangiumGrammarTypeHierarchyProvider } from './lsp/grammar-type-hierarchy.js';
import { type DefaultSharedModuleContext, createDefaultModule, createDefaultSharedModule } from '../lsp/default-lsp-module.js';
import { LangiumGrammarCodeActionProvider } from './lsp/grammar-code-actions.js';
import { LangiumGrammarCompletionProvider } from './lsp/grammar-completion-provider.js';
import { LangiumGrammarFoldingRangeProvider } from './lsp/grammar-folding-ranges.js';
import { LangiumGrammarFormatter } from './lsp/grammar-formatter.js';
import { LangiumGrammarSemanticTokenProvider } from './lsp/grammar-semantic-tokens.js';
import { LangiumGrammarDefinitionProvider } from './lsp/grammar-definition.js';
import { LangiumGrammarCallHierarchyProvider } from './lsp/grammar-call-hierarchy.js';

export type LangiumGrammarAddedServices = {
    validation: {
        LangiumGrammarValidator: LangiumGrammarValidator,
        ValidationResourcesCollector: LangiumGrammarValidationResourcesCollector,
        LangiumGrammarTypesValidator: LangiumGrammarTypesValidator,
    }
}

export type LangiumGrammarServices = LangiumServices & LangiumGrammarAddedServices;

export const LangiumGrammarModule: Module<LangiumGrammarServices, PartialLangiumServices & LangiumGrammarAddedServices> = {
    validation: {
        LangiumGrammarValidator: (services) => new LangiumGrammarValidator(services),
        ValidationResourcesCollector: (services) => new LangiumGrammarValidationResourcesCollector(services),
        LangiumGrammarTypesValidator: () => new LangiumGrammarTypesValidator(),
    },
    lsp: {
        FoldingRangeProvider: (services) => new LangiumGrammarFoldingRangeProvider(services),
        CodeActionProvider: (services) => new LangiumGrammarCodeActionProvider(services),
        SemanticTokenProvider: (services) => new LangiumGrammarSemanticTokenProvider(services),
        Formatter: () => new LangiumGrammarFormatter(),
        DefinitionProvider: (services) => new LangiumGrammarDefinitionProvider(services),
        CallHierarchyProvider: (services) => new LangiumGrammarCallHierarchyProvider(services),
        TypeHierarchyProvider: (services) => new LangiumGrammarTypeHierarchyProvider(services),
        CompletionProvider: (services) => new LangiumGrammarCompletionProvider(services)
    },
    references: {
        ScopeComputation: (services) => new LangiumGrammarScopeComputation(services),
        ScopeProvider: (services) => new LangiumGrammarScopeProvider(services),
        References: (services) => new LangiumGrammarReferences(services),
        NameProvider: () => new LangiumGrammarNameProvider()
    }
};

/**
 * Creates Langium grammar services, enriched with LSP functionality
 *
 * @param context Shared module context, used to create additional shared modules
 * @param sharedModule Existing shared module to inject together with new shared services
 * @param module Additional/modified service implementations for the language services
 * @returns Shared services enriched with LSP services + Grammar services, per usual
 */
export function createLangiumGrammarServices(context: DefaultSharedModuleContext,
    sharedModule?: Module<LangiumSharedServices, PartialLangiumSharedServices>,
    module?: Module<LangiumGrammarServices, DeepPartial<LangiumServices & LangiumGrammarAddedServices>>): {
    shared: LangiumSharedServices,
    grammar: LangiumGrammarServices
} {
    const shared = inject(
        createDefaultSharedModule(context),
        LangiumGrammarGeneratedSharedModule,
        sharedModule
    );
    const grammar = inject(
        createDefaultModule({ shared }),
        LangiumGrammarGeneratedModule,
        LangiumGrammarModule,
        module
    );
    addTypeCollectionPhase(shared, grammar);
    shared.ServiceRegistry.register(grammar);

    registerValidationChecks(grammar);
    registerTypeValidationChecks(grammar);

    if (!context.connection) {
        // We don't run inside a language server
        // Therefore, initialize the configuration provider instantly
        shared.workspace.ConfigurationProvider.initialized({});
    }

    return { shared, grammar };
}

function addTypeCollectionPhase(sharedServices: LangiumSharedServices, grammarServices: LangiumGrammarServices) {
    const documentBuilder = sharedServices.workspace.DocumentBuilder;
    documentBuilder.onDocumentPhase(DocumentState.IndexedReferences, async document => {
        const typeCollector = grammarServices.validation.ValidationResourcesCollector;
        const grammar = document.parseResult.value as Grammar;
        (document as LangiumGrammarDocument).validationResources = typeCollector.collectValidationResources(grammar);
    });
}

/**
 * Create a set of language services for the given grammar. This is useful for testing or for
 * building services from a dynamically loaded or interpreted grammar.
 *
 * @param config Configuration object containing the grammar and optional overrides.
 * @returns A promise that resolves to the fully configured language services.
 */
export async function createServicesForGrammar<L extends LangiumServices = LangiumServices, S extends LangiumSharedServices = LangiumSharedServices>(config: {
    grammar: string | GrammarAST.Grammar,
    grammarServices?: LangiumGrammarServices,
    parserConfig?: ParserConfig,
    languageMetaData?: LanguageMetaData,
    module?: Module<L, unknown>
    sharedModule?: Module<S, unknown>
}): Promise<L> {
    const grammarServices = config.grammarServices ?? createLangiumGrammarServices(EmptyFileSystem).grammar;
    const uri = URI.parse('memory:/grammar.langium');
    const factory = grammarServices.shared.workspace.LangiumDocumentFactory;
    const grammarDocument = typeof config.grammar === 'string'
        ? factory.fromString(config.grammar, uri)
        : AstUtils.getDocument(config.grammar);
    const grammarNode = grammarDocument.parseResult.value as GrammarAST.Grammar;
    const documentBuilder = grammarServices.shared.workspace.DocumentBuilder;
    await documentBuilder.build([grammarDocument], { validation: false });

    const parserConfig = config.parserConfig ?? {};
    const languageMetaData = config.languageMetaData ?? {
        caseInsensitive: false,
        fileExtensions: ['.txt'],
        languageId: grammarNode.name ?? 'UNKNOWN',
        mode: 'development'
    };
    const generatedSharedModule: Module<LangiumGeneratedSharedCoreServices> = {
        AstReflection: () => interpretAstReflection(grammarNode),
    };
    const generatedModule: Module<LangiumGeneratedCoreServices> = {
        Grammar: () => grammarNode,
        LanguageMetaData: () => languageMetaData,
        parser: {
            ParserConfig: () => parserConfig
        }
    };
    const shared = inject(createDefaultSharedModule(EmptyFileSystem), generatedSharedModule, config.sharedModule);
    const services = inject(createDefaultModule({ shared }), generatedModule, config.module);
    shared.ServiceRegistry.register(services);
    return services;
}
