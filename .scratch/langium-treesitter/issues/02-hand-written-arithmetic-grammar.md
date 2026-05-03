---
Status: needs-triage
---

# Hand-written arithmetic grammar.js + metadata.ts

## What to build

Produce the tree-sitter grammar definition (`grammar.js`) and the metadata mapping table (`src/generated/metadata.ts`) for the arithmetic example **by hand**, without a grammar compiler. Compile it to `grammar.wasm` via the tree-sitter CLI.

This slice is the tracer bullet that validates the shape of the output format before the compiler exists. Every design decision made here becomes the spec that the grammar compiler (issue 06) must reproduce from `.langium` source.

The arithmetic language covers: variable declarations with an initializer expression, binary arithmetic expressions with correct operator precedence, integer and float literals, identifier cross-references, and line comments.

The grammar.js must use:
- `word` property for the identifier terminal
- `field()` for every assignment and cross-reference
- `prec.left()` / `prec.right()` for operator precedence
- `extras` for whitespace and comments

The metadata.ts must encode: `astType`, `fields` (with `operator`, `isRef`, optional `transform`), and `passThrough` for expression unwrapping.

Compile to `grammar.wasm` using `tree-sitter generate` + `tree-sitter build-wasm` and check the compiled artifact into `examples/arithmetics/resources/grammar.wasm`.

Verify using tree-sitter CLI's own test harness (`tree-sitter test`) and by parsing a representative arithmetic file. This can be done independently of issue 01.

## Acceptance criteria

- [ ] `examples/arithmetics/src/language-server/generated/grammar.js` is a valid tree-sitter grammar that the CLI can compile without errors
- [ ] `examples/arithmetics/src/language-server/generated/metadata.ts` contains entries for all arithmetic node types, fields, and cross-reference markers
- [ ] `examples/arithmetics/resources/grammar.wasm` is committed and passes `tree-sitter test` for at least three arithmetic expressions and one variable declaration with a cross-reference
- [ ] The metadata shape matches the `GrammarMetadata` interface defined in the plan (astType, fields with operator/isRef, passThrough)
- [ ] A code comment at the top of `grammar.js` notes that this file is the hand-written reference spec for the grammar compiler

## Blocked by

None — can start immediately
