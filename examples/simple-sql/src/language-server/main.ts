/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';
import { createSimpleSqlServices } from './simple-sql-module.js';

const connection = createConnection(ProposedFeatures.all);

const { shared } = createSimpleSqlServices({ connection, ...NodeFileSystem });

startLanguageServer(shared);
