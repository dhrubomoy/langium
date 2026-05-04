/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildWasm } from '../../../src/generator/treesitter/wasm-builder.js';

const isWindows = process.platform === 'win32';
const NODE_EXE = process.execPath;

/**
 * Write a node script that emulates the relevant portion of the tree-sitter
 * CLI for these tests. The first arg is the subcommand: `generate` is a
 * no-op, `build` recognises `--wasm -o <path>` and writes a stub `.wasm`
 * file at the given output path.
 *
 * The script honours an env variable `STUB_FAIL_ON` so a single test can
 * make either subcommand fail with a non-zero exit code.
 */
async function writeTreeSitterStub(dir: string): Promise<string> {
    const scriptPath = path.join(dir, 'tree-sitter-stub.cjs');
    const script = [
        'const fs = require(\'fs\');',
        'const args = process.argv.slice(2);',
        'const failOn = process.env.STUB_FAIL_ON;',
        'if (failOn && args[0] === failOn) {',
        '    process.stderr.write(`stub: simulated failure for ${failOn}\\n`);',
        '    process.exit(2);',
        '}',
        "if (args[0] === 'build' && args.includes('--wasm')) {",
        "    const oIdx = args.indexOf('-o');",
        '    if (oIdx >= 0 && args[oIdx + 1]) {',
        "        fs.writeFileSync(args[oIdx + 1], 'STUB_WASM');",
        '    }',
        '}',
        'process.exit(0);'
    ].join('\n');
    await fs.writeFile(scriptPath, script);
    return scriptPath;
}

/**
 * On POSIX systems we can spawn an executable shim directly. On Windows we
 * always invoke node + the script path because shebangs don't work natively.
 */
async function makeStubBinary(workDir: string): Promise<{ binary: string; cwd: string }> {
    const stub = await writeTreeSitterStub(workDir);
    if (isWindows) {
        // Ask spawn to run `node stub.mjs` by overriding the binary to node and
        // pre-pending the script path via a wrapper .cmd file. To keep the test
        // single-process and deterministic, we simply hand a wrapper script in
        // PATH-resolution-independent form: a small .cmd that forwards args.
        const wrapper = path.join(workDir, 'tree-sitter.cmd');
        await fs.writeFile(wrapper, `@echo off\r\n"${NODE_EXE}" "${stub}" %*\r\n`);
        return { binary: wrapper, cwd: workDir };
    }
    const wrapper = path.join(workDir, 'tree-sitter');
    await fs.writeFile(wrapper, `#!/bin/sh\nexec "${NODE_EXE}" "${stub}" "$@"\n`);
    await fs.chmod(wrapper, 0o755);
    return { binary: wrapper, cwd: workDir };
}

describe('wasm-builder buildWasm', () => {

    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'langium-wasm-test-'));
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
    });

    test('throws a user-friendly error when the tree-sitter CLI is missing', async () => {
        const grammarJs = path.join(tmpDir, 'grammar.js');
        await fs.writeFile(grammarJs, "module.exports = grammar({ name: 'x', rules: {} });\n");
        const outDir = path.join(tmpDir, 'out');
        await expect(
            buildWasm(grammarJs, outDir, { treeSitterBinary: path.join(tmpDir, 'definitely-not-here') })
        ).rejects.toThrow(/tree-sitter CLI not found/);
    });

    test('rejects with stderr when tree-sitter generate exits non-zero', async () => {
        const grammarJs = path.join(tmpDir, 'grammar.js');
        await fs.writeFile(grammarJs, "module.exports = grammar({ name: 'x', rules: {} });\n");
        const outDir = path.join(tmpDir, 'out');

        const stub = await makeStubBinary(tmpDir);
        process.env.STUB_FAIL_ON = 'generate';
        try {
            await expect(
                buildWasm(grammarJs, outDir, { treeSitterBinary: stub.binary, cwd: stub.cwd })
            ).rejects.toThrow(/tree-sitter generate exited with code 2/);
        } finally {
            delete process.env.STUB_FAIL_ON;
        }
    });

    test('rejects with stderr when tree-sitter build --wasm exits non-zero', async () => {
        const grammarJs = path.join(tmpDir, 'grammar.js');
        await fs.writeFile(grammarJs, "module.exports = grammar({ name: 'x', rules: {} });\n");
        const outDir = path.join(tmpDir, 'out');

        const stub = await makeStubBinary(tmpDir);
        process.env.STUB_FAIL_ON = 'build';
        try {
            await expect(
                buildWasm(grammarJs, outDir, { treeSitterBinary: stub.binary, cwd: stub.cwd })
            ).rejects.toThrow(/tree-sitter build --wasm .* exited with code 2/);
        } finally {
            delete process.env.STUB_FAIL_ON;
        }
    });

    test('writes grammar.wasm into <outputDir>/resources/ on success', async () => {
        const grammarJs = path.join(tmpDir, 'grammar.js');
        await fs.writeFile(grammarJs, "module.exports = grammar({ name: 'x', rules: {} });\n");
        const outDir = path.join(tmpDir, 'out');

        const stub = await makeStubBinary(tmpDir);
        await buildWasm(grammarJs, outDir, { treeSitterBinary: stub.binary, cwd: stub.cwd });

        const finalWasm = path.join(outDir, 'resources', 'grammar.wasm');
        expect(await fs.pathExists(finalWasm)).toBe(true);
        expect(await fs.readFile(finalWasm, 'utf8')).toBe('STUB_WASM');
    });

    test('creates the resources/ directory if it does not exist', async () => {
        const grammarJs = path.join(tmpDir, 'grammar.js');
        await fs.writeFile(grammarJs, "module.exports = grammar({ name: 'x', rules: {} });\n");
        const outDir = path.join(tmpDir, 'deeply', 'nested', 'out');

        const stub = await makeStubBinary(tmpDir);
        await buildWasm(grammarJs, outDir, { treeSitterBinary: stub.binary, cwd: stub.cwd });

        expect(await fs.pathExists(path.join(outDir, 'resources', 'grammar.wasm'))).toBe(true);
    });

    test('throws when the build step finishes but produces no .wasm file', async () => {
        const grammarJs = path.join(tmpDir, 'grammar.js');
        await fs.writeFile(grammarJs, "module.exports = grammar({ name: 'x', rules: {} });\n");
        const outDir = path.join(tmpDir, 'out');

        // A stub that exits 0 for both commands but never writes a .wasm.
        const silentStubPath = path.join(tmpDir, 'silent-stub.cjs');
        await fs.writeFile(silentStubPath, 'process.exit(0);');
        const wrapperPath = path.join(tmpDir, isWindows ? 'tree-sitter.cmd' : 'tree-sitter');
        if (isWindows) {
            await fs.writeFile(wrapperPath, `@echo off\r\n"${NODE_EXE}" "${silentStubPath}" %*\r\n`);
        } else {
            await fs.writeFile(wrapperPath, `#!/bin/sh\nexec "${NODE_EXE}" "${silentStubPath}" "$@"\n`);
            await fs.chmod(wrapperPath, 0o755);
        }

        await expect(
            buildWasm(grammarJs, outDir, { treeSitterBinary: wrapperPath, cwd: tmpDir })
        ).rejects.toThrow(/produced no file/);
    });

});
