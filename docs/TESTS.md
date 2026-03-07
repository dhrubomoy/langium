# Dual-Backend Test Coverage

This document tracks which LSP tests run against both Chevrotain and Lezer backends,
which are Chevrotain-only, and documents known Lezer limitations that cause skips.

## Test File Matrix

| Test File | Chevrotain | Lezer | Notes |
|-----------|:----------:|:-----:|-------|
| `completion-provider.test.ts` | ✅ | Partial | LezerCompletionProvider passes most tests; 3 individual tests skip Lezer (see below) |
| `goto-definition.test.ts` | ✅ | Partial | 2 describe blocks skip Lezer (see below); cross-ref navigation block runs both |
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

A dedicated `LezerCompletionProvider` replaces the Chevrotain-specific `DefaultCompletionProvider`
for Lezer backends. It uses the existing parse tree (SyntaxNode) to derive completion context
instead of Chevrotain's completion parser and lexer. Most completion tests pass for both backends.

| Skipped Test | Skip Reason |
|--------------|-------------|
| `Should show documentation on completion items` | ML_COMMENT hidden terminal regex is not correctly translated to Lezer grammar, causing comment text to be parsed as identifiers |
| `Should not remove same named NodeDescriptions` | Test explicitly extends `DefaultCompletionProvider` (Chevrotain-specific) |
| `Can perform completion for fully qualified names` | Anonymous punctuation tokens (like `"."`) in data type rules are not preserved in the Lezer parse tree, breaking token matching for FQN-style rules |
| `Infix rule completion` (entire block) | Infix grammars fail Lezer grammar generation |

### goto-definition.test.ts

| Describe Block | Skip Reason |
|----------------|-------------|
| `Definition Provider datatype rule` | Datatype rule (FQN) cross-references + alternative rules don't fully work with Lezer |
| `Definition Provider with Infix Operators` | Infix grammars with alternatives fail Lezer grammar generation |

## Known Lezer Limitations

These limitations cause certain test patterns to be skipped or constrained for the Lezer backend:

### ~~1. Alternative Rules (`A: B | C;`)~~ — FIXED
Alternative rules now work correctly. `SyntaxNodeAstBuilder.inlineChildNode()` processes
unassigned child SyntaxNodes directly on the parent AstNode (setting `$type` from the child,
processing the child's assignments, and mapping both SyntaxNodes to the same AstNode).
This mirrors what Chevrotain's `action()` callback does at parse time.

### ~~2. Completion Provider Tokenizer~~ — FIXED
A dedicated `LezerCompletionProvider` implements the `CompletionProvider` interface from scratch
using the existing parse tree (SyntaxNode) instead of Chevrotain's completion parser and lexer.
It collects leaf tokens from the parse tree, converts them to the format expected by
`findNextFeatures`, and builds completion items for keywords and cross-references.

**Remaining issues:**
- ML_COMMENT regex (`/\/\*[\s\S]*?\*\//`) is not correctly translated to Lezer grammar syntax,
  causing block comments to be parsed as error nodes + identifiers.
- Anonymous punctuation tokens (like `"."`) in data type rules are not preserved in the Lezer
  parse tree, breaking token matching for FQN-style rules (`ID ('.' ID)*`).

### 3. Infix Grammar Generation
Grammars with `infix` rules fail Lezer grammar generation entirely (`createServices` returns
`null`).

**Impact:** Infix-related test blocks are skipped for Lezer.

### ~~4. Cross-Reference Position Navigation~~ — FIXED
`findAssignmentSN()` now supports non-Chevrotain backends via GrammarRegistry lookups.
Given a leaf SyntaxNode, it walks up to the owning AstNode, retrieves all assignments
for that rule, and checks which field contains the node using positional containment.
`findDeclarationsSN()` also uses `$refSyntaxNode` for array reference matching.

### 5. Comment Folding
Comment-based folding ranges are not supported with the Lezer backend. The folding range
provider's comment detection relies on Chevrotain token types.

**Impact:** `folding-range-dual.test.ts` skips the comment folding test for Lezer.

## Future Work

- Fix ML_COMMENT regex-to-Lezer translation (non-greedy `[\s\S]*?` quantifier)
- Fix anonymous punctuation token preservation in Lezer parse tree (needed for FQN-style data type rules)
- Add comment folding support for Lezer (detect comment nodes by type name)
