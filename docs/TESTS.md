# Dual-Backend Test Coverage

This document tracks which LSP tests run against both Chevrotain and Lezer backends,
which are Chevrotain-only, and documents known Lezer limitations that cause skips.

## Test File Matrix

| Test File | Chevrotain | Lezer | Notes |
|-----------|:----------:|:-----:|-------|
| `completion-provider.test.ts` | ✅ | Partial | 4 describe blocks skip Lezer (see below) |
| `goto-definition.test.ts` | ✅ | Partial | 2 describe blocks skip Lezer (see below) |
| `hover.test.ts` | ✅ | ✅ | "Hover on keywords" runs both backends |
| `execute-command-handler.test.ts` | ✅ | ✅ | All tests run both backends |
| `workspace-symbol.test.ts` | ✅ | ✅ | All tests run both backends |
| `find-references.test.ts` | ✅ | ❌ | Langium grammar language only (Chevrotain-only) |
| `find-references-dual.test.ts` | ✅ | ✅ | Custom grammar, both backends |
| `document-highlight.test.ts` | ✅ | ❌ | Langium grammar language only (Chevrotain-only) |
| `document-highlight-dual.test.ts` | ✅ | ✅ | Custom grammar, both backends |
| `document-symbol.test.ts` | ✅ | ❌ | Langium grammar language only (Chevrotain-only) |
| `document-symbol-dual.test.ts` | ✅ | ✅ | Custom grammar, both backends |
| `folding-range.test.ts` | ✅ | ❌ | Langium grammar language only (Chevrotain-only) |
| `folding-range-dual.test.ts` | ✅ | ✅ | Custom grammar, both backends (comment folding Chevrotain-only) |
| `fuzzy-matcher.test.ts` | N/A | N/A | Utility tests, no grammar/parser involved |
| `signatureHelpProvider.test.ts` | N/A | N/A | Utility tests, no grammar/parser involved |

## Lezer-Skipped Describe Blocks

### completion-provider.test.ts

| Describe Block | Skip Reason |
|----------------|-------------|
| `Completion within alternatives` | Completion provider uses Chevrotain-specific tokenizer (`backtrackToAnyToken`) |
| `Completion in data type rules` | Completion provider uses Chevrotain-specific tokenizer (`backtrackToAnyToken`) |
| `Infix rule completion` | Infix grammars fail Lezer grammar generation |
| `Completion for optional elements` | Completion provider uses Chevrotain-specific tokenizer (`backtrackToAnyToken`) |

### goto-definition.test.ts

| Describe Block | Skip Reason |
|----------------|-------------|
| `Definition Provider datatype rule` | Test navigates FROM cross-reference positions which requires `findAssignmentSN()` — not yet implemented for non-Chevrotain backends |
| `Definition Provider with Infix Operators` | Infix grammars with alternatives fail Lezer grammar generation |

## Known Lezer Limitations

These limitations cause certain test patterns to be skipped or constrained for the Lezer backend:

### ~~1. Alternative Rules (`A: B | C;`)~~ — FIXED
Alternative rules now work correctly. `SyntaxNodeAstBuilder.inlineChildNode()` processes
unassigned child SyntaxNodes directly on the parent AstNode (setting `$type` from the child,
processing the child's assignments, and mapping both SyntaxNodes to the same AstNode).
This mirrors what Chevrotain's `action()` callback does at parse time.

### 2. Completion Provider Tokenizer
`DefaultCompletionProvider.backtrackToAnyToken()` accesses the Chevrotain-specific tokenizer
(`services.parser.LangiumParser.tokenize()`), which is undefined for Lezer backends. This
causes `TypeError: Cannot read properties of undefined (reading 'tokenize')`.

**Impact:** All completion tests that exercise `backtrackToAnyToken` skip Lezer.

### 3. Infix Grammar Generation
Grammars with `infix` rules fail Lezer grammar generation entirely (`createServices` returns
`null`).

**Impact:** Infix-related test blocks are skipped for Lezer.

### 4. Cross-Reference Position Navigation
Finding references FROM cross-reference positions (as opposed to FROM declaration positions)
doesn't work reliably with Lezer. The `findAssignmentSN`/`findDeclarationsSN` path doesn't
correctly identify cross-reference nodes in Lezer SyntaxNode trees.

**Impact:** Dual-backend find-references and document-highlight tests only test from
declaration positions, not from cross-reference positions.

### 5. Comment Folding
Comment-based folding ranges are not supported with the Lezer backend. The folding range
provider's comment detection relies on Chevrotain token types.

**Impact:** `folding-range-dual.test.ts` skips the comment folding test for Lezer.

## Future Work

- Implement a Lezer-compatible completion provider (or make `backtrackToAnyToken` backend-agnostic)
- Add cross-reference position navigation support for Lezer SyntaxNodes (`findAssignmentSN`)
- Add comment folding support for Lezer (detect comment nodes by type name)
