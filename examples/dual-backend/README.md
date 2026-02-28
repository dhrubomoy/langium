# Dual-Backend Example

Demonstrates Langium-X's parser-agnostic architecture by parsing the same grammar with both
the Chevrotain and Lezer backends.

## What This Shows

1. **Cross-backend equivalence**: Both backends parse the same grammar and produce the same AST
2. **Incremental parsing**: The Lezer backend re-parses only changed regions on each edit
3. **Performance comparison**: Incremental parsing is 3-4x faster than full parsing for large documents

## Grammar

A simple task list DSL (`src/grammar.langium`):

```
project MyProject
task setup : high ;
task build ;
task test : medium ;
task deploy : critical ;
```

## Running

```bash
npm test
```
