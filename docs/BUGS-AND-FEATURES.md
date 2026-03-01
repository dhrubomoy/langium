- [ ] Run the test for lezer and see if the lezer grammar generation throws any error like "Unused rules". If so need to investigate this and fix this issue.


### Code completion:
- Right now the `DefaultCompletionProvider` in `packages/langium-lsp/src/lsp/completion/completion-provider.ts` is dependent on chevrotain parser. Need to update the class so that it is parser agnostic.
- Most of the code in DefaultCompletionProvider and follow-up-computation.ts seem too complex. Lets move them to the chevrotain based completion class.
- For lezer let's create the completion code ourselves without relying on langium's existing code. I think it will be easier.
