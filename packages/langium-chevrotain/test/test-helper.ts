/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Grammar } from 'langium-core';
import { EmptyFileSystem, URI } from 'langium-core';
import { createLangiumGrammarServices } from 'langium-lsp';

/**
 * Parse a grammar string into a Grammar AST using Langium's grammar language.
 */
export async function parseGrammarString(grammarString: string): Promise<Grammar> {
    const grammarServices = createLangiumGrammarServices(EmptyFileSystem).grammar;
    const uri = URI.parse('memory:/test-grammar.langium');
    const doc = grammarServices.shared.workspace.LangiumDocumentFactory.fromString(grammarString, uri);
    grammarServices.shared.workspace.LangiumDocuments.addDocument(doc);
    await grammarServices.shared.workspace.DocumentBuilder.build([doc], { validation: false });
    return doc.parseResult.value as Grammar;
}
