/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { BrowserMessageReader, BrowserMessageWriter } from 'vscode-languageclient/browser.js';
import { EditorApp } from 'monaco-languageclient/editorApp';
import { MonacoVscodeApiWrapper } from 'monaco-languageclient/vscodeApiWrapper';
import { LanguageClientWrapper } from 'monaco-languageclient/lcwrapper';
import { createArithmeticsConfig } from './config/arithmeticsConfig.js';

const startEditor = async () => {
    const worker = new Worker(
        new URL('./worker/arithmetics-server-port.ts', import.meta.url),
        { type: 'module', name: 'Arithmetics Language Server' }
    );

    const channel = new MessageChannel();
    worker.postMessage({ port: channel.port2 }, [channel.port2]);

    const reader = new BrowserMessageReader(channel.port1);
    const writer = new BrowserMessageWriter(channel.port1);

    const container = document.getElementById('monaco-editor-root')!;

    const appConfig = createArithmeticsConfig({
        worker,
        messagePort: channel.port1,
        messageTransports: { reader, writer },
        htmlContainer: container
    });

    const apiWrapper = new MonacoVscodeApiWrapper(appConfig.vscodeApiConfig);
    await apiWrapper.start();

    const lcWrapper = new LanguageClientWrapper(appConfig.languageClientConfig);
    await lcWrapper.start();

    const editorApp = new EditorApp(appConfig.editorAppConfig);
    await editorApp.start(container);
};

startEditor().catch(console.error);
