/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import fs from 'fs-extra';
import { EmptyFileSystem, type Grammar } from 'langium';
import { createLangiumGrammarServices } from 'langium/grammar';
import { parseHelper } from 'langium/test';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
    composeGrammarJs,
    emitTreeSitterArtifacts,
    serializeMetadata,
    writeGrammarJs,
    writeMetadataTs
} from '../../../src/generator/treesitter/file-writer.js';

const services = createLangiumGrammarServices(EmptyFileSystem);
const parse = parseHelper<Grammar>(services.grammar);

async function parseGrammar(input: string): Promise<Grammar> {
    const document = await parse(input);
    return document.parseResult.value;
}

const ARITHMETIC_GRAMMAR = `
    grammar Arithmetic
    entry Expression:
        Addition | Subtraction | Multiplication | Division | Negation | Parenthesized | NumberLiteral | NamedExpression;
    AbstractDefinition: Definition;
    Definition: 'def' name=ID '=' expr=Expression ';';
    Addition: @prec.left(1) left=Expression '+' right=Expression;
    Subtraction: @prec.left(1) left=Expression '-' right=Expression;
    Multiplication: @prec.left(2) left=Expression '*' right=Expression;
    Division: @prec.left(2) left=Expression '/' right=Expression;
    Negation: @prec.right(3) '-' operand=Expression;
    Parenthesized: @prec(4) '(' expression=Expression ')';
    NumberLiteral: value=NUMBER;
    NamedExpression: element=[AbstractDefinition:ID];
    hidden terminal WS: /\\s+/;
    hidden terminal ML_COMMENT: /\\/\\*[\\s\\S]*?\\*\\//  '*/';
    hidden terminal SL_COMMENT: /\\/\\//  /[^\\n\\r]*/;
    @word terminal ID: /[_a-zA-Z][\\w_]*/;
    terminal NUMBER returns number: /[0-9]+(\\.[0-9]+)?/;
`;

describe('file-writer composeGrammarJs', () => {

    test('emits the canonical module.exports = grammar({...}) shape', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const js = composeGrammarJs(grammar);
        expect(js).toContain('module.exports = grammar({');
        expect(js).toContain("name: 'Arithmetic'");
        expect(js).toContain('rules: {');
        expect(js.trimEnd().endsWith('});')).toBe(true);
    });

    test('uses explicit languageName argument when provided', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const js = composeGrammarJs(grammar, 'arithmetic');
        expect(js).toContain("name: 'arithmetic'");
        expect(js).not.toContain("name: 'Arithmetic'");
    });

    test('emits word declaration for @word terminal', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const js = composeGrammarJs(grammar);
        expect(js).toContain('word: $ => $.ID');
    });

    test('omits word declaration when no @word terminal', async () => {
        const grammar = await parseGrammar(`
            grammar Test
            entry E: name=ID;
            terminal ID: /[_a-zA-Z][\\w]*/;
        `);
        const js = composeGrammarJs(grammar);
        expect(js).not.toContain('word: $');
    });

    test('emits extras array', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const js = composeGrammarJs(grammar);
        expect(js).toContain('extras: $ => [');
        expect(js).toContain('$.SL_COMMENT');
    });

    test('includes every parser-rule and terminal-rule in rules block', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const js = composeGrammarJs(grammar);
        for (const ruleName of [
            'Expression', 'Definition', 'Addition', 'Subtraction',
            'Multiplication', 'Division', 'Negation', 'Parenthesized',
            'NumberLiteral', 'NamedExpression', 'ID', 'NUMBER',
            'WS', 'ML_COMMENT', 'SL_COMMENT'
        ]) {
            expect(js, `expected rule ${ruleName} to be present`).toContain(`${ruleName}: $ =>`);
        }
    });

    test('includes the Eclipse copyright header', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const js = composeGrammarJs(grammar);
        expect(js.startsWith('/*')).toBe(true);
        expect(js).toContain('Copyright 2026 TypeFox GmbH');
    });

});

describe('file-writer serializeMetadata', () => {

    test('produces valid TypeScript exporting GRAMMAR_METADATA', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const { compileMetadata } = await import('../../../src/generator/treesitter/metadata-compiler.js');
        const meta = compileMetadata(grammar);
        const ts = serializeMetadata(meta);
        expect(ts).toContain("import type { GrammarMetadata } from 'langium/generate';");
        expect(ts).toContain('export const GRAMMAR_METADATA: GrammarMetadata =');
        expect(ts).toContain('Copyright 2026 TypeFox GmbH');
        // The body must be valid JSON-shaped data — no functions.
        expect(ts).not.toContain('function');
    });

    test('serialized metadata round-trips via JSON.parse on the body', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const { compileMetadata } = await import('../../../src/generator/treesitter/metadata-compiler.js');
        const meta = compileMetadata(grammar);
        const ts = serializeMetadata(meta);
        const match = ts.match(/= (\{[\s\S]*\});\n$/);
        expect(match, 'expected serialized metadata to end with `= {...};`').toBeTruthy();
        const parsed = JSON.parse(match![1]);
        expect(parsed.version).toBe('1.0.0');
        expect(parsed.word).toBe('ID');
        expect(parsed.nodes.Definition).toBeDefined();
    });

});

describe('file-writer disk I/O', () => {

    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'langium-treesitter-test-'));
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
    });

    test('writeGrammarJs writes grammar.js to outputDir', async () => {
        const outDir = path.join(tmpDir, 'out');
        await writeGrammarJs(outDir, "module.exports = grammar({ name: 'foo', rules: {} });\n");
        const written = await fs.readFile(path.join(outDir, 'parser', 'grammar.js'), 'utf8');
        expect(written).toContain("module.exports = grammar({ name: 'foo'");
    });

    test('writeGrammarJs writes a CommonJS package.json shim alongside grammar.js', async () => {
        const outDir = path.join(tmpDir, 'cjs-shim');
        await writeGrammarJs(outDir, '// empty\n');
        const pkgJson = await fs.readFile(path.join(outDir, 'parser', 'package.json'), 'utf8');
        expect(JSON.parse(pkgJson)).toEqual({ type: 'commonjs' });
    });

    test('writeGrammarJs creates the directory if missing', async () => {
        const outDir = path.join(tmpDir, 'nested', 'a', 'b');
        expect(await fs.pathExists(outDir)).toBe(false);
        await writeGrammarJs(outDir, '// empty\n');
        expect(await fs.pathExists(path.join(outDir, 'parser', 'grammar.js'))).toBe(true);
    });

    test('writeMetadataTs writes a typed const to metadata.ts', async () => {
        const outDir = path.join(tmpDir, 'out');
        await writeMetadataTs(outDir, {
            version: '1.0.0',
            nodes: { E: { nodeType: 'E', fields: [] } },
            extras: []
        });
        const written = await fs.readFile(path.join(outDir, 'metadata.ts'), 'utf8');
        expect(written).toContain('export const GRAMMAR_METADATA: GrammarMetadata =');
        expect(written).toContain('"version": "1.0.0"');
        expect(written).toContain('"E"');
    });

    test('emitTreeSitterArtifacts writes both grammar.js and metadata.ts', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const outDir = path.join(tmpDir, 'gen');
        const result = await emitTreeSitterArtifacts(grammar, outDir, 'arithmetic');
        expect(result.grammarJsPath).toBe(path.resolve(outDir, 'parser', 'grammar.js'));
        expect(result.metadataTsPath).toBe(path.resolve(outDir, 'metadata.ts'));

        const js = await fs.readFile(result.grammarJsPath, 'utf8');
        const ts = await fs.readFile(result.metadataTsPath, 'utf8');

        // grammar.js: top-level constructs
        expect(js).toContain("name: 'arithmetic'");
        expect(js).toContain('module.exports = grammar({');
        expect(js).toContain('extras: $ =>');
        expect(js).toContain('word: $ => $.ID');
        // every parser rule from the arithmetic grammar appears
        for (const ruleName of ['Definition', 'Addition', 'NumberLiteral', 'NamedExpression']) {
            expect(js).toContain(`${ruleName}: $ =>`);
        }

        // metadata.ts: top-level constructs
        expect(ts).toContain("import type { GrammarMetadata } from 'langium/generate';");
        expect(ts).toContain('export const GRAMMAR_METADATA: GrammarMetadata =');
        expect(ts).toContain('"Definition"');
        expect(ts).toContain('"NamedExpression"');
        expect(ts).toContain('"isRef": true');
    });

});
