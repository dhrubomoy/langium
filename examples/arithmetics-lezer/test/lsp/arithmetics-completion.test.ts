/******************************************************************************
 * Copyright 2025 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, expect, test } from 'vitest';
import { EmptyFileSystem, URI } from 'langium';
import { createArithmeticsServices } from '../../src/language-server/arithmetics-module.js';

const services = createArithmeticsServices(EmptyFileSystem);
const arithmetics = services.arithmetics;

describe('Arithmetics completion (Lezer backend)', () => {

    test('Typing "d" should suggest "def" keyword', async () => {
        const text = `module test
d`;
        const document = arithmetics.shared.workspace.LangiumDocumentFactory.fromString(text, URI.file('completion-def.calc'));
        arithmetics.shared.workspace.LangiumDocuments.addDocument(document);
        await arithmetics.shared.workspace.DocumentBuilder.build([document]);

        const position = document.textDocument.positionAt(text.length);
        const result = await arithmetics.lsp.CompletionProvider!.getCompletion(document, {
            textDocument: { uri: document.uri.toString() },
            position
        });

        const labels = result?.items?.map(i => i.label) ?? [];
        expect(labels).toContain('def');
    });

    test('Empty line after module should suggest "def"', async () => {
        const text = `module test
`;
        const document = arithmetics.shared.workspace.LangiumDocumentFactory.fromString(text, URI.file('completion-empty.calc'));
        arithmetics.shared.workspace.LangiumDocuments.addDocument(document);
        await arithmetics.shared.workspace.DocumentBuilder.build([document]);

        const position = document.textDocument.positionAt(text.length);
        const result = await arithmetics.lsp.CompletionProvider!.getCompletion(document, {
            textDocument: { uri: document.uri.toString() },
            position
        });

        const labels = result?.items?.map(i => i.label) ?? [];
        expect(labels).toContain('def');
    });

    test('Typing "s" should suggest defined function "sqrt"', async () => {
        const text = `module test
def sqrt(x): x;
s`;
        const document = arithmetics.shared.workspace.LangiumDocumentFactory.fromString(text, URI.file('completion-xref.calc'));
        arithmetics.shared.workspace.LangiumDocuments.addDocument(document);
        await arithmetics.shared.workspace.DocumentBuilder.build([document]);

        const position = document.textDocument.positionAt(text.length);
        const result = await arithmetics.lsp.CompletionProvider!.getCompletion(document, {
            textDocument: { uri: document.uri.toString() },
            position
        });

        const labels = result?.items?.map(i => i.label) ?? [];
        console.log('Completion labels for "s":', labels);
        expect(labels).toContain('sqrt');
    });
});
