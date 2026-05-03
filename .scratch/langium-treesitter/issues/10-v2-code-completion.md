---
Status: needs-triage
---

# [v2] Code completion via follow-set table

## What to build

Implement code completion by computing follow sets statically at grammar compile time and emitting them into `metadata.ts` alongside the mapping table.

At runtime: given a cursor position, find the enclosing tree-sitter node and look up valid next tokens in the follow-set table. Return them as LSP completion items.

This is a placeholder — the `LangiumCompletionParser` is explicitly deferred to v2.

## Acceptance criteria

- [ ] `langium generate` emits a follow-set table in `metadata.ts`
- [ ] Completion provider returns correct tokens for at least three cursor positions in an arithmetic file
- [ ] Completion works for keywords, operator tokens, and identifier cross-references

## Blocked by

- [07 Arithmetic example end-to-end with generated artifacts](.scratch/langium-treesitter/issues/07-arithmetic-end-to-end-generated.md)
