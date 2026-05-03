---
Status: needs-triage
---

# DocumentIndex interface + single-pass tree walker

## What to build

Define the `DocumentIndex` interface and implement the single-pass tree walker that builds it from a tree-sitter `SyntaxNode` tree using the arithmetic metadata table.

The `DocumentIndex` replaces the CST + AST + Linker pipeline for v1:

```ts
interface DocumentIndex {
  declarations: Map<string, { type: string; range: Range }[]>;
  references:   Map<string, Range[]>;
  diagnostics:  Diagnostic[];
}
```

The tree walker:
- Accepts a tree-sitter root `SyntaxNode` and the `GrammarMetadata` table
- Emits one entry per field marked `isRef: false` with a name into `declarations`
- Emits one entry per field marked `isRef: true` into `references`
- Collects every `ERROR` and `MISSING` node into `diagnostics` as a generic "Syntax error" at the node's range
- Runs in a single traversal — no second pass

Wire this up in the arithmetic example's service container so parsing a document produces a `DocumentIndex`. The index should be rebuilt fully on every document change (tree-sitter handles incremental re-parsing at the C layer; the walker runs over the resulting new tree).

## Acceptance criteria

- [ ] `DocumentIndex` interface and `IndexBuilder` service are exported from the `langium` core
- [ ] `IndexBuilder` produces correct `declarations` entries for arithmetic variable declarations
- [ ] `IndexBuilder` produces correct `references` entries for arithmetic variable references
- [ ] ERROR/MISSING nodes from a malformed arithmetic file appear in `diagnostics` with correct LSP ranges
- [ ] The arithmetic example's service container uses `IndexBuilder` and rebuilds on document change
- [ ] Unit tests cover declaration extraction, reference extraction, and error collection
- [ ] No regressions in existing tests

## Blocked by

- [01 web-tree-sitter WASM loader service](.scratch/langium-treesitter/issues/01-wasm-loader-service.md)
- [02 Hand-written arithmetic grammar.js + metadata.ts](.scratch/langium-treesitter/issues/02-hand-written-arithmetic-grammar.md)
