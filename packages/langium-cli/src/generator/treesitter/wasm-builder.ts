/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { spawn } from 'node:child_process';
import fs from 'fs-extra';
import * as path from 'node:path';

/**
 * Optional knobs for {@link buildWasm}, primarily intended for testing.
 */
export interface BuildWasmOptions {
    /**
     * Tree-sitter CLI binary to invoke. Defaults to `'tree-sitter'`, which
     * relies on the binary being on `PATH`. Tests override this to point at a
     * stub script.
     */
    treeSitterBinary?: string;
    /**
     * Working directory for the child processes. Defaults to the directory
     * containing `grammarJsPath` (i.e. the directory holding `grammar.js`).
     * `tree-sitter generate` and `tree-sitter build --wasm` both operate on
     * the grammar in the cwd.
     */
    cwd?: string;
}

/**
 * Drive the tree-sitter CLI to compile a `grammar.js` into `grammar.wasm`.
 *
 * Runs `tree-sitter generate` to produce the C parser sources, then
 * `tree-sitter build --wasm -o <output>` to package them as a WebAssembly
 * module, and finally places the resulting file at
 * `<outputDir>/resources/grammar.wasm`.
 *
 * Throws a user-friendly {@link Error} when the CLI is missing from `PATH` or
 * when either subprocess exits non-zero (the captured stderr is included in
 * the message so the failure is actionable).
 */
export async function buildWasm(
    grammarJsPath: string,
    outputDir: string,
    options: BuildWasmOptions = {}
): Promise<void> {
    const grammarDir = options.cwd ?? path.dirname(grammarJsPath);
    const binary = options.treeSitterBinary ?? 'tree-sitter';

    const resourcesDir = path.resolve(outputDir, 'resources');
    await fs.mkdirs(resourcesDir);

    const finalWasmPath = path.resolve(resourcesDir, 'grammar.wasm');
    const stagedWasmPath = path.resolve(grammarDir, 'grammar.wasm');

    await runTreeSitter(binary, ['generate'], grammarDir);
    await runTreeSitter(binary, ['build', '--wasm', '-o', stagedWasmPath], grammarDir);

    if (!(await fs.pathExists(stagedWasmPath))) {
        throw new Error(
            `tree-sitter build --wasm completed but produced no file at ${stagedWasmPath}. ` +
            'Inspect the tree-sitter output for an unexpected emit location.'
        );
    }

    await fs.move(stagedWasmPath, finalWasmPath, { overwrite: true });
}

function runTreeSitter(binary: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let stdout = '';
        child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr?.on('data', chunk => { stderr += chunk.toString(); });

        child.on('error', err => {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                reject(new Error(
                    `tree-sitter CLI not found (could not spawn '${binary}'). ` +
                    "Install it with 'npm install -g tree-sitter-cli' or 'cargo install tree-sitter-cli', " +
                    'and make sure it is on your PATH.'
                ));
            } else {
                reject(new Error(`Failed to spawn tree-sitter: ${err.message}`));
            }
        });

        child.on('close', code => {
            if (code === 0) {
                resolve();
            } else {
                const detail = stderr.trim() || stdout.trim() || '<no output>';
                reject(new Error(
                    `tree-sitter ${args.join(' ')} exited with code ${code}.\n${detail}`
                ));
            }
        });
    });
}
