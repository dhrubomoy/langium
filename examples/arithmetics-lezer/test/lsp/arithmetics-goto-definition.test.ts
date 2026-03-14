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

describe('Arithmetics go-to-definition (Lezer backend)', () => {

    test('Go to definition from function call to definition', async () => {
        const text = `module test
def add(a, b): a + b;
add(1, 2);`;
        const document = arithmetics.shared.workspace.LangiumDocumentFactory.fromString(text, URI.file('test.calc'));
        arithmetics.shared.workspace.LangiumDocuments.addDocument(document);
        await arithmetics.shared.workspace.DocumentBuilder.build([document]);

        const addCallOffset = text.lastIndexOf('add');
        const position = document.textDocument.positionAt(addCallOffset);

        const provider = arithmetics.lsp.DefinitionProvider!;
        const result = await provider.getDefinition(document, {
            textDocument: { uri: document.uri.toString() },
            position
        });

        expect(result).toBeDefined();
        expect(result).toHaveLength(1);
        // Target should point to "add" in "def add(a, b)"
        const defOffset = text.indexOf('add');
        const expectedStart = document.textDocument.positionAt(defOffset);
        const expectedEnd = document.textDocument.positionAt(defOffset + 3);
        expect(result![0].targetSelectionRange.start).toEqual(expectedStart);
        expect(result![0].targetSelectionRange.end).toEqual(expectedEnd);
    });

    test('Go to definition from parameter reference to declaration', async () => {
        const text = `module test
def double(x): x + x;`;
        const document = arithmetics.shared.workspace.LangiumDocumentFactory.fromString(text, URI.file('test2.calc'));
        arithmetics.shared.workspace.LangiumDocuments.addDocument(document);
        await arithmetics.shared.workspace.DocumentBuilder.build([document]);

        // First "x" after ": " is the reference to parameter x
        const exprStart = text.indexOf('x + x');
        const position = document.textDocument.positionAt(exprStart);

        const provider = arithmetics.lsp.DefinitionProvider!;
        const result = await provider.getDefinition(document, {
            textDocument: { uri: document.uri.toString() },
            position
        });

        expect(result).toBeDefined();
        expect(result!.length).toBeGreaterThanOrEqual(1);
    });
});
