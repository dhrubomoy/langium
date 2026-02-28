- [ ] Run the test for lezer and see if the lezer grammar generation throws any error like "Unused rules". If so need to investigate this and fix this issue.


### Code completion:
- [ ] Right now the `DefaultCompletionProvider` in `packages/langium-lsp/src/lsp/completion/completion-provider.ts` is dependent on chevrotain parser. Need to update the class so that it is parser agnostic. Let's discuss the new architecture to handle this.

