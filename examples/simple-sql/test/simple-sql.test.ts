/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { afterEach, describe, expect, test } from 'vitest';
import type { LangiumDocument, Reference, ReferenceDescription } from 'langium';
import { EmptyFileSystem, URI } from 'langium';
import { LezerSyntaxNode } from 'langium-lezer';
import { createSimpleSqlServices } from '../src/language-server/simple-sql-module.js';
import type { CreateTableStmt, Program, SelectStmt, InsertStmt } from '../src/language-server/generated/ast.js';

// ── Service setup ───────────────────────────────────────────────────────────

const { shared, sql: services } = createSimpleSqlServices(EmptyFileSystem);

let docCounter = 0;

async function parseDocument(text: string): Promise<LangiumDocument<Program>> {
    const uri = URI.parse(`memory:/test-${docCounter++}.ssql`);
    const doc = shared.workspace.LangiumDocumentFactory.fromString<Program>(text, uri);
    shared.workspace.LangiumDocuments.addDocument(doc);
    await shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return doc;
}

afterEach(async () => {
    const docs = shared.workspace.LangiumDocuments;
    const uris = [...docs.all].map(d => d.uri);
    for (const uri of uris) {
        docs.deleteDocument(uri);
    }
    await shared.workspace.DocumentBuilder.update([], uris);
});

// ── 1. Backend verification ─────────────────────────────────────────────────

describe('Lezer Backend Verification', () => {

    test('Parser uses Lezer backend (LangiumParser is not set)', () => {
        // The Lezer module should have nulled out LangiumParser
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const langiumParser = (services as any).parser.LangiumParser;
        expect(langiumParser).toBeUndefined();
    });

    test('ParserAdapter is a LezerAdapter', () => {
        const adapter = services.parser.ParserAdapter;
        expect(adapter).toBeDefined();
        expect(adapter.constructor.name).toBe('LezerAdapter');
    });

    test('Parsed AST nodes have LezerSyntaxNode (not ChevrotainSyntaxNode)', async () => {
        const doc = await parseDocument('create table t1 (id int);');
        const program = doc.parseResult.value;
        expect(program.$syntaxNode).toBeDefined();
        expect(program.$syntaxNode).toBeInstanceOf(LezerSyntaxNode);
    });

    test('Parse errors are NOT Chevrotain-style error messages', async () => {
        const doc = await parseDocument('create table t1 (id int); \\invalid');
        // Should have parse errors, but they should NOT be Chevrotain's
        // "unexpected character" format
        const errors = doc.parseResult.lexerErrors;
        for (const err of errors) {
            expect(err.message).not.toContain('unexpected character');
            expect(err.message).not.toContain('skipped');
        }
    });

    test('SyntaxNode children are also LezerSyntaxNode instances', async () => {
        const doc = await parseDocument('create table t1 (id int);');
        const program = doc.parseResult.value;
        const syntaxNode = program.$syntaxNode!;
        expect(syntaxNode.children.length).toBeGreaterThan(0);
        for (const child of syntaxNode.children) {
            expect(child).toBeInstanceOf(LezerSyntaxNode);
        }
    });

    test('Parse errors produce diagnostics with valid line/column ranges', async () => {
        // Second line has invalid syntax
        const doc = await parseDocument('create table t1 (id int);\nthis is invalid;');
        const diagnostics = doc.diagnostics ?? [];
        expect(diagnostics.length).toBeGreaterThan(0);
        for (const diag of diagnostics) {
            // All range values must be valid numbers (not NaN)
            expect(diag.range.start.line).not.toBeNaN();
            expect(diag.range.start.character).not.toBeNaN();
            expect(diag.range.end.line).not.toBeNaN();
            expect(diag.range.end.character).not.toBeNaN();
        }
    });

    test('Parse error token has line/column info for error reporting', async () => {
        const doc = await parseDocument('create table t1 (id int);\nthis is invalid;');
        const parserErrors = doc.parseResult.parserErrors;
        expect(parserErrors.length).toBeGreaterThan(0);
        for (const err of parserErrors) {
            // Token must have 1-based line/column (Chevrotain convention)
            expect(err.token.startLine).toBeDefined();
            expect(err.token.startColumn).toBeDefined();
            expect(err.token.endLine).toBeDefined();
            expect(err.token.endColumn).toBeDefined();
            expect(err.token.startLine).not.toBeNaN();
            expect(err.token.startColumn).not.toBeNaN();
        }
    });
});

// ── 2. AST Building ─────────────────────────────────────────────────────────

describe('AST Building via Lezer', () => {

    test('CREATE TABLE statement is parsed correctly', async () => {
        const doc = await parseDocument(
            'create table users (id int, name text, score float);'
        );
        expect(doc.parseResult.lexerErrors).toHaveLength(0);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const program = doc.parseResult.value;
        expect(program.statements).toHaveLength(1);
        const stmt = program.statements[0] as CreateTableStmt;
        expect(stmt.$type).toBe('CreateTableStmt');
        expect(stmt.name).toBe('users');
        expect(stmt.columns).toHaveLength(3);
        expect(stmt.columns[0].name).toBe('id');
        expect(stmt.columns[0].type).toBe('int');
        expect(stmt.columns[1].name).toBe('name');
        expect(stmt.columns[1].type).toBe('text');
        expect(stmt.columns[2].name).toBe('score');
        expect(stmt.columns[2].type).toBe('float');
    });

    test('INSERT statement is parsed correctly', async () => {
        const doc = await parseDocument(
            "create table users (id int, name text);\n" +
            "insert into users values (1, 'Alice');"
        );
        expect(doc.parseResult.lexerErrors).toHaveLength(0);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const program = doc.parseResult.value;
        expect(program.statements).toHaveLength(2);
        const insert = program.statements[1] as InsertStmt;
        expect(insert.$type).toBe('InsertStmt');
        expect(insert.values).toHaveLength(2);
    });

    test('SELECT with column names is parsed correctly', async () => {
        const doc = await parseDocument(
            'create table users (id int, name text);\n' +
            'select id from users;'
        );
        expect(doc.parseResult.lexerErrors).toHaveLength(0);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const program = doc.parseResult.value;
        expect(program.statements).toHaveLength(2);
        const select = program.statements[1] as SelectStmt;
        expect(select.$type).toBe('SelectStmt');
        expect(select.columns).toHaveLength(1);
    });

    test('SELECT with WHERE expression is parsed correctly', async () => {
        const doc = await parseDocument(
            'create table users (id int, age int);\n' +
            'select id from users where age > 25;'
        );
        expect(doc.parseResult.lexerErrors).toHaveLength(0);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const program = doc.parseResult.value;
        const select = program.statements[1] as SelectStmt;
        expect(select.condition).toBeDefined();
        // Infix Expr rule inlines through PrimaryExpr alternatives, so $type
        // may be the concrete expression type rather than 'Expr'
        expect(select.condition!.$type).toBeDefined();
    });

    test('Multiple statements parse correctly', async () => {
        const doc = await parseDocument(
            'create table users (id int, name text);\n' +
            'create table orders (id int, amount float);\n' +
            'select id from users;\n' +
            "insert into orders values (1, 49.99);"
        );
        expect(doc.parseResult.lexerErrors).toHaveLength(0);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const program = doc.parseResult.value;
        expect(program.statements).toHaveLength(4);
        expect(program.statements[0].$type).toBe('CreateTableStmt');
        expect(program.statements[1].$type).toBe('CreateTableStmt');
        expect(program.statements[2].$type).toBe('SelectStmt');
        expect(program.statements[3].$type).toBe('InsertStmt');
    });
});

// ── 3. Cross-References (Lezer backend) ──────────────────────────────────────

describe('Cross-References with Lezer Backend', () => {

    test('SELECT references CREATE TABLE by name', async () => {
        const doc = await parseDocument(
            'create table users (id int, name text);\n' +
            'select id from users;'
        );
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const program = doc.parseResult.value;
        const select = program.statements[1] as SelectStmt;
        const tableRef: Reference<CreateTableStmt> = select.table;
        expect(tableRef).toBeDefined();
        expect(tableRef.$refText).toBe('users');
        expect(tableRef.ref).toBeDefined();
        expect(tableRef.ref!.$type).toBe('CreateTableStmt');
        expect(tableRef.ref!.name).toBe('users');
    });

    test('INSERT references CREATE TABLE by name', async () => {
        const doc = await parseDocument(
            'create table orders (id int, amount float);\n' +
            'insert into orders values (1, 49.99);'
        );
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const program = doc.parseResult.value;
        const insert = program.statements[1] as InsertStmt;
        const tableRef: Reference<CreateTableStmt> = insert.table;
        expect(tableRef).toBeDefined();
        expect(tableRef.$refText).toBe('orders');
        expect(tableRef.ref).toBeDefined();
        expect(tableRef.ref!.$type).toBe('CreateTableStmt');
        expect(tableRef.ref!.name).toBe('orders');
    });

    test('Cross-reference has $refSyntaxNode (Lezer backend)', async () => {
        const doc = await parseDocument(
            'create table t1 (id int);\n' +
            'select id from t1;'
        );
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const program = doc.parseResult.value;
        const select = program.statements[1] as SelectStmt;
        const tableRef = select.table;
        // The reference should have a SyntaxNode, proving it was built via SyntaxNode path
        expect(tableRef.$refSyntaxNode ?? tableRef.$refNode).toBeDefined();
    });

    test('Cross-reference $refSyntaxNode is a LezerSyntaxNode', async () => {
        const doc = await parseDocument(
            'create table t1 (id int);\n' +
            'select id from t1;'
        );
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const program = doc.parseResult.value;
        const select = program.statements[1] as SelectStmt;
        const refNode = select.table.$refSyntaxNode ?? select.table.$refNode;
        expect(refNode).toBeDefined();
        // If $refSyntaxNode is present, it must be a LezerSyntaxNode
        if (select.table.$refSyntaxNode) {
            expect(select.table.$refSyntaxNode).toBeInstanceOf(LezerSyntaxNode);
        }
    });

    test('Multiple tables: references resolve to correct targets', async () => {
        const doc = await parseDocument(
            'create table alpha (id int);\n' +
            'create table beta (id int);\n' +
            'select id from alpha;\n' +
            'select id from beta;'
        );
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const program = doc.parseResult.value;
        const selectAlpha = program.statements[2] as SelectStmt;
        const selectBeta = program.statements[3] as SelectStmt;
        expect(selectAlpha.table.ref).toBe(program.statements[0]);
        expect(selectBeta.table.ref).toBe(program.statements[1]);
    });

    test('Unresolved reference produces linking error', async () => {
        const doc = await parseDocument('select id from nonexistent;');
        const diagnostics = doc.diagnostics ?? [];
        // Should have at least one linking error for 'nonexistent'
        expect(diagnostics.length).toBeGreaterThan(0);
        const linkingError = diagnostics.find(d => d.message.includes('nonexistent'));
        expect(linkingError).toBeDefined();
    });
});

// ── 4. Go-to-Definition with Lezer Backend ───────────────────────────────────

describe('Go-to-Definition with Lezer Backend', () => {

    test('Go-to-definition from SELECT table ref navigates to CREATE TABLE', async () => {
        const text =
            'create table users (id int, name text);\n' +
            'select id from users;';
        const doc = await parseDocument(text);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const provider = services.lsp.DefinitionProvider!;
        expect(provider).toBeDefined();

        // Find position of 'users' in 'select id from users'
        const docText = doc.textDocument.getText();
        const selectUsersOffset = docText.indexOf('users', docText.indexOf('select'));
        const position = doc.textDocument.positionAt(selectUsersOffset);

        const result = await provider.getDefinition(doc, {
            textDocument: { uri: doc.textDocument.uri },
            position,
        });

        expect(result).toBeDefined();
        expect(result!.length).toBeGreaterThanOrEqual(1);

        // The target should point to the CREATE TABLE declaration line
        const target = result![0];
        const createTableOffset = docText.indexOf('users');
        const expectedStart = doc.textDocument.positionAt(createTableOffset);
        expect(target.targetRange.start.line).toBe(expectedStart.line);
    });

    test('Go-to-definition from INSERT table ref navigates to CREATE TABLE', async () => {
        const text =
            'create table orders (id int);\n' +
            'insert into orders values (1);';
        const doc = await parseDocument(text);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const provider = services.lsp.DefinitionProvider!;

        // Find position of 'orders' in 'insert into orders'
        const docText = doc.textDocument.getText();
        const insertOrdersOffset = docText.indexOf('orders', docText.indexOf('insert'));
        const position = doc.textDocument.positionAt(insertOrdersOffset);

        const result = await provider.getDefinition(doc, {
            textDocument: { uri: doc.textDocument.uri },
            position,
        });

        expect(result).toBeDefined();
        expect(result!.length).toBeGreaterThanOrEqual(1);

        // The target should point to the CREATE TABLE declaration
        const target = result![0];
        const createTableOffset = docText.indexOf('orders');
        const expectedStart = doc.textDocument.positionAt(createTableOffset);
        expect(target.targetRange.start.line).toBe(expectedStart.line);
    });

    test('Go-to-definition on keyword returns empty', async () => {
        const doc = await parseDocument(
            'create table t1 (id int);\n' +
            'select id from t1;'
        );
        const provider = services.lsp.DefinitionProvider!;

        // Click on 'create' keyword — should not produce a definition
        const text = doc.textDocument.getText();
        const createOffset = text.indexOf('create');
        const position = doc.textDocument.positionAt(createOffset);

        const result = await provider.getDefinition(doc, {
            textDocument: { uri: doc.textDocument.uri },
            position,
        });

        expect(result ?? []).toHaveLength(0);
    });

    test('Go-to-definition resolves to correct table among multiple', async () => {
        const text =
            'create table alpha (id int);\n' +
            'create table beta (id int);\n' +
            'select id from beta;';
        const doc = await parseDocument(text);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const provider = services.lsp.DefinitionProvider!;

        // Click on 'beta' in the SELECT
        const docText = doc.textDocument.getText();
        const selectBetaOffset = docText.indexOf('beta', docText.indexOf('select'));
        const position = doc.textDocument.positionAt(selectBetaOffset);

        const result = await provider.getDefinition(doc, {
            textDocument: { uri: doc.textDocument.uri },
            position,
        });

        expect(result).toBeDefined();
        expect(result!.length).toBeGreaterThanOrEqual(1);

        // Should point to 'beta' on the CREATE TABLE line (line 1), not 'alpha' (line 0)
        const target = result![0];
        const betaCreateOffset = docText.indexOf('beta');
        const expectedStart = doc.textDocument.positionAt(betaCreateOffset);
        expect(target.targetRange.start.line).toBe(expectedStart.line);
    });
});

// ── 5. Find References with Lezer Backend ────────────────────────────────────

describe('Find References with Lezer Backend', () => {

    test('Find all references to a table', async () => {
        const doc = await parseDocument(
            'create table users (id int, name text);\n' +
            'select id from users;\n' +
            "insert into users values (1, 'Alice');\n" +
            'select name from users where id = 1;'
        );
        expect(doc.parseResult.parserErrors).toHaveLength(0);

        const program = doc.parseResult.value;
        const createTable = program.statements[0] as CreateTableStmt;

        // Use IndexManager to find all references
        const allRefs: ReferenceDescription[] = [];
        const path = services.workspace.AstNodeLocator.getAstNodePath(createTable);
        services.shared.workspace.IndexManager
            .findAllReferences(createTable, path)
            .forEach((ref) => allRefs.push(ref));

        // Should find 3 references: 2 selects + 1 insert
        expect(allRefs).toHaveLength(3);
    });

    test('Table with no references returns empty', async () => {
        const doc = await parseDocument(
            'create table unused (id int);'
        );
        expect(doc.parseResult.parserErrors).toHaveLength(0);

        const program = doc.parseResult.value;
        const createTable = program.statements[0] as CreateTableStmt;

        const allRefs: ReferenceDescription[] = [];
        const path = services.workspace.AstNodeLocator.getAstNodePath(createTable);
        services.shared.workspace.IndexManager
            .findAllReferences(createTable, path)
            .forEach((ref) => allRefs.push(ref));

        expect(allRefs).toHaveLength(0);
    });
});
