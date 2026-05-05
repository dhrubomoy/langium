/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { Parser, type Tree } from 'web-tree-sitter';
import type { LangiumCoreServices } from '../services.js';
import type { WasmLoader } from './wasm-loader.js';

/**
 * Service responsible for producing tree-sitter {@link Tree} objects from
 * source text. Wraps a single {@link Parser} per language, keeps the
 * {@link WasmLoader}-supplied {@link Language} attached, and lets callers pass
 * the previous {@link Tree} on edit so tree-sitter can re-parse incrementally.
 */
export interface TreeSitterDocumentParser {
    /**
     * Parse `text`. If `previousTree` is given (and the previous text was
     * edited via {@link Tree.edit} to match the new text), tree-sitter
     * re-parses incrementally; otherwise it parses from scratch.
     */
    parse(text: string, previousTree?: Tree): Tree;
}

/**
 * Default {@link TreeSitterDocumentParser} implementation. Lazily creates a
 * {@link Parser}, caches it, and resolves the {@link Language} on first use
 * via {@link WasmLoader.getLanguage}.
 *
 * Throws if {@link WasmLoader} has not been initialised — callers are expected
 * to skip the tree-sitter path when no language is loaded (see
 * {@link WasmLoader.getLanguage}).
 */
export class DefaultTreeSitterDocumentParser implements TreeSitterDocumentParser {

    protected readonly wasmLoader: WasmLoader;
    protected parser: Parser | undefined;

    constructor(services: LangiumCoreServices) {
        this.wasmLoader = services.parser.WasmLoader;
    }

    parse(text: string, previousTree?: Tree): Tree {
        const parser = this.getParser();
        const tree = parser.parse(text, previousTree ?? null);
        if (!tree) {
            throw new Error('Tree-sitter parser returned null — is the language set?');
        }
        return tree;
    }

    protected getParser(): Parser {
        if (!this.parser) {
            const language = this.wasmLoader.getLanguage();
            const parser = this.createParser();
            parser.setLanguage(language);
            this.parser = parser;
        }
        return this.parser;
    }

    /**
     * Hook for subclasses/tests to inject a custom {@link Parser} instance.
     * The default implementation calls `new Parser()` from `web-tree-sitter`.
     */
    protected createParser(): Parser {
        return new Parser();
    }
}
