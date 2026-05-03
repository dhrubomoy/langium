# Tree-sitter migration issues

## v1 — Arithmetic example end-to-end

| # | Title | Blocked by |
|---|---|---|
| [01](issues/01-wasm-loader-service.md) | web-tree-sitter WASM loader service | — |
| [02](issues/02-hand-written-arithmetic-grammar.md) | Hand-written arithmetic grammar.js + metadata.ts | — |
| [05](issues/05-grammar-syntax-extensions.md) | Grammar syntax extensions: @word, @prec, conflicts | — |
| [03](issues/03-document-index-tree-walker.md) | DocumentIndex interface + single-pass tree walker | 01, 02 |
| [04](issues/04-lsp-services-document-index.md) | 7 LSP services wired to DocumentIndex | 03 |
| [06](issues/06-grammar-compiler-emitter.md) | Grammar compiler: grammar.js + metadata.ts emitter | 02, 05 |
| [07](issues/07-arithmetic-end-to-end-generated.md) | Arithmetic example end-to-end with generated artifacts | 04, 06 |

## v2 — Placeholders

| # | Title | Blocked by |
|---|---|---|
| [08](issues/08-v2-incremental-linker.md) | [v2] Index-based incremental linker | 07 |
| [09](issues/09-v2-enriched-error-messages.md) | [v2] Enriched parse error messages | 07 |
| [10](issues/10-v2-code-completion.md) | [v2] Code completion via follow-set table | 07 |
| [11](issues/11-v2-external-scanner.md) | [v2] External scanner support | 07 |
| [12](issues/12-v2-hover-semantic-tokens.md) | [v2] Hover and semantic tokens | 07 |

## Post-v1 cleanup

| # | Title | Blocked by |
|---|---|---|
| [13](issues/13-delete-chevrotain-infrastructure.md) | Delete Chevrotain infrastructure | 07 |
