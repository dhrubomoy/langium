/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Language, Parser, Tree } from 'web-tree-sitter';
import { describe, expect, test, vi } from 'vitest';
import { DefaultTreeSitterDocumentParser, DefaultWasmLoader } from 'langium';
import type { LangiumCoreServices, WasmLoader } from 'langium';

const fakeLanguage = {} as Language;

function createServices(wasmLoader: WasmLoader): LangiumCoreServices {
    return {
        parser: { WasmLoader: wasmLoader }
    } as unknown as LangiumCoreServices;
}

class StubWasmLoader implements WasmLoader {
    init(): Promise<Language> { return Promise.resolve(fakeLanguage); }
    getLanguage(): Language { return fakeLanguage; }
    isInitialized(): boolean { return true; }
}

class StubParser extends DefaultTreeSitterDocumentParser {
    public readonly created: Parser[] = [];
    constructor(services: LangiumCoreServices, private readonly stubParser: Parser) {
        super(services);
    }
    protected override createParser(): Parser {
        this.created.push(this.stubParser);
        return this.stubParser;
    }
}

describe('DefaultTreeSitterDocumentParser', () => {

    test('creates a tree-sitter Parser, sets the language and parses text', () => {
        const setLanguage = vi.fn();
        const parse = vi.fn().mockReturnValue({} as Tree);
        const fakeParser = { setLanguage, parse } as unknown as Parser;
        const subject = new StubParser(createServices(new StubWasmLoader()), fakeParser);

        const tree = subject.parse('1 + 2');

        expect(setLanguage).toHaveBeenCalledWith(fakeLanguage);
        expect(parse).toHaveBeenCalledWith('1 + 2', null);
        expect(tree).toBeDefined();
    });

    test('reuses the same Parser instance across parse calls', () => {
        const setLanguage = vi.fn();
        const parse = vi.fn().mockReturnValue({} as Tree);
        const fakeParser = { setLanguage, parse } as unknown as Parser;
        const subject = new StubParser(createServices(new StubWasmLoader()), fakeParser);

        subject.parse('a');
        subject.parse('b');

        expect(subject.created).toHaveLength(1);
        expect(setLanguage).toHaveBeenCalledOnce();
        expect(parse).toHaveBeenCalledTimes(2);
    });

    test('passes the previous tree through to the underlying parser for incremental re-parse', () => {
        const setLanguage = vi.fn();
        const parse = vi.fn().mockReturnValue({} as Tree);
        const fakeParser = { setLanguage, parse } as unknown as Parser;
        const subject = new StubParser(createServices(new StubWasmLoader()), fakeParser);

        const previous = { id: 'prev' } as unknown as Tree;
        subject.parse('updated', previous);

        expect(parse).toHaveBeenCalledWith('updated', previous);
    });

    test('throws when the parser returns null (e.g. language not set)', () => {
        const setLanguage = vi.fn();
        const parse = vi.fn().mockReturnValue(null);
        const fakeParser = { setLanguage, parse } as unknown as Parser;
        const subject = new StubParser(createServices(new StubWasmLoader()), fakeParser);

        expect(() => subject.parse('x')).toThrow(/null/);
    });

    test('propagates the WasmLoader.getLanguage() error when the language is not yet loaded', () => {
        const wasmLoader = new DefaultWasmLoader('not-a-real-path.wasm');
        const subject = new DefaultTreeSitterDocumentParser(createServices(wasmLoader));
        expect(() => subject.parse('text')).toThrow(/WasmLoader has not been initialized/);
    });
});
