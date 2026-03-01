/******************************************************************************
 * Copyright 2023 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

// TODO: This module previously created its own minimal DI container using
// createDefaultCoreModule / createDefaultSharedCoreModule from default-module.ts
// (now in the langium meta-package). The service creation is now deferred to
// a configurable factory that must be set by the meta-package or application.
import * as ast from '../languages/generated/ast.js';
import type { LangiumCoreServices } from '../services.js';
import type { Mutable } from '../syntax-tree.js';
import { URI } from './uri-utils.js';

/**
 * Factory function type for creating minimal grammar services.
 * Must be set by the meta-package (langium) before loadGrammarFromJson is called.
 */
export type GrammarServicesFactory = () => LangiumCoreServices;

let _grammarServicesFactory: GrammarServicesFactory | undefined;

/**
 * Set the factory function used to create minimal grammar services for JSON deserialization.
 * This must be called by the meta-package (e.g. langium) during initialization.
 */
export function setGrammarServicesFactory(factory: GrammarServicesFactory): void {
    _grammarServicesFactory = factory;
}

/**
 * Load a Langium grammar for your language from a JSON string. This is used by several services,
 * most notably the parser builder which interprets the grammar to create a parser.
 */
export function loadGrammarFromJson(json: string): ast.Grammar {
    if (!_grammarServicesFactory) {
        throw new Error(
            'Grammar services factory not set. Call setGrammarServicesFactory() during initialization. ' +
            'This is normally done by the langium meta-package.'
        );
    }
    const services = _grammarServicesFactory();
    const astNode = services.serializer.JsonSerializer.deserialize(json) as Mutable<ast.Grammar>;
    services.shared.workspace.LangiumDocumentFactory.fromModel(astNode, URI.parse(`memory:/${astNode.name ?? 'grammar'}.langium`));
    return astNode;
}
