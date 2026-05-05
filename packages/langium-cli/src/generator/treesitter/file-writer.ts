/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import fs from 'fs-extra';
import { GrammarAST, type Grammar } from 'langium';
import type { GrammarMetadata } from 'langium/generate';
import * as path from 'path';
import {
    compileExtras,
    compileInfixRuleEntry,
    compileParserRuleEntry,
    compileTerminalRuleEntry,
    compileWord
} from './grammar-js-compiler.js';
import { compileMetadata } from './metadata-compiler.js';

const COPYRIGHT_HEADER = `/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/`;

/**
 * Compose the full text of a tree-sitter `grammar.js` module from a Langium
 * grammar. Combines the building-block compilers from
 * {@link ./grammar-js-compiler.js} (parser/terminal rules + extras + word) into
 * the canonical `module.exports = grammar({ ... })` shape that the tree-sitter
 * CLI expects.
 *
 * Fragment parser rules emit with a leading underscore (so tree-sitter inlines
 * them); terminal-rule entries are emitted in declaration order after the
 * parser rules. The `name` field defaults to the grammar's declared name.
 */
export function composeGrammarJs(grammar: Grammar, languageName?: string): string {
    const ruleEntries: string[] = [];
    for (const rule of grammar.rules) {
        if (GrammarAST.isParserRule(rule)) {
            ruleEntries.push(compileParserRuleEntry(rule));
        } else if (GrammarAST.isTerminalRule(rule)) {
            ruleEntries.push(compileTerminalRuleEntry(rule));
        } else if (GrammarAST.isInfixRule(rule)) {
            ruleEntries.push(compileInfixRuleEntry(rule));
        }
    }
    const word = compileWord(grammar);
    const extras = compileExtras(grammar);
    const name = languageName ?? grammar.name ?? 'grammar';

    const lines: string[] = [];
    lines.push(COPYRIGHT_HEADER);
    lines.push('');
    lines.push('/// <reference types="tree-sitter-cli/dsl" />');
    lines.push('');
    lines.push('module.exports = grammar({');
    lines.push(`    name: '${name}',`);
    lines.push('');
    if (word) {
        lines.push(`    word: $ => ${word},`);
        lines.push('');
    }
    lines.push(`    extras: $ => ${extras},`);
    lines.push('');
    lines.push('    rules: {');
    lines.push(ruleEntries.map(entry => `        ${entry}`).join(',\n'));
    lines.push('    }');
    lines.push('});');
    lines.push('');
    return lines.join('\n');
}

/**
 * Serialize a {@link GrammarMetadata} object to TypeScript source code that
 * exports a `GRAMMAR_METADATA` constant. The output mirrors the shape of the
 * hand-written {@link
 * ../../../../langium/test/fixtures/arithmetic/metadata.ts} fixture (Eclipse
 * header, single import, single `export const`).
 *
 * The metadata object is plain data (no functions, class instances, or
 * symbols), so {@link JSON.stringify} round-trips it faithfully.
 */
export function serializeMetadata(metadata: GrammarMetadata): string {
    const body = JSON.stringify(metadata, null, 4);
    return `${COPYRIGHT_HEADER}

import type { GrammarMetadata } from 'langium/generate';

export const GRAMMAR_METADATA: GrammarMetadata = ${body};
`;
}

/**
 * Subdirectory of the tree-sitter output that holds the CommonJS-flavoured
 * `grammar.js` (and its companion `package.json` shim that pins
 * `"type": "commonjs"` so the file loads even when the surrounding workspace
 * is ESM). Kept separate from the parent output directory to avoid the
 * `commonjs` shim affecting sibling TypeScript files like `metadata.ts`.
 */
export const GRAMMAR_JS_SUBDIR = 'parser';

/**
 * Write the composed `grammar.js` module to
 * `<outputDir>/<GRAMMAR_JS_SUBDIR>/grammar.js`. Creates the directory if it
 * does not exist. Also writes a `package.json` with `"type": "commonjs"`
 * alongside `grammar.js` so the CommonJS-style `module.exports` loads
 * correctly even when the surrounding workspace package is ESM.
 */
export async function writeGrammarJs(outputDir: string, grammarJs: string): Promise<void> {
    const grammarDir = path.resolve(outputDir, GRAMMAR_JS_SUBDIR);
    await fs.mkdirs(grammarDir);
    await fs.writeFile(path.resolve(grammarDir, 'grammar.js'), grammarJs);
    await fs.writeFile(
        path.resolve(grammarDir, 'package.json'),
        JSON.stringify({ type: 'commonjs' }, null, 4) + '\n'
    );
}

/**
 * Write the serialized {@link GrammarMetadata} as TypeScript source to
 * `<outputDir>/metadata.ts`. Creates the directory if it does not exist.
 */
export async function writeMetadataTs(outputDir: string, metadata: GrammarMetadata): Promise<void> {
    await fs.mkdirs(outputDir);
    await fs.writeFile(path.resolve(outputDir, 'metadata.ts'), serializeMetadata(metadata));
}

/**
 * Compose grammar.js and metadata.ts from a parsed grammar and write both to
 * the given output directory. Convenience wrapper used by the langium-cli
 * generate pipeline so the caller only deals with one entry point.
 */
export async function emitTreeSitterArtifacts(
    grammar: Grammar,
    outputDir: string,
    languageName?: string
): Promise<{ grammarJsPath: string; metadataTsPath: string }> {
    const grammarJs = composeGrammarJs(grammar, languageName);
    const metadata = compileMetadata(grammar);
    await writeGrammarJs(outputDir, grammarJs);
    await writeMetadataTs(outputDir, metadata);
    return {
        grammarJsPath: path.resolve(outputDir, GRAMMAR_JS_SUBDIR, 'grammar.js'),
        metadataTsPath: path.resolve(outputDir, 'metadata.ts')
    };
}
