/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { type Module, inject } from 'langium';
import {
    createDefaultModule,
    createDefaultSharedModule,
    type DefaultSharedModuleContext,
    type LangiumServices,
    type LangiumSharedServices,
    type PartialLangiumServices
} from 'langium/lsp';
import { createLezerParserModule, LezerAdapter, DefaultFieldMap } from 'langium-lezer';
import type { FieldMapData } from 'langium-lezer';
import { SimpleSQLValidator, registerValidationChecks } from './simple-sql-validator.js';
import { SimpleSQLGeneratedModule, SimpleSQLGeneratedSharedModule } from './generated/module.js';
// Lezer-generated parse tables and data
import { parser as lezerParser } from './generated/SimpleSQL.parser.js';
import fieldMapData from './generated/SimpleSQL.field-map.json' with { type: 'json' };
import keywordsData from './generated/SimpleSQL.keywords.json' with { type: 'json' };

/**
 * Declaration of custom services.
 */
export type SimpleSQLAddedServices = {
    validation: {
        SimpleSQLValidator: SimpleSQLValidator
    }
}

/**
 * Union of Langium default services and custom services.
 */
export type SimpleSQLServices = LangiumServices & SimpleSQLAddedServices

/**
 * Custom DI module providing the SimpleSQLValidator.
 */
export const SimpleSQLModule: Module<SimpleSQLServices, PartialLangiumServices & SimpleSQLAddedServices> = {
    validation: {
        SimpleSQLValidator: () => new SimpleSQLValidator()
    }
};

/**
 * Create the full set of services required by Langium, using the Lezer parser backend.
 *
 * The Lezer parser module overrides the default (Chevrotain) parser services.
 * After DI construction, the pre-compiled Lezer parse tables are loaded into the adapter.
 */
export function createSimpleSqlServices(context: DefaultSharedModuleContext): {
    shared: LangiumSharedServices,
    sql: SimpleSQLServices
} {
    const shared = inject(
        createDefaultSharedModule(context),
        SimpleSQLGeneratedSharedModule
    );
    const sql = inject(
        createDefaultModule({ shared }),
        createLezerParserModule(),    // Override default parser with Lezer
        SimpleSQLGeneratedModule,
        SimpleSQLModule
    );

    // Load pre-compiled Lezer parse tables into the adapter
    const adapter = sql.parser.ParserAdapter as LezerAdapter;
    adapter.loadParseTables(
        lezerParser,
        new DefaultFieldMap(fieldMapData as FieldMapData),
        new Set(keywordsData as string[])
    );

    shared.ServiceRegistry.register(sql);
    registerValidationChecks(sql);
    if (!context.connection) {
        shared.workspace.ConfigurationProvider.initialized({});
    }
    return { shared, sql };
}
