/******************************************************************************
 * Copyright 2023 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
******************************************************************************/

import type { Connection } from 'vscode-languageserver';
import { createDefaultCoreModule, createDefaultSharedCoreModule, Module, TextDocument, DefaultAsyncParser, setGrammarServicesFactory, inject, EmptyFileSystem } from 'langium-core';
import type { DefaultCoreModuleContext, DefaultSharedCoreModuleContext, LangiumDefaultCoreServices, LangiumDefaultSharedCoreServices, LangiumCoreServices, LangiumSharedCoreServices } from 'langium-core';
import type { LangiumChevrotainServices } from 'langium-chevrotain';
import { createChevrotainParserModule, ChevrotainAdapter, DefaultHydrator } from 'langium-chevrotain';
import { DefaultCompletionProvider } from './completion/completion-provider.js';
import { DefaultDefinitionProvider } from './definition-provider.js';
import { DefaultDocumentHighlightProvider } from './document-highlight-provider.js';
import { DefaultDocumentSymbolProvider } from './document-symbol-provider.js';
import { DefaultDocumentUpdateHandler } from './document-update-handler.js';
import { DefaultFoldingRangeProvider } from './folding-range-provider.js';
import { DefaultFuzzyMatcher } from './fuzzy-matcher.js';
import { MultilineCommentHoverProvider } from './hover-provider.js';
import { DefaultLanguageServer } from './language-server.js';
import type { LangiumLSPServices, LangiumServices, LangiumSharedLSPServices, LangiumSharedServices } from './lsp-services.js';
import { DefaultNodeKindProvider } from './node-kind-provider.js';
import { DefaultReferencesProvider } from './references-provider.js';
import { DefaultRenameProvider } from './rename-provider.js';
import { DefaultWorkspaceSymbolProvider } from './workspace-symbol-provider.js';
import { NormalizedNotebookDocuments, NormalizedTextDocuments } from './normalized-text-documents.js';

/**
 * Context required for creating the default language-specific dependency injection module.
 */
export interface DefaultModuleContext extends DefaultCoreModuleContext {
    readonly shared: LangiumSharedServices;
}

/**
 * Creates a dependency injection module configuring the default Core & LSP services for a Langium-based language implementation.
 * This is a set of services that are dedicated to a specific language.
 */
export function createDefaultModule(context: DefaultModuleContext): Module<LangiumServices, LangiumDefaultCoreServices & LangiumLSPServices> {
    // Chevrotain parser services module (LangiumParser, Lexer, TokenBuilder, etc.)
    // plus adapter services (ParserAdapter, AsyncParser, Hydrator)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chevrotainModule: any = {
        ...createChevrotainParserModule(),
        parser: {
            ...(createChevrotainParserModule() as any).parser,
            AsyncParser: (services: LangiumChevrotainServices) => new DefaultAsyncParser(services),
            ParserAdapter: (services: LangiumChevrotainServices) => new ChevrotainAdapter(services),
        },
        serializer: {
            Hydrator: (services: LangiumChevrotainServices) => new DefaultHydrator(services),
        }
    };
    const coreWithParser = Module.merge(createDefaultCoreModule(context), chevrotainModule);
    return Module.merge(coreWithParser, createDefaultLSPModule(context));
}

/**
 * Creates a dependency injection module configuring the default LSP services.
 * This is a set of services that are dedicated to a specific language.
 */
export function createDefaultLSPModule(context: DefaultModuleContext): Module<LangiumServices, LangiumLSPServices> {
    return {
        lsp: {
            CompletionProvider: (services) => new DefaultCompletionProvider(services),
            DocumentSymbolProvider: (services) => new DefaultDocumentSymbolProvider(services),
            HoverProvider: (services) => new MultilineCommentHoverProvider(services),
            FoldingRangeProvider: (services) => new DefaultFoldingRangeProvider(services),
            ReferencesProvider: (services) => new DefaultReferencesProvider(services),
            DefinitionProvider: (services) => new DefaultDefinitionProvider(services),
            DocumentHighlightProvider: (services) => new DefaultDocumentHighlightProvider(services),
            RenameProvider: (services) => new DefaultRenameProvider(services)
        },
        shared: () => context.shared
    };
}

export interface DefaultSharedModuleContext extends DefaultSharedCoreModuleContext {
    /**
     * Represents an abstract language server connection
     */
    readonly connection?: Connection;
}

/**
 * Creates a dependency injection module configuring the default core & LSP services shared among languages supported by a Langium-based language server.
 * This is the set of services that are shared between multiple languages.
 */
export function createDefaultSharedModule(context: DefaultSharedModuleContext): Module<LangiumSharedServices, LangiumDefaultSharedCoreServices & LangiumSharedLSPServices> {
    return Module.merge(
        createDefaultSharedCoreModule(context),
        createDefaultSharedLSPModule(context)
    );
}

/**
 * Creates a dependency injection module configuring the default shared LSP services.
 * This is the set of services that are shared between multiple languages.
 */
export function createDefaultSharedLSPModule(context: DefaultSharedModuleContext): Module<LangiumSharedServices, LangiumSharedLSPServices> {
    return {
        lsp: {
            Connection: () => context.connection,
            LanguageServer: (services) => new DefaultLanguageServer(services),
            DocumentUpdateHandler: (services) => new DefaultDocumentUpdateHandler(services),
            WorkspaceSymbolProvider: (services) => new DefaultWorkspaceSymbolProvider(services),
            NodeKindProvider: () => new DefaultNodeKindProvider(),
            FuzzyMatcher: () => new DefaultFuzzyMatcher(),
        },
        workspace: {
            TextDocuments: () => new NormalizedTextDocuments(TextDocument),
            NotebookDocuments: (services) => new NormalizedNotebookDocuments(services.workspace.TextDocuments)
        }
    };
}

// Register the grammar services factory so that langium-core's loadGrammarFromJson
// can create a minimal DI container for JSON deserialization.
// Uses the core-only module (no parser needed for deserialization).
setGrammarServicesFactory(() => {
    const shared = inject(
        createDefaultSharedCoreModule(EmptyFileSystem)
    ) as LangiumSharedCoreServices;
    return inject(
        createDefaultCoreModule({ shared })
    ) as LangiumCoreServices;
});
