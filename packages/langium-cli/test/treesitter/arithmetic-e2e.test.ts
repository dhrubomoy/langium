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
import * as url from 'url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { emitTreeSitterArtifacts } from '../../src/generator/treesitter/file-writer.js';
import { compileMetadata } from '../../src/generator/treesitter/metadata-compiler.js';

const services = createLangiumGrammarServices(EmptyFileSystem);
const parse = parseHelper<Grammar>(services.grammar);

async function parseGrammar(input: string): Promise<Grammar> {
    const document = await parse(input);
    return document.parseResult.value;
}

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
// From packages/langium-cli/test/treesitter to packages/langium/test/fixtures/arithmetic
const FIXTURES_DIR = path.resolve(__dirname, '../../../langium/test/fixtures/arithmetic');

/**
 * The arithmetic grammar shape used as input to the compiler. Mirrors the
 * structure of the hand-written {@link FIXTURES_DIR/grammar.js} (US-003) and
 * {@link FIXTURES_DIR/metadata.ts} (US-004) so the structural assertions
 * downstream make sense. The `examples/arithmetics/` package uses an `infix`
 * rule that expands to the same shape but cannot be directly compared because
 * the compiler lowers it differently; this explicit-precedence form is the
 * one the hand-written fixtures cover.
 */
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

/**
 * Rule names that appear in the hand-written grammar.js but have no
 * counterpart in the Langium-side grammar (and therefore would not appear in
 * the compiled output). `source_file` is tree-sitter's implicit start rule;
 * `Number` is the hand-written terminal name renamed to `NUMBER` in the
 * Langium grammar.
 */
const FIXTURE_ONLY_RULES = new Set(['source_file', 'Number']);

/**
 * Property keys that appear with the `: $ =>` shape inside the grammar({...})
 * options object but are NOT rule names. They must be excluded from the
 * rule-name extraction regex.
 */
const NON_RULE_KEYS = new Set(['word', 'extras', 'name', 'rules', 'supertypes']);

/**
 * Extract the set of rule names defined in a tree-sitter grammar.js text by
 * matching the `<name>: $ => ...` declaration shape inside the rules object.
 */
function extractGrammarJsRuleNames(grammarJs: string): string[] {
    const regex = /(\w+):\s*\$\s*=>/g;
    const names: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(grammarJs)) !== null) {
        const name = match[1];
        if (!NON_RULE_KEYS.has(name)) {
            names.push(name);
        }
    }
    return names;
}

/**
 * Extract every `nodeType: '<name>'` entry from a metadata.ts text. Used to
 * derive the expected NodeMetadata keys from the hand-written fixture without
 * importing it (the langium-cli test rootDir cannot reach into the langium
 * package's test/fixtures directory).
 */
function extractMetadataNodeTypes(metadataTs: string): string[] {
    const regex = /nodeType:\s*'(\w+)'/g;
    const names: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(metadataTs)) !== null) {
        names.push(match[1]);
    }
    return names;
}

describe('treesitter arithmetic end-to-end', () => {

    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'langium-treesitter-e2e-'));
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
    });

    test('every rule name in the hand-written grammar.js fixture is present in the compiled output', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const { grammarJsPath } = await emitTreeSitterArtifacts(grammar, tmpDir, 'arithmetic');
        const compiledJs = await fs.readFile(grammarJsPath, 'utf8');

        const fixtureJs = await fs.readFile(path.join(FIXTURES_DIR, 'grammar.js'), 'utf8');
        const fixtureRules = extractGrammarJsRuleNames(fixtureJs)
            .filter(name => !FIXTURE_ONLY_RULES.has(name));
        expect(fixtureRules.length, 'sanity: fixture should declare some rules').toBeGreaterThan(0);

        for (const ruleName of fixtureRules) {
            expect(compiledJs, `expected rule ${ruleName}: $ => to appear in compiled grammar.js`)
                .toContain(`${ruleName}: $ =>`);
        }
    });

    test('every NodeMetadata entry in the hand-written ARITHMETIC_METADATA fixture is present in the compiled metadata', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const compiled = compileMetadata(grammar);

        const fixtureTs = await fs.readFile(path.join(FIXTURES_DIR, 'metadata.ts'), 'utf8');
        const fixtureNodeTypes = extractMetadataNodeTypes(fixtureTs);
        expect(fixtureNodeTypes.length, 'sanity: fixture should declare some node types').toBeGreaterThan(0);

        for (const nodeType of fixtureNodeTypes) {
            const node = compiled.nodes[nodeType];
            expect(node, `expected node ${nodeType} to be present in compiled metadata`).toBeDefined();
            expect(node.nodeType, `nodeType field should equal key for ${nodeType}`).toBe(nodeType);
        }
    });

    test('compiled metadata.ts file (on disk) contains every fixture node type', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const { metadataTsPath } = await emitTreeSitterArtifacts(grammar, tmpDir, 'arithmetic');
        const compiledTs = await fs.readFile(metadataTsPath, 'utf8');

        const fixtureTs = await fs.readFile(path.join(FIXTURES_DIR, 'metadata.ts'), 'utf8');
        const fixtureNodeTypes = extractMetadataNodeTypes(fixtureTs);

        for (const nodeType of fixtureNodeTypes) {
            // Serialized JSON uses double-quoted keys.
            expect(compiledTs, `expected "${nodeType}" key in compiled metadata.ts`)
                .toContain(`"${nodeType}"`);
        }
    });

    test('compiled metadata word and extras agree with the hand-written fixture', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const compiled = compileMetadata(grammar);

        const fixtureTs = await fs.readFile(path.join(FIXTURES_DIR, 'metadata.ts'), 'utf8');
        // Pull `word: 'ID'` and the extras list literal from the fixture text.
        const wordMatch = fixtureTs.match(/word:\s*'(\w+)'/);
        expect(wordMatch, 'fixture should declare a word terminal').toBeTruthy();
        expect(compiled.word).toBe(wordMatch![1]);

        const extrasMatch = fixtureTs.match(/extras:\s*\[([^\]]*)\]/);
        expect(extrasMatch, 'fixture should declare an extras list').toBeTruthy();
        const fixtureExtras = Array.from(extrasMatch![1].matchAll(/'(\w+)'/g)).map(m => m[1]);
        for (const name of fixtureExtras) {
            expect(compiled.extras, `expected ${name} in compiled extras`).toContain(name);
        }
    });

    test('NamedExpression element field is marked as a cross-reference (matches fixture)', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const compiled = compileMetadata(grammar);
        const named = compiled.nodes.NamedExpression;
        expect(named).toBeDefined();
        const elementField = named.fields.find(f => f.name === 'element');
        expect(elementField?.isRef).toBe(true);
    });

    test('emitTreeSitterArtifacts writes both grammar.js and metadata.ts to disk', async () => {
        const grammar = await parseGrammar(ARITHMETIC_GRAMMAR);
        const { grammarJsPath, metadataTsPath } = await emitTreeSitterArtifacts(grammar, tmpDir, 'arithmetic');
        expect(await fs.pathExists(grammarJsPath)).toBe(true);
        expect(await fs.pathExists(metadataTsPath)).toBe(true);
    });

});
