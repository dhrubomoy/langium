/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Module } from 'langium-core';
import type { LangiumDefaultCoreServices, LangiumDefaultSharedCoreServices, LangiumCoreServices, LangiumSharedCoreServices } from 'langium-core';
import type { LangiumChevrotainServices } from 'langium-chevrotain';
import type { FileSystemProvider } from 'langium-core';
import { DefaultGrammarRegistry } from 'langium-core';
import { createGrammarConfig } from 'langium-core';
import { ChevrotainAdapter } from 'langium-chevrotain';
import { createCompletionParser } from 'langium-chevrotain';
import { createLangiumParser } from 'langium-chevrotain';
import { DefaultTokenBuilder } from 'langium-chevrotain';
import { DefaultValueConverter } from 'langium-core';
import { DefaultLinker } from 'langium-core';
import { DefaultNameProvider } from 'langium-core';
import { DefaultReferences } from 'langium-core';
import { DefaultScopeComputation } from 'langium-core';
import { DefaultScopeProvider } from 'langium-core';
import { DefaultJsonSerializer } from 'langium-core';
import { DefaultServiceRegistry } from 'langium-core';
import { DefaultDocumentValidator } from 'langium-core';
import { ValidationRegistry } from 'langium-core';
import { DefaultAstNodeDescriptionProvider, DefaultReferenceDescriptionProvider } from 'langium-core';
import { DefaultAstNodeLocator } from 'langium-core';
import { DefaultConfigurationProvider } from 'langium-core';
import { DefaultDocumentBuilder } from 'langium-core';
import { DefaultLangiumDocumentFactory, DefaultLangiumDocuments } from 'langium-core';
import { DefaultIndexManager } from 'langium-core';
import { DefaultWorkspaceManager } from 'langium-core';
import { JSDocDocumentationProvider } from 'langium-core';
import { DefaultCommentProvider } from 'langium-core';
import { DefaultAsyncParser } from 'langium-core';
import { DefaultLexer, DefaultLexerErrorMessageProvider } from 'langium-chevrotain';
import { LangiumParserErrorMessageProvider } from 'langium-chevrotain';
import { DefaultWorkspaceLock } from 'langium-core';
import { DefaultHydrator } from 'langium-chevrotain';
import { setGrammarServicesFactory, inject, EmptyFileSystem } from 'langium-core';

/**
 * Context required for creating the default language-specific dependency injection module.
 */
export interface DefaultCoreModuleContext {
    shared: LangiumSharedCoreServices;
}

/**
 * Creates a dependency injection module configuring the default core services.
 * This is a set of services that are dedicated to a specific language.
 */
export function createDefaultCoreModule(context: DefaultCoreModuleContext): Module<LangiumCoreServices, LangiumDefaultCoreServices> {
    // The module also registers Chevrotain-specific services (LangiumParser, Lexer, etc.)
    // for backward compatibility. The casts are safe because the DI container merges
    // all services and the Chevrotain services are always available at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chevrotainServices: any = {
        LangiumParser: (services: LangiumChevrotainServices) => createLangiumParser(services),
        CompletionParser: (services: LangiumChevrotainServices) => createCompletionParser(services),
        TokenBuilder: () => new DefaultTokenBuilder(),
        Lexer: (services: LangiumChevrotainServices) => new DefaultLexer(services),
        ParserErrorMessageProvider: () => new LangiumParserErrorMessageProvider(),
        LexerErrorMessageProvider: () => new DefaultLexerErrorMessageProvider(),
    };
    return {
        documentation: {
            CommentProvider: (services) => new DefaultCommentProvider(services),
            DocumentationProvider: (services) => new JSDocDocumentationProvider(services)
        },
        grammar: {
            GrammarRegistry: (services) => new DefaultGrammarRegistry(services)
        },
        parser: {
            AsyncParser: (services) => new DefaultAsyncParser(services as unknown as LangiumChevrotainServices),
            GrammarConfig: (services) => createGrammarConfig(services),
            ValueConverter: () => new DefaultValueConverter(),
            ParserAdapter: (services) => new ChevrotainAdapter(services as unknown as LangiumChevrotainServices),
            ...chevrotainServices,
        },
        workspace: {
            AstNodeLocator: () => new DefaultAstNodeLocator(),
            AstNodeDescriptionProvider: (services) => new DefaultAstNodeDescriptionProvider(services),
            ReferenceDescriptionProvider: (services) => new DefaultReferenceDescriptionProvider(services)
        },
        references: {
            Linker: (services) => new DefaultLinker(services),
            NameProvider: () => new DefaultNameProvider(),
            ScopeProvider: (services) => new DefaultScopeProvider(services),
            ScopeComputation: (services) => new DefaultScopeComputation(services),
            References: (services) => new DefaultReferences(services)
        },
        serializer: {
            Hydrator: (services) => new DefaultHydrator(services as unknown as LangiumChevrotainServices),
            JsonSerializer: (services) => new DefaultJsonSerializer(services)
        },
        validation: {
            DocumentValidator: (services) => new DefaultDocumentValidator(services),
            ValidationRegistry: (services) => new ValidationRegistry(services)
        },
        shared: () => context.shared
    };
}

/**
 * Context required for creating the default shared dependency injection module.
 */
export interface DefaultSharedCoreModuleContext {
    /**
     * Factory function to create a {@link FileSystemProvider}.
     *
     * Langium exposes an `EmptyFileSystem` and `NodeFileSystem`, exported through `langium/node`.
     * When running Langium as part of a vscode language server or a Node.js app, using the `NodeFileSystem` is recommended,
     * the `EmptyFileSystem` in every other use case.
     */
    fileSystemProvider: (services: LangiumSharedCoreServices) => FileSystemProvider;
}

/**
 * Creates a dependency injection module configuring the default shared core services.
 * This is the set of services that are shared between multiple languages.
 */
export function createDefaultSharedCoreModule(context: DefaultSharedCoreModuleContext): Module<LangiumSharedCoreServices, LangiumDefaultSharedCoreServices> {
    return {
        ServiceRegistry: (services) => new DefaultServiceRegistry(services),
        workspace: {
            LangiumDocuments: (services) => new DefaultLangiumDocuments(services),
            LangiumDocumentFactory: (services) => new DefaultLangiumDocumentFactory(services),
            DocumentBuilder: (services) => new DefaultDocumentBuilder(services),
            IndexManager: (services) => new DefaultIndexManager(services),
            WorkspaceManager: (services) => new DefaultWorkspaceManager(services),
            FileSystemProvider: (services) => context.fileSystemProvider(services),
            WorkspaceLock: () => new DefaultWorkspaceLock(),
            ConfigurationProvider: (services) => new DefaultConfigurationProvider(services),
        },
        profilers: {}
    };
}

// Register the grammar services factory so that langium-core's grammar-loader
// can create services without a circular dependency.
setGrammarServicesFactory(() => {
    const shared = inject(
        createDefaultSharedCoreModule(EmptyFileSystem)
    ) as LangiumSharedCoreServices;
    return inject(
        createDefaultCoreModule({ shared })
    ) as LangiumCoreServices;
});
