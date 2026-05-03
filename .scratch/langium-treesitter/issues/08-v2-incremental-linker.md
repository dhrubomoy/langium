---
Status: needs-triage
---

# [v2] Index-based incremental linker

## What to build

Replace the full `DocumentIndex` rebuild from v1 with a partial update that only re-resolves references whose source range overlaps a changed tree-sitter node.

Use tree-sitter's `node.hasChanges` flag (set after an incremental parse) to identify dirty ranges. Only re-walk subtrees containing changed nodes, and only invalidate references that intersect those ranges.

This is a placeholder — scope and design should be revisited once v1 is stable.

## Acceptance criteria

- [ ] After a single-character edit in a large arithmetic document, only references in the changed subtree are re-resolved
- [ ] Benchmark shows measurable latency improvement over full rebuild for documents > 1000 lines
- [ ] All existing v1 LSP integration tests pass unchanged

## Blocked by

- [07 Arithmetic example end-to-end with generated artifacts](.scratch/langium-treesitter/issues/07-arithmetic-end-to-end-generated.md) — v1 must be stable first
