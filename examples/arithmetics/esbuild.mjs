//@ts-check
import * as esbuild from 'esbuild';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts', 'src/language-server/main.ts'],
    outdir: 'out',
    outExtension: {
        '.js': '.cjs'
    },
    bundle: true,
    target: "ES2017",
    format: 'cjs',
    loader: { '.ts': 'ts' },
    external: ['vscode'],
    platform: 'node',
    sourcemap: true,
    // Silence the "import.meta is empty" warning. The arithmetics-module
    // intentionally guards `import.meta.url` behind a `typeof __dirname` check
    // so the empty-string fallback is never reached at runtime.
    logOverride: {
        'empty-import-meta': 'silent'
    }
});

await copyWasm();

if (watch) {
    await ctx.watch();
} else {
    await ctx.rebuild();
    ctx.dispose();
}

async function copyWasm() {
    const src = 'src/language-server/generated/treesitter/resources/grammar.wasm';
    const dst = 'out/language-server/generated/treesitter/resources/grammar.wasm';
    try {
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.copyFile(src, dst);
    } catch (err) {
        // Wasm may not exist yet (e.g. first build before `langium generate`).
        // The language server still functions on the chevrotain path in that case.
        if (err && err.code !== 'ENOENT') {
            throw err;
        }
    }
}
