---
Status: needs-triage
---

# 7 LSP services wired to DocumentIndex

## What to build

Implement the seven LSP features for v1 using the `DocumentIndex` as the sole data source:

| Feature | Implementation |
|---|---|
| Parse error diagnostics | `diagnostics` array from `DocumentIndex` |
| Cross-ref diagnostics | References whose name has no entry in `declarations` map |
| Go-to-definition | Look up name at cursor in `declarations` map → return first range |
| Find references | Look up name at cursor in `references` map → return all ranges |
| Document symbols | All entries in `declarations` map |
| Rename | All ranges in `declarations` + `references` for the name at cursor |
| Folding ranges | tree-sitter node ranges for top-level composite nodes |

Wire all seven into the arithmetic example's service container. Verify end-to-end by opening an `.arithmetics` file and exercising each feature.

This slice completes the v1 user-facing milestone: a real arithmetic language with working LSP support backed by tree-sitter.

## Acceptance criteria

- [ ] Opening a syntactically invalid `.arithmetics` file shows parse error diagnostics at the correct positions
- [ ] Referencing an undeclared variable shows a cross-ref diagnostic
- [ ] Go-to-definition on a variable reference navigates to its declaration
- [ ] Find references on a declaration returns all usage sites
- [ ] Document symbols lists all declared variables
- [ ] Rename renames all declaration and reference sites atomically
- [ ] Folding ranges collapse top-level declarations
- [ ] All seven features are covered by integration tests using `langium/test` infrastructure
- [ ] No regressions in existing tests

## Blocked by

- [03 DocumentIndex interface + single-pass tree walker](.scratch/langium-treesitter/issues/03-document-index-tree-walker.md)
