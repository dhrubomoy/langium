---
Status: needs-triage
---

# [v2] External scanner support

## What to build

Add an `external terminal` declaration to the `.langium` grammar syntax and have the grammar compiler generate a C scanner skeleton (`scanner.c`) for patterns that can't be expressed as regex (nested comments, indentation-sensitive parsing, heredocs, etc.).

Language authors implement the scanner body; the compiler generates the boilerplate and the build plumbing to link it into the WASM.

This is a placeholder — design depends on how tree-sitter's external scanner API looks in practice against the first real use case.

## Acceptance criteria

- [ ] `external terminal FOO;` is parsed by the CLI without error
- [ ] `langium generate` emits a `scanner.c` skeleton with the correct tree-sitter callback signatures
- [ ] The compiler links the external scanner into the compiled WASM
- [ ] At least one integration test exercises a language that requires an external scanner (e.g. nested block comments)

## Blocked by

- [07 Arithmetic example end-to-end with generated artifacts](.scratch/langium-treesitter/issues/07-arithmetic-end-to-end-generated.md)
