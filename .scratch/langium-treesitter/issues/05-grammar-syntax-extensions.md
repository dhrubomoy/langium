---
Status: needs-triage
---

# Grammar syntax extensions: @word, @prec, conflicts

## What to build

Extend the Langium grammar language itself (`langium-grammar.langium` and the CLI's generated AST) to recognise three new constructs that map directly to tree-sitter grammar properties:

**`@word` on a terminal rule** — marks which terminal is tree-sitter's `word` rule (used for keyword disambiguation):
```langium
@word terminal ID: /[a-zA-Z_][a-zA-Z0-9_]*/;
```

**`@prec(n)` annotation on an alternative or rule element** — wraps the corresponding tree-sitter rule in a `prec()` / `prec.left()` / `prec.right()` call:
```langium
Expression:
    @prec(2) left=Expression op='+' right=Expression
  | @prec(1) left=Expression op='*' right=Expression
  | value=INT;
```

**`conflicts` block at grammar top level** — emits the tree-sitter `conflicts` array:
```langium
conflicts:
    [Expression, Statement];
```

Also add compile-error output for each dropped feature (`UnorderedGroup`, `RuleParameter`, `NegatedToken`, `UntilToken`, semantic predicates, terminal lookahead assertions) with a migration hint message.

This slice touches `packages/langium/src/grammar/langium-grammar.langium`, the generated AST types, and `packages/langium-cli` parser/validator. It does not implement any tree-sitter emission yet — that is issue 06.

## Acceptance criteria

- [ ] `@word` on a terminal rule is parsed and represented in the grammar AST without error
- [ ] `@prec(n)` annotation on alternatives is parsed and represented in the grammar AST
- [ ] `conflicts: [A, B]` block at grammar top level is parsed and represented in the grammar AST
- [ ] Each dropped feature produces a compile error with a migration hint when present in a `.langium` file
- [ ] `packages/langium-cli` tests cover parsing of all three new constructs
- [ ] `npm run langium:generate` succeeds after updating `langium-grammar.langium`
- [ ] No regressions in existing grammar parsing tests

## Blocked by

None — can start immediately
