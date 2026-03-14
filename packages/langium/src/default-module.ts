/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Module } from 'langium-core';
import type { LangiumDefaultCoreServices, LangiumCoreServices, LangiumSharedCoreServices } from 'langium-core';
import type { FileSystemProvider } from 'langium-core';
import { createDefaultCoreModule as createDefaultCoreModuleBase, createDefaultSharedCoreModule, Module as ModuleImpl, setGrammarServicesFactory, inject, EmptyFileSystem } from 'langium-core';
import { createChevrotainModule } from 'langium-chevrotain';

/**
 * Context required for creating the default language-specific dependency injection module.
 */
export interface DefaultCoreModuleContext {
    shared: LangiumSharedCoreServices;
}

/**
 * Creates a dependency injection module configuring the default core services with the
 * Chevrotain parser backend. This is a backward-compatible convenience function that
 * merges the parser-agnostic core module with the Chevrotain backend module.
 *
 * For parser-agnostic usage, import `createDefaultCoreModule` from `langium-core` instead
 * and merge your own backend module.
 */
export function createDefaultCoreModule(context: DefaultCoreModuleContext): Module<LangiumCoreServices, LangiumDefaultCoreServices> {
    return ModuleImpl.merge(createDefaultCoreModuleBase(context), createChevrotainModule());
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
export { createDefaultSharedCoreModule };

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
