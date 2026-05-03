/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

/// <reference lib="WebWorker" />

import { EmptyFileSystem } from 'langium';
import { startLanguageServer } from 'langium/lsp';
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from 'vscode-languageserver/browser.js';
import { createArithmeticsServices } from 'langium-arithmetics-dsl/language-server';

export const start = (port: MessagePort | DedicatedWorkerGlobalScope): void => {
    const reader = new BrowserMessageReader(port);
    const writer = new BrowserMessageWriter(port);
    const connection = createConnection(reader, writer);
    const { shared } = createArithmeticsServices({ connection, ...EmptyFileSystem });
    startLanguageServer(shared);
};
