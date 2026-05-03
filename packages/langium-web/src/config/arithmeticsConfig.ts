/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

/// <reference types="vite/client" />

import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override';
import getLocalizationServiceOverride from '@codingame/monaco-vscode-localization-service-override';
import { LogLevel } from '@codingame/monaco-vscode-api';
import type { MessageTransports } from 'vscode-languageclient';
import { createDefaultLocaleConfiguration } from 'monaco-languageclient/vscodeApiLocales';
import type { MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import type { LanguageClientConfig } from 'monaco-languageclient/lcwrapper';
import { configureDefaultWorkerFactory } from 'monaco-languageclient/workerFactory';
import type { EditorAppConfig } from 'monaco-languageclient/editorApp';

// ?raw imports handled by Vite — language-configuration.json has JSONC comments
import arithmeticsLanguageConfig from './language-configuration.json?raw';
import arithmeticsTmGrammar from '../syntaxes/arithmetics.tmLanguage.json?raw';

const INITIAL_CODE = `Module example

def a: 5;
def b: 3;
def c: a + b;
`;

export interface ArithmeticsAppConfig {
    editorAppConfig: EditorAppConfig;
    vscodeApiConfig: MonacoVscodeApiConfig;
    languageClientConfig: LanguageClientConfig;
}

export const createArithmeticsConfig = (params: {
    worker: Worker;
    messagePort?: MessagePort;
    messageTransports?: MessageTransports;
    htmlContainer?: HTMLElement;
}): ArithmeticsAppConfig => {
    const extensionFilesOrContents = new Map<string, string | URL>();
    extensionFilesOrContents.set('/arithmetics-configuration.json', arithmeticsLanguageConfig);
    extensionFilesOrContents.set('/arithmetics-grammar.json', arithmeticsTmGrammar);

    const languageClientConfig: LanguageClientConfig = {
        languageId: 'arithmetics',
        clientOptions: {
            documentSelector: ['arithmetics']
        },
        connection: {
            options: {
                $type: 'WorkerDirect',
                worker: params.worker,
                messagePort: params.messagePort
            },
            messageTransports: params.messageTransports
        }
    };

    const vscodeApiConfig: MonacoVscodeApiConfig = {
        $type: 'extended',
        viewsConfig: {
            $type: 'EditorService',
            htmlContainer: params.htmlContainer
        },
        logLevel: LogLevel.Off,
        serviceOverrides: {
            ...getKeybindingsServiceOverride(),
            ...getLifecycleServiceOverride(),
            ...getLocalizationServiceOverride(createDefaultLocaleConfiguration())
        },
        monacoWorkerFactory: configureDefaultWorkerFactory,
        userConfiguration: {
            json: JSON.stringify({
                'workbench.colorTheme': 'Default Dark Modern',
                'editor.wordBasedSuggestions': 'off'
            })
        },
        extensions: [
            {
                config: {
                    name: 'arithmetics-example',
                    publisher: 'TypeFox',
                    version: '1.0.0',
                    engines: { vscode: '*' },
                    contributes: {
                        languages: [{
                            id: 'arithmetics',
                            extensions: ['.calc'],
                            aliases: ['arithmetics', 'Arithmetics'],
                            configuration: '/arithmetics-configuration.json'
                        }],
                        grammars: [{
                            language: 'arithmetics',
                            scopeName: 'source.arithmetics',
                            path: '/arithmetics-grammar.json'
                        }]
                    }
                },
                filesOrContents: extensionFilesOrContents
            }
        ]
    };

    const editorAppConfig: EditorAppConfig = {
        codeResources: {
            modified: {
                text: INITIAL_CODE,
                uri: '/workspace/example.calc'
            }
        },
        logLevel: LogLevel.Debug
    };

    return { editorAppConfig, vscodeApiConfig, languageClientConfig };
};
