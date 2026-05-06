/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import chalk from 'chalk';
import fs from 'fs-extra';
import { validate } from 'jsonschema';
import * as path from 'path';
import { generateAst } from './generator/ast-generator.js';
import { generateBnf } from './generator/bnf-generator.js';
import { generateMonarch } from './generator/highlighting/monarch-generator.js';
import { generatePrismHighlighting } from './generator/highlighting/prism-generator.js';
import { generateTextMate } from './generator/highlighting/textmate-generator.js';
import { getTime, log } from './generator/langium-util.js';
import { generateModule } from './generator/module-generator.js';
import { elapsedTime, getUserChoice, schema } from './generator/node-util.js';
import { compileGrammarJs } from './generator/treesitter/grammar-js-compiler.js';
import { compileMetadata } from './generator/treesitter/metadata-compiler.js';
import { buildWasm } from './generator/treesitter/wasm-builder.js';
import { generateTypesFile } from './generator/types-generator.js';
import { DefaultGrammarParser, type ParsedGrammarSet } from './grammar-parser/grammar-parser.js';
import type { LangiumConfig, LangiumLanguageConfig } from './package-types.js';
import { RelativePath } from './package-types.js';
import { getFilePath, loadConfig } from './package.js';

export async function generate(options: GenerateOptions): Promise<boolean> {
    const config = await loadConfig(options);
    const validation = validate(config, await schema, {
        nestedErrors: true
    });
    if (!validation.valid) {
        log('error', options, chalk.red('Error: Your Langium configuration is invalid.'));
        const errors = validation.errors.filter(error => error.path.length > 0);
        errors.forEach(error => {
            log('error', options, `--> ${error.stack}`);
        });
        return false;
    }
    const result = await runGenerator(config, options);
    if (options.watch) {
        printSuccess(result);
        console.log(getTime() + 'Langium generator will continue running in watch mode.');
        await runWatcher(config, options, await allGeneratorFiles(result));
    }
    // Outside of watch mode, report elapsed time for successful generation.
    printSuccess(result);
    return result.success;
}

async function allGeneratorFiles(results: GeneratorResult): Promise<string[]> {
    const files = Array.from(new Set(results.files));
    const filesExist = await Promise.all(files.map(e => fs.exists(e)));
    return files.filter((_, i) => filesExist[i]);
}

async function runWatcher(config: LangiumConfig, options: GenerateOptions, files: string[]): Promise<void> {
    if (files.length === 0) {
        return;
    }
    const watchers: fs.FSWatcher[] = [];
    for (const grammarFile of files) {
        const watcher = fs.watch(grammarFile, undefined, watch);
        watchers.push(watcher);
    }
    // The watch might be triggered multiple times
    // We only want to execute once
    let watcherTriggered = false;

    async function watch(): Promise<void> {
        if (watcherTriggered) {
            return;
        }
        watcherTriggered = true;
        // Delay the generation a bit in case multiple files are changed at once
        await delay(20);
        console.log(getTime() + 'File change detected. Starting compilation...');
        const results = await runGenerator(config, options);
        for (const watcher of watchers) {
            watcher.close();
        }
        printSuccess(results);
        runWatcher(config, options, await allGeneratorFiles(results));
    }

    await new Promise(() => { /* Never resolve */ });
}

function printSuccess(results: GeneratorResult): void {
    if (results.success) {
        console.log(`${getTime()}Langium generator finished ${chalk.green.bold('successfully')} in ${elapsedTime()}ms`);
    }
}

async function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), ms);
    });
}

export interface GenerateOptions {
    file?: string;
    mode?: 'development' | 'production';
    watch?: boolean;
}

export interface ExtractTypesOptions {
    grammar: string;
    output?: string;
    force: boolean;
}

export interface GeneratorResult {
    success: boolean
    files: string[]
}

export async function runGenerator(config: LangiumConfig, options: GenerateOptions): Promise<GeneratorResult> {
    if (!config.languages || config.languages.length === 0) {
        log('error', options, 'No languages specified in config.');
        return {
            success: false,
            files: []
        };
    }
    if (options.mode) {
        config.mode = options.mode;
    }

    const relPath = config[RelativePath];

    // Parse all entry grammars (and their transitive imports) via DefaultGrammarParser.
    // langSets keeps a per-language view (used for per-language artifacts like
    // textmate/monarch/prism/bnf/treesitter); set is the merged view fed to the
    // shared generators (ast, module, types).
    const grammarParser = new DefaultGrammarParser();
    const langSets = new Map<LangiumLanguageConfig, ParsedGrammarSet>();
    const set: ParsedGrammarSet = new Map();
    for (const languageConfig of config.languages) {
        const absGrammarPath = path.resolve(relPath, languageConfig.grammar);
        const langSet = await grammarParser.parseWithImports(absGrammarPath);
        langSets.set(languageConfig, langSet);
        for (const [uri, root] of langSet.entries()) {
            set.set(uri, root);
        }
    }

    const buildResult: (success: boolean) => GeneratorResult = (success: boolean) => ({
        success,
        files: Array.from(set.keys())
    });

    let hasErrors = false;
    for (const [uri, root] of set.entries()) {
        if (root.hasError) {
            log('error', options, chalk.red(`${getFilePath(uri, config)}: parse errors detected by tree-sitter`));
            hasErrors = true;
        }
    }
    if (hasErrors) {
        log('error', options, `Langium generator ${chalk.red.bold('failed')}.`);
        return buildResult(false);
    }

    // Generate the output files
    const output = path.resolve(relPath, config.out ?? 'src/generated');
    log('log', options, `Writing generated files to ${chalk.white.bold(output)}`);

    if (await rmdirWithFail(output, ['ast.ts', 'grammar.ts', 'module.ts'], options)) {
        return buildResult(false);
    }
    if (await mkdirWithFail(output, options)) {
        return buildResult(false);
    }

    // ast.ts
    const astContent = generateAst(set, config);
    await writeWithFail(path.resolve(updateLangiumInternalAstPath(output, config), 'ast.ts'), astContent, options);

    // module.ts
    const moduleContent = generateModule(set, config);
    await writeWithFail(path.resolve(output, 'module.ts'), moduleContent, options);

    // additional artifacts (per-language)
    for (const [languageConfig, langSet] of langSets.entries()) {
        if (languageConfig.textMate) {
            const tm = generateTextMate(langSet, languageConfig);
            const textMatePath = path.resolve(relPath, languageConfig.textMate.out);
            log('log', options, `Writing textmate grammar to ${chalk.white.bold(textMatePath)}`);
            await writeWithFail(textMatePath, tm, options);
        }

        if (languageConfig.monarch) {
            const monarch = generateMonarch(langSet, languageConfig);
            const monarchPath = path.resolve(relPath, languageConfig.monarch.out);
            log('log', options, `Writing monarch grammar to ${chalk.white.bold(monarchPath)}`);
            await writeWithFail(monarchPath, monarch, options);
        }

        if (languageConfig.prism) {
            const prism = generatePrismHighlighting(langSet, languageConfig);
            const prismPath = path.resolve(relPath, languageConfig.prism.out);
            log('log', options, `Writing prism grammar to ${chalk.white.bold(prismPath)}`);
            await writeWithFail(prismPath, prism, options);
        }

        if (languageConfig.bnf) {
            const bnf = generateBnf(langSet, {
                dialect: languageConfig.bnf.dialect ?? 'GBNF'
            });
            const bnfPath = path.resolve(relPath, languageConfig.bnf.out);
            log('log', options, `Writing BNF grammar to ${chalk.white.bold(bnfPath)}`);
            await writeWithFail(bnfPath, bnf, options);
        }

        if (languageConfig.treesitter) {
            const treesitterDir = path.resolve(relPath, languageConfig.treesitter.out);
            log('log', options, `Writing tree-sitter artifacts to ${chalk.white.bold(treesitterDir)}`);
            const grammarJs = compileGrammarJs(langSet);
            const grammarJsPath = path.resolve(treesitterDir, 'grammar.js');
            await writeWithFail(grammarJsPath, grammarJs, options);
            await writeWithFail(path.resolve(treesitterDir, 'package.json'), '{"type": "commonjs"}\n', options);
            const metadata = compileMetadata(langSet);
            await writeWithFail(path.resolve(treesitterDir, 'metadata.ts'), metadata, options);
            try {
                log('log', options, `Building tree-sitter WASM into ${chalk.white.bold(path.join(treesitterDir, 'resources', 'grammar.wasm'))}`);
                await buildWasm(grammarJsPath, treesitterDir);
            } catch (e) {
                log('error', options, chalk.red(`tree-sitter wasm build failed: ${e instanceof Error ? e.message : String(e)}`));
                return buildResult(false);
            }
        }
    }

    return buildResult(true);
}

function updateLangiumInternalAstPath(output: string, config: LangiumConfig): string {
    if (config.langiumInternal) {
        // The Langium internal ast is generated to the languages package.
        // This is done to prevent internal access to the `langium/grammar` export.
        return path.join(output, '..', '..', 'languages', 'generated');
    } else {
        return output;
    }
}

export async function generateTypes(options: ExtractTypesOptions): Promise<void> {
    const grammarPath = path.isAbsolute(options.grammar) ? options.grammar : path.resolve('.', options.grammar);
    if (!fs.existsSync(grammarPath) || !fs.lstatSync(grammarPath).isFile()) {
        log('error', { watch: false }, chalk.red(`Grammar file '${grammarPath}' doesn't exist or is not a file.`));
        return;
    }
    const outputPath = options.output ?? path.join(path.resolve(grammarPath, '..'), 'types.langium');
    const typesFilePath = path.isAbsolute(outputPath) ? outputPath : path.join('.', outputPath);
    if (!options.force && fs.existsSync(typesFilePath)) {
        const overwriteTypesFile =
            await getUserChoice(`Target file '${path.relative('.', typesFilePath)}' already exists. Overwrite?`, ['yes', 'no'], 'yes') === 'yes';
        if (!overwriteTypesFile) {
            log('log', { watch: false }, 'Generation canceled.');
            return;
        }
    }
    const parser = new DefaultGrammarParser();
    const set = await parser.parseWithImports(grammarPath);
    const genTypes = generateTypesFile(set);
    await writeWithFail(typesFilePath, genTypes, { watch: false });
    log('log', { watch: false }, `Generated type definitions to: ${chalk.white.bold(typesFilePath)}`);
    return;
}

async function rmdirWithFail(dirPath: string, expectedFiles: string[], options: GenerateOptions): Promise<boolean> {
    try {
        let deleteDir = true;
        const dirExists = await fs.pathExists(dirPath);
        if (dirExists) {
            const existingFiles = await fs.readdir(dirPath);
            const unexpectedFiles = existingFiles.filter(file => !expectedFiles.includes(path.basename(file)));
            if (unexpectedFiles.length > 0) {
                log('log', options, `Found unexpected files in the generated directory: ${unexpectedFiles.map(e => chalk.yellow(e)).join(', ')}`);
                deleteDir = await getUserChoice('Do you want to delete the files?', ['yes', 'no'], 'yes') === 'yes';
            }
            if (deleteDir) {
                await fs.remove(dirPath);
            }
        }
        return false;
    } catch (e) {
        log('error', options, `Failed to delete directory ${chalk.red.bold(dirPath)}`, e);
        return true;
    }
}

async function mkdirWithFail(path: string, options: GenerateOptions): Promise<boolean> {
    try {
        await fs.mkdirs(path);
        return false;
    } catch (e) {
        log('error', options, `Failed to create directory ${chalk.red.bold(path)}`, e);
        return true;
    }
}

async function writeWithFail(filePath: string, content: string, options: GenerateOptions): Promise<void> {
    try {
        const parentDir = path.dirname(filePath);
        await mkdirWithFail(parentDir, options);
        await fs.writeFile(filePath, content);
    } catch (e) {
        log('error', options, `Failed to write file to ${chalk.red.bold(filePath)}`, e);
    }
}
