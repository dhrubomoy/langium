---
Status: needs-triage
---

# web-tree-sitter WASM loader service

## What to build

Add `web-tree-sitter` as a runtime dependency of `packages/langium` and create the infrastructure for loading a compiled `.wasm` grammar at service startup.

This is a thin vertical slice: it touches the dependency manifest, the service container initialization signature, and a new `WasmLoader` service interface — but produces no parsing behaviour on its own. The goal is to validate that a `.wasm` file can be located and loaded in both Node.js and VS Code web extension contexts before anything downstream tries to parse.

Concretely:
- Add `web-tree-sitter` to `packages/langium/package.json`
- Define a `WasmLoader` service interface (load a language from a WASM path/URI)
- Provide a default `NodeWasmLoader` implementation that reads from the filesystem
- Thread an `extensionUri`-style initialization parameter through `createLangiumServices()` so consumers can point the loader at `resources/grammar.wasm` regardless of whether they run in Node.js or as a VS Code extension
- Write a unit test that loads a minimal tree-sitter WASM (e.g. tree-sitter-json or a trivially compiled test grammar) and confirms the `Language` object is returned

## Acceptance criteria

- [ ] `web-tree-sitter` appears in `packages/langium/package.json` dependencies
- [ ] `WasmLoader` interface is exported from the `langium` entry point
- [ ] `createLangiumServices()` accepts an optional WASM path/URI parameter and wires it into the service container
- [ ] `NodeWasmLoader` default implementation loads a `.wasm` file from disk and returns a tree-sitter `Language`
- [ ] At least one unit test passes that exercises WASM loading end-to-end
- [ ] No regressions in existing Chevrotain-based tests

## Blocked by

None — can start immediately
