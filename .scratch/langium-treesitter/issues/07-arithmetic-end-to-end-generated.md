---
Status: needs-triage
---

# Arithmetic example end-to-end with generated artifacts

## What to build

Replace the hand-written `grammar.js`, `metadata.ts`, and `grammar.wasm` in the arithmetic example with the artifacts produced by `langium generate`, and verify that all 7 LSP features continue to work.

This slice closes v1: the full pipeline from `.langium` source → `langium generate` → tree-sitter WASM → `DocumentIndex` → LSP is exercised end-to-end with no hand-written intermediates.

Steps:
- Run `langium generate` on `examples/arithmetics/arithmetics.langium` to regenerate `grammar.js` and `metadata.ts`
- Invoke the tree-sitter CLI to recompile `grammar.wasm`
- Delete or archive the hand-written reference files
- Run the full arithmetic integration test suite to confirm no regressions
- Add a CI step (or a note in the arithmetic example's `package.json` scripts) that regenerates and recompiles as part of the build

## Acceptance criteria

- [ ] `grammar.js` and `metadata.ts` in the arithmetic example are generated files (with a "do not edit" header), not hand-written
- [ ] `langium generate` on a clean checkout produces a `grammar.wasm` that is byte-for-byte identical (or behaviourally equivalent) to the committed one
- [ ] All 7 LSP integration tests from issue 04 pass against the generated artifacts
- [ ] A CI/build step regenerates and recompiles so drift is caught automatically
- [ ] No regressions in any test across the monorepo

## Blocked by

- [04 7 LSP services wired to DocumentIndex](.scratch/langium-treesitter/issues/04-lsp-services-document-index.md)
- [06 Grammar compiler: grammar.js + metadata.ts emitter](.scratch/langium-treesitter/issues/06-grammar-compiler-emitter.md)
