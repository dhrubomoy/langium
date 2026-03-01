# Phase 4: Polish — Benchmarks, Migration Guide, Example Project, Documentation

**Goal**: Production-readiness polish. Performance benchmarks validate incremental parsing gains,
a migration guide helps existing Langium users adopt Langium-X, a dual-backend example project
demonstrates both Chevrotain and Lezer backends side by side, and documentation covers the new
grammar syntax and architecture.

**Source of truth**: [DESIGN.md](../../DESIGN.md) §9.Phase 4

**Prerequisites**: Phases 1–3 complete — SyntaxNode abstraction, Chevrotain adapter, Lezer adapter
with incremental parsing, and all grammar extensions implemented and tested.

---

## 1. Performance Benchmarks

### 1.1 Benchmark Suite

File: `packages/langium-lezer/test/benchmark/parse-benchmark.test.ts`

A dedicated benchmark suite measuring:

| Metric | Description |
|--------|-------------|
| **Full parse time** | Time to parse a document from scratch (both backends) |
| **Incremental parse time** | Time for Lezer to re-parse after a small edit |
| **Speedup ratio** | `fullTime / incrementalTime` — the incremental advantage |
| **Memory (node count)** | SyntaxNode tree size for both backends |
| **Scaling** | How parse time grows with document size (100→5000 items) |

### 1.2 Test Documents

Use `generateLargeDocument(n)` from `test-helper.ts` with the `LIST_GRAMMAR` to produce
documents at these sizes:

| Size | Items | Approx chars | Purpose |
|------|-------|-------------|---------|
| Small | 100 | ~1.5 KB | Baseline / warm-up |
| Medium | 500 | ~7 KB | Typical DSL file |
| Large | 1000 | ~14 KB | Stress test |
| XL | 5000 | ~72 KB | Extreme / scaling |

Also test with the `Arithmetics` grammar for a more realistic DSL.

### 1.3 Edit Scenarios

For incremental benchmarks, test three edit types:
1. **Single char insertion** — fastest incremental case (middle of document)
2. **Line insertion** — add a new item in the middle
3. **Block replacement** — replace 5 consecutive items with 5 new ones

### 1.4 Implementation

```typescript
// packages/langium-lezer/test/benchmark/parse-benchmark.test.ts

describe('Parse benchmarks', () => {
    // For each document size:
    //   1. Parse fully with Chevrotain, record time
    //   2. Parse fully with Lezer, record time
    //   3. Apply small edit, parse incrementally with Lezer, record time
    //   4. Report: full-chevrotain, full-lezer, incremental-lezer, speedup ratio
    //
    // Use performance.now() with warm-up iterations.
    // Assert: incremental time < full time for docs > 500 items.
});
```

### 1.5 Reporting

Benchmark results are printed to stdout via `console.table()` during test runs.
Use a structured format so results can be captured in CI:

```
┌─────────┬──────────────┬────────────┬──────────────────┬─────────┐
│ Size    │ Chevrotain   │ Lezer Full │ Lezer Incremental│ Speedup │
├─────────┼──────────────┼────────────┼──────────────────┼─────────┤
│ 100     │ X.XX ms      │ X.XX ms    │ X.XX ms          │ X.Xx    │
│ 500     │ X.XX ms      │ X.XX ms    │ X.XX ms          │ X.Xx    │
│ 1000    │ X.XX ms      │ X.XX ms    │ X.XX ms          │ X.Xx    │
│ 5000    │ X.XX ms      │ X.XX ms    │ X.XX ms          │ X.Xx    │
└─────────┴──────────────┴────────────┴──────────────────┴─────────┘
```

---

## 2. Migration Guide

### 2.1 Document

File: `docs/MIGRATION.md`

Target audience: Existing Langium users who want to:
- Try the Lezer backend for incremental parsing
- Use new grammar features (precedence markers, external tokens, etc.)
- Understand the SyntaxNode migration from CstNode

### 2.2 Content Outline

```markdown
# Migrating to Langium-X

## Quick Start
- Install packages: langium-core, langium-chevrotain (or langium-lezer), langium-lsp
- Or use the meta-package: langium (backward-compatible, includes all three)

## What Changed
- $cstNode → $syntaxNode (alias preserved for backward compat)
- CstNode → SyntaxNode interface (read-only, no grammarSource back-pointer)
- GrammarRegistry replaces grammarSource introspection
- ParserAdapter replaces direct Chevrotain calls

## Choosing a Backend
- Chevrotain (default): full backward compat, no incremental, LL parsing
- Lezer: incremental parsing, zero-copy tree, LR parsing, new grammar features

## Configuration
- langium-config.json: add "parserBackend": "lezer"
- CLI: langium generate --backend=lezer

## Code Changes
- $cstNode → $syntaxNode (or keep using $cstNode alias)
- CstNode type → SyntaxNode type
- CstUtils → SyntaxNode methods (childForField, childrenForField)
- grammarSource → GrammarRegistry.getRuleByName(node.type)

## New Grammar Features (Lezer only)
- precedence blocks + @precMarker
- external tokens / external context
- specialize / extend
- conflicts
- @dynamicPrecedence
- local tokens

## Backward Compatibility
- import from 'langium' still works (meta-package)
- $cstNode alias still works
- Chevrotain backend produces identical behavior to upstream Langium
```

---

## 3. Example Project: Dual-Backend Arithmetics

### 3.1 Structure

File: `examples/arithmetics-lezer/`

A copy of the `arithmetics` example configured for the Lezer backend, demonstrating that the
same Langium grammar works with both backends.

```
examples/arithmetics-lezer/
  package.json
  langium-config.json              # parserBackend: "lezer"
  tsconfig.json
  src/
    language-server/
      arithmetics.langium          # Same grammar as arithmetics example
      main.ts                      # Language server entry point
      arithmetics-module.ts        # DI module using LezerModule
      arithmetics-validator.ts     # Same validators (AST-level, backend-agnostic)
    cli/
      main.ts                      # CLI entry point
  test/
    parsing.test.ts                # Parse tests using Lezer backend
```

### 3.2 Key Differences from Chevrotain Example

| Aspect | arithmetics (Chevrotain) | arithmetics-lezer (Lezer) |
|--------|-------------------------|--------------------------|
| `langium-config.json` | No `parserBackend` (default) | `"parserBackend": "lezer"` |
| DI module | Uses `createDefaultModule()` | Uses `createDefaultModule()` + `LezerModule` override |
| Dependencies | `langium` (meta-package) | `langium-core`, `langium-lezer`, `langium-lsp` |
| Generated output | `generated/grammar.ts` | `generated/grammar.ts` + `generated/parser.ts` (parse tables) |
| Incremental | Not supported | Supported via `parseIncremental()` |

### 3.3 Implementation Steps

1. Copy `examples/arithmetics/` to `examples/arithmetics-lezer/`
2. Modify `langium-config.json` to add `"parserBackend": "lezer"`
3. Update `package.json` dependencies to use `langium-core`, `langium-lezer`, `langium-lsp`
4. Update DI module to inject `LezerModule`
5. Add a parse test that exercises incremental parsing
6. Verify `langium generate --backend=lezer` produces working parse tables
7. Verify the language server starts and provides completions, hover, etc.

---

## 4. Documentation

### 4.1 Architecture Overview

File: `docs/ARCHITECTURE.md`

Content:
- High-level pipeline diagram (from DESIGN.md §3.1)
- Package structure and dependencies
- Key interfaces: SyntaxNode, ParserAdapter, GrammarTranslator, GrammarRegistry
- How backends plug in via DI
- Incremental parsing flow

### 4.2 Grammar Extensions Reference

File: `docs/GRAMMAR-EXTENSIONS.md`

Content:
- Each new grammar feature with syntax, examples, and backend support
- Feature support matrix (from DESIGN.md §6.8)
- Terminal rule body formats (regex vs string)
- Best practices for writing backend-portable grammars

### 4.3 Backend Selection Guide

Included in `docs/MIGRATION.md` (§2.2 above) rather than a separate file.

---

## 5. Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `packages/langium-lezer/test/benchmark/parse-benchmark.test.ts` | Create | Performance benchmark suite |
| `docs/MIGRATION.md` | Create | Migration guide for existing Langium users |
| `docs/ARCHITECTURE.md` | Create | Architecture overview |
| `docs/GRAMMAR-EXTENSIONS.md` | Create | Grammar extensions reference |
| `examples/arithmetics-lezer/` | Create | Dual-backend example project |
| `CLAUDE.md` | Update | Mark Phase 4 items as complete |

---

## 6. Checklist

- [ ] Performance benchmark suite (`parse-benchmark.test.ts`)
  - [ ] Full parse: Chevrotain vs Lezer at 100, 500, 1000, 5000 items
  - [ ] Incremental parse: speedup ratio at each size
  - [ ] Three edit scenarios (char insert, line insert, block replace)
  - [ ] Console table output for CI capture
  - [ ] Assertions: incremental < full for docs > 500 items
- [ ] Migration guide (`docs/MIGRATION.md`)
  - [ ] Quick start
  - [ ] What changed (CstNode → SyntaxNode)
  - [ ] Backend selection guidance
  - [ ] Configuration changes
  - [ ] Code migration steps
  - [ ] New grammar features overview
  - [ ] Backward compatibility notes
- [ ] Example project (`examples/arithmetics-lezer/`)
  - [ ] Package setup (package.json, tsconfig, langium-config)
  - [ ] Lezer DI module integration
  - [ ] Parse tests with incremental parsing
  - [ ] Verify langium generate --backend=lezer
- [ ] Documentation
  - [ ] Architecture overview (`docs/ARCHITECTURE.md`)
  - [ ] Grammar extensions reference (`docs/GRAMMAR-EXTENSIONS.md`)
- [ ] Update CLAUDE.md with Phase 4 completion status
