/******************************************************************************
 * Copyright 2023 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Grammar, LangiumCoreServices, TreeSitterDocumentParser, WasmLoader } from 'langium';
import type { LangiumServices } from 'langium/lsp';
import type { Language, Tree } from 'web-tree-sitter';
import { describe, expect, test, vi } from 'vitest';
import { DocumentState, EmptyFileSystem, TextDocument } from 'langium';
import { createLangiumGrammarServices } from 'langium/grammar';
import { CancellationToken } from 'vscode-languageserver';

describe('DefaultLangiumDocumentFactory', () => {

    test('updates document when receiving a new text', async () => {
        const services = createLangiumGrammarServices(EmptyFileSystem).grammar;
        const documentFactory = services.shared.workspace.LangiumDocumentFactory;
        const uri = 'file:///test.langium';
        const document = documentFactory.fromTextDocument<Grammar>(createTextDocument(uri, 'grammar X', services));
        expect(document.state).toBe(DocumentState.Parsed);
        expect(document.parseResult.value.name).toBe('X');
        document.state = DocumentState.Changed;
        // Update the document with a different text.
        createTextDocument(uri, 'grammar Y', services);
        const updated = await documentFactory.update(document, CancellationToken.None);
        expect(updated.state).toBe(DocumentState.Parsed);
        // Assert that the parse result was updated.
        expect(updated.parseResult.value.name).toBe('Y');
    });

    test('does not update document when receiving the same text', async () => {
        const services = createLangiumGrammarServices(EmptyFileSystem).grammar;
        const documentFactory = services.shared.workspace.LangiumDocumentFactory;
        const uri = 'file:///test.langium';
        const document = documentFactory.fromTextDocument<Grammar>(createTextDocument(uri, 'grammar X', services));
        expect(document.parseResult.value.name).toBe('X');
        // We set a new name value here. When the document is updated, this value should be preserved.
        document.parseResult.value.name = 'HELLO';
        expect(document.parseResult.value.name).toBe('HELLO');
        document.state = DocumentState.Changed;
        // Update the document with the same text.
        createTextDocument(uri, 'grammar X', services);
        const updated = await documentFactory.update(document, CancellationToken.None);
        // Confirm that the parse result wasn't updated.
        expect(updated.parseResult.value.name).toBe('HELLO');
    });
});

function createTextDocument(uri: string, text: string, services: LangiumServices): TextDocument {
    const document = TextDocument.create(uri, 'langium', 0, text);
    services.shared.workspace.TextDocuments.set(document);
    return document;
}

describe('DefaultLangiumDocumentFactory tree-sitter wiring', () => {

    test('skips tree-sitter parsing gracefully when WasmLoader is not initialized', () => {
        const services = createLangiumGrammarServices(EmptyFileSystem).grammar;
        const documentFactory = services.shared.workspace.LangiumDocumentFactory;
        const uri = 'file:///no-wasm.langium';
        const document = documentFactory.fromTextDocument<Grammar>(createTextDocument(uri, 'grammar Z', services));
        expect(document.treeSitterTree).toBeUndefined();
    });

    test('parses with tree-sitter and stores the resulting Tree on the document when WasmLoader is initialized', async () => {
        const services = createLangiumGrammarServices(EmptyFileSystem).grammar;
        const treeA = { id: 'A' } as unknown as Tree;
        installTreeSitterStub(services as unknown as LangiumCoreServices, [treeA]);
        const documentFactory = services.shared.workspace.LangiumDocumentFactory;

        const uri = 'file:///wired.langium';
        const document = documentFactory.fromTextDocument<Grammar>(createTextDocument(uri, 'grammar P', services));

        expect(document.treeSitterTree).toBe(treeA);
    });

    test('passes the previous tree to the parser on update so tree-sitter can re-parse incrementally', async () => {
        const services = createLangiumGrammarServices(EmptyFileSystem).grammar;
        const treeA = { id: 'A' } as unknown as Tree;
        const treeB = { id: 'B' } as unknown as Tree;
        const stub = installTreeSitterStub(services as unknown as LangiumCoreServices, [treeA, treeB]);
        const documentFactory = services.shared.workspace.LangiumDocumentFactory;

        const uri = 'file:///incremental.langium';
        const document = documentFactory.fromTextDocument<Grammar>(createTextDocument(uri, 'grammar P', services));
        expect(document.treeSitterTree).toBe(treeA);

        document.state = DocumentState.Changed;
        createTextDocument(uri, 'grammar Q', services);
        const updated = await documentFactory.update(document, CancellationToken.None);

        expect(updated.treeSitterTree).toBe(treeB);
        expect(stub.parse).toHaveBeenCalledTimes(2);
        // Second call should pass the previous tree (treeA) as the second argument.
        const secondCall = stub.parse.mock.calls[1];
        expect(secondCall[0]).toBe('grammar Q');
        expect(secondCall[1]).toBe(treeA);
    });
});

interface TreeSitterStub {
    parse: ReturnType<typeof vi.fn>;
}

function installTreeSitterStub(services: LangiumCoreServices, trees: Tree[]): TreeSitterStub {
    const treeQueue = [...trees];
    const parse = vi.fn((_text: string, _previous?: Tree) => {
        const next = treeQueue.shift();
        if (!next) {
            throw new Error('Stubbed TreeSitterDocumentParser ran out of fake trees');
        }
        return next;
    });
    const stub: TreeSitterDocumentParser = { parse };

    // Replace the WasmLoader with a stub that reports as initialized so the
    // factory takes the tree-sitter branch.
    const wasmStub: WasmLoader = {
        init: () => Promise.resolve({} as Language),
        getLanguage: () => ({} as Language),
        isInitialized: () => true
    };

    Object.defineProperty(services.parser, 'WasmLoader', { value: wasmStub, configurable: true });
    Object.defineProperty(services.parser, 'TreeSitterDocumentParser', { value: stub, configurable: true });
    return { parse };
}
