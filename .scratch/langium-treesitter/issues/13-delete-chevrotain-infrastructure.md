---
Status: needs-triage
---

# Delete Chevrotain infrastructure (post-v1 cleanup)

## What to build

Remove all Chevrotain-based code once v1 is proven stable in production. This is a breaking change for any downstream consumer of the `langium` package that relies on CST types or parser internals.

**Files to delete:**
- `packages/langium/src/parser/cst-node-builder.ts`
- `packages/langium/src/parser/langium-parser.ts`
- `packages/langium/src/parser/langium-parser-builder.ts`
- `packages/langium/src/parser/parser-builder-base.ts`
- `packages/langium/src/parser/token-builder.ts`
- `packages/langium/src/parser/lexer.ts`
- `packages/langium/src/parser/completion-parser-builder.ts`
- `packages/langium/src/parser/indentation-aware.ts`

**Types to remove from `syntax-tree.ts`:**
- `CstNode`, `CompositeCstNode`, `LeafCstNode`, `RootCstNode` interfaces
- `isCompositeCstNode`, `isLeafCstNode`, `isRootCstNode` guards

**Dependencies to remove from `packages/langium/package.json`:**
- `chevrotain`
- `chevrotain-allstar`
- `@chevrotain/regexp-to-ast`

A major version bump and migration guide are required before this lands.

## Acceptance criteria

- [ ] All Chevrotain files listed above are deleted
- [ ] All CST interfaces and guards are removed from `syntax-tree.ts`
- [ ] All three Chevrotain packages are removed from `package.json`
- [ ] `npm run build` and `npm test` pass with zero references to `chevrotain` remaining
- [ ] A migration guide documents each removed public API and its tree-sitter replacement
- [ ] A major semver bump is applied

## Blocked by

- [07 Arithmetic example end-to-end with generated artifacts](.scratch/langium-treesitter/issues/07-arithmetic-end-to-end-generated.md) — v1 must be stable first
