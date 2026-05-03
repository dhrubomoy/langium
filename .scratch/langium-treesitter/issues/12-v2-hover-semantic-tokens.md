---
Status: needs-triage
---

# [v2] Hover and semantic tokens

## What to build

Implement the two remaining LSP features deferred from v1:

**Hover:** Given a cursor position, derive the AST type from the `DocumentIndex` + metadata `astType` field and return a markdown tooltip.

**Semantic tokens:** Classify tree-sitter node types using the metadata `astType` mapping and emit LSP semantic token deltas. Enables editor-side syntax highlighting beyond what TextMate grammars can express.

This is a placeholder — exact token type vocabulary should align with what LSP semantic tokens support and how the metadata is structured after v1.

## Acceptance criteria

- [ ] Hovering over a variable reference shows its declared type
- [ ] Hovering over a literal shows its value type
- [ ] Semantic tokens are emitted for a complete arithmetic document with no gaps or overlaps
- [ ] Token types are configurable per language via the service container

## Blocked by

- [07 Arithmetic example end-to-end with generated artifacts](.scratch/langium-treesitter/issues/07-arithmetic-end-to-end-generated.md)
