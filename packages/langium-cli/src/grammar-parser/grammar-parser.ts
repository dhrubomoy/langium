/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { Parser, Language } from 'web-tree-sitter';
import type { Node } from 'web-tree-sitter';
import { readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getImports, getImportPath } from './grammar-queries.js';

export type SyntaxNode = Node;

const WASM_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'lang',
    'langium-grammar.wasm'
);

export type ParsedGrammarSet = Map<string, SyntaxNode>;

export interface GrammarParser {
    parse(text: string): Promise<SyntaxNode>;
    parseWithImports(entryPath: string): Promise<ParsedGrammarSet>;
}

export class DefaultGrammarParser implements GrammarParser {
    private tsParser: Parser | null = null;

    private async init(): Promise<void> {
        if (this.tsParser) return;
        await Parser.init();
        const language = await Language.load(WASM_PATH);
        this.tsParser = new Parser();
        this.tsParser.setLanguage(language);
    }

    async parse(text: string): Promise<SyntaxNode> {
        await this.init();
        const tree = this.tsParser!.parse(text);
        if (!tree) {
            throw new Error('Tree-sitter parse returned null');
        }
        return tree.rootNode;
    }

    async parseWithImports(entryPath: string): Promise<ParsedGrammarSet> {
        const set: ParsedGrammarSet = new Map();
        await this.parseFile(resolve(entryPath), set);
        return set;
    }

    private async parseFile(filePath: string, set: ParsedGrammarSet): Promise<void> {
        if (set.has(filePath)) return;
        const text = await readFile(filePath, 'utf-8');
        const root = await this.parse(text);
        set.set(filePath, root);
        for (const importNode of getImports(root)) {
            const importPath = getImportPath(importNode);
            const resolved = resolve(dirname(filePath), importPath.replace(/^\//, '') + '.langium');
            await this.parseFile(resolved, set);
        }
    }
}
