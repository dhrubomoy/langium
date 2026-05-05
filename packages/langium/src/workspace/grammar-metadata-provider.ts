/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { GrammarMetadata } from '../generate/grammar-metadata.js';

/**
 * Per-language service that supplies the {@link GrammarMetadata} produced by
 * the tree-sitter grammar compiler. Consumed by the document builder to feed
 * the {@link IndexBuilder}, and by any other runtime code that needs to map
 * tree-sitter node types onto Langium AST concepts.
 *
 * The default implementation returns `undefined`. Languages with a compiled
 * tree-sitter grammar override this service from their generated module to
 * return the constant emitted alongside `grammar.wasm`.
 */
export interface GrammarMetadataProvider {
    /**
     * Returns the {@link GrammarMetadata} for this language, or `undefined`
     * when no tree-sitter metadata has been generated.
     */
    getMetadata(): GrammarMetadata | undefined;
}

/**
 * Default {@link GrammarMetadataProvider} implementation. Returns `undefined`,
 * which causes the document builder to skip the tree-sitter index build for
 * languages that have not yet supplied compiled metadata.
 */
export class DefaultGrammarMetadataProvider implements GrammarMetadataProvider {
    getMetadata(): GrammarMetadata | undefined {
        return undefined;
    }
}
