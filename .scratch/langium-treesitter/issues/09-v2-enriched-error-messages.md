---
Status: needs-triage
---

# [v2] Enriched parse error messages

## What to build

Replace the generic "Syntax error" diagnostic emitted for ERROR/MISSING nodes with context-sensitive messages derived from the metadata table.

Implement a `TreeSitterDiagnosticEnricher` service (optional override per language) that, given an ERROR node position, infers the expected tokens from the metadata's follow-set information and emits "Expected expression" / "Expected ';'" etc.

This is a placeholder — exact approach depends on how metadata is structured after v1.

## Acceptance criteria

- [ ] ERROR nodes at known positions produce a message naming the expected token or construct
- [ ] MISSING nodes produce a message naming the missing token
- [ ] `TreeSitterDiagnosticEnricher` is overridable per language so languages can customize messages
- [ ] Arithmetic example uses enriched messages

## Blocked by

- [07 Arithmetic example end-to-end with generated artifacts](.scratch/langium-treesitter/issues/07-arithmetic-end-to-end-generated.md)
