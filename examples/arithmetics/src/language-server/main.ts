/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';
import { createArithmeticsServices } from './arithmetics-module.js';

const connection = createConnection(ProposedFeatures.all);
const { shared, arithmetics } = createArithmeticsServices({ connection, ...NodeFileSystem });

arithmetics.parser.WasmLoader.init()
    .then(() => startLanguageServer(shared))
    .catch(err => {
        console.error('[arithmetics] Failed to initialize tree-sitter WASM:', err);
        process.exit(1);
    });
