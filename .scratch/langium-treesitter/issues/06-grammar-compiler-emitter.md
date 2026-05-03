---
Status: needs-triage
---

# Grammar compiler: grammar.js + metadata.ts emitter

## What to build

Extend `langium generate` with a new generator that translates a `.langium` grammar file into:

1. **`grammar.js`** — a tree-sitter grammar definition
2. **`src/generated/metadata.ts`** — the `GrammarMetadata` mapping table
3. Invokes the tree-sitter CLI (`tree-sitter generate` + `tree-sitter build-wasm`) to produce `resources/grammar.wasm`

Translation rules from `.langium` → tree-sitter:
- Parser rules → `seq()`, `choice()`, `repeat()`, `optional()`
- `InfixRule` → `prec.left()` / `prec.right()`
- Assignments (`=`, `+=`, `?=`) → `field('name', ...)` in grammar.js + metadata entry with correct `operator`
- `Action` (`{infer T}`) → metadata entry for node type variant selection
- `CrossReference` (`[Type:T]`) → `field('name', ...)` + metadata `isRef: true, refType`
- `@word` terminal → grammar.js `word` property
- `@prec(n)` annotations → `prec()` wrappers
- `conflicts` block → grammar.js `conflicts` array
- `fragment` rules → `_`-prefixed inline rules
- `hidden terminal` → `extras` array

The output for `examples/arithmetics/arithmetics.langium` must exactly match (or be semantically equivalent to) the hand-written files from issue 02.

Add the new generator as `packages/langium-cli/src/generator/tree-sitter-grammar-generator.ts` and hook it into the existing `generate.ts` orchestrator.

## Acceptance criteria

- [ ] `langium generate` on the arithmetic `.langium` grammar produces a `grammar.js` that compiles without tree-sitter CLI errors
- [ ] The generated `metadata.ts` contains entries semantically equivalent to the hand-written version from issue 02
- [ ] `tree-sitter generate` + `tree-sitter build-wasm` succeed on the generated `grammar.js`
- [ ] All translation rules listed above are exercised by the arithmetic grammar
- [ ] Compiler emits an error with migration hint for each dropped feature (UnorderedGroup, RuleParameter, NegatedToken, UntilToken, semantic predicates, lookahead assertions)
- [ ] Unit tests cover each translation rule
- [ ] No regressions in existing `langium generate` output for non-tree-sitter paths

## Blocked by

- [02 Hand-written arithmetic grammar.js + metadata.ts](.scratch/langium-treesitter/issues/02-hand-written-arithmetic-grammar.md) — hand-written files are the output spec
- [05 Grammar syntax extensions: @word, @prec, conflicts](.scratch/langium-treesitter/issues/05-grammar-syntax-extensions.md) — CLI must be able to parse the new annotations
