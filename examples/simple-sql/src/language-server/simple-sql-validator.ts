/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { ValidationAcceptor, ValidationChecks } from 'langium';
import { MultiMap } from 'langium';
import type { SimpleSQLServices } from './simple-sql-module.js';
import type { SimpleSQLAstType, CreateTableStmt, Program } from './generated/ast.js';

export function registerValidationChecks(services: SimpleSQLServices): void {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.SimpleSQLValidator;
    const checks: ValidationChecks<SimpleSQLAstType> = {
        CreateTableStmt: validator.checkUniqueColumns,
        Program: validator.checkUniqueTableNames,
    };
    registry.register(checks, validator);
}

export class SimpleSQLValidator {

    checkUniqueColumns(stmt: CreateTableStmt, accept: ValidationAcceptor): void {
        const names = new MultiMap<string, typeof stmt.columns[number]>();
        for (const col of stmt.columns) {
            if (col.name) {
                names.add(col.name, col);
            }
        }
        for (const [name, columns] of names.entriesGroupedByKey()) {
            if (columns.length > 1) {
                for (const col of columns) {
                    accept('error', `Duplicate column name: ${name}`, { node: col, property: 'name' });
                }
            }
        }
    }

    checkUniqueTableNames(program: Program, accept: ValidationAcceptor): void {
        const names = new MultiMap<string, CreateTableStmt>();
        for (const stmt of program.statements) {
            if (stmt.$type === 'CreateTableStmt' && stmt.name) {
                names.add(stmt.name, stmt as CreateTableStmt);
            }
        }
        for (const [name, tables] of names.entriesGroupedByKey()) {
            if (tables.length > 1) {
                for (const table of tables) {
                    accept('error', `Duplicate table name: ${name}`, { node: table, property: 'name' });
                }
            }
        }
    }
}
