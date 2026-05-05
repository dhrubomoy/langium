/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { Language, Parser } from 'web-tree-sitter';

/**
 * Service responsible for initializing the tree-sitter WebAssembly runtime and
 * loading a language-specific `grammar.wasm` file. Implementations are expected
 * to work in both Node.js and browser/web extension environments by relying on
 * the `web-tree-sitter` package, which abstracts over both.
 */
export interface WasmLoader {
    /**
     * Initialize the underlying tree-sitter Wasm runtime (calls `Parser.init()`)
     * and load the grammar Wasm file from the path provided at construction
     * time. Safe to call multiple times — subsequent calls return the cached
     * {@link Language}.
     */
    init(): Promise<Language>;

    /**
     * Returns the loaded {@link Language}. Throws if {@link init} has not been
     * awaited yet.
     */
    getLanguage(): Language;

    /**
     * Returns `true` once {@link init} has resolved with a {@link Language},
     * meaning {@link getLanguage} is safe to call. Lets callers (e.g. the
     * document factory) skip the tree-sitter path gracefully when no grammar
     * has been loaded.
     */
    isInitialized(): boolean;
}

/**
 * Default {@link WasmLoader} implementation. Accepts a `grammarWasmPath` that
 * points at the compiled tree-sitter grammar Wasm artifact and uses
 * `Parser.init()` followed by `Language.load()` to expose it.
 */
export class DefaultWasmLoader implements WasmLoader {
    protected readonly grammarWasmPath: string;
    protected language: Language | undefined;
    protected initPromise: Promise<Language> | undefined;

    constructor(grammarWasmPath: string) {
        this.grammarWasmPath = grammarWasmPath;
    }

    async init(): Promise<Language> {
        if (this.language) {
            return this.language;
        }
        if (!this.initPromise) {
            this.initPromise = this.doInit();
        }
        this.language = await this.initPromise;
        return this.language;
    }

    protected async doInit(): Promise<Language> {
        await Parser.init();
        return await Language.load(this.grammarWasmPath);
    }

    getLanguage(): Language {
        if (!this.language) {
            throw new Error('WasmLoader has not been initialized — call init() before getLanguage().');
        }
        return this.language;
    }

    isInitialized(): boolean {
        return this.language !== undefined;
    }
}
