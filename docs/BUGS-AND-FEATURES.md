- [ ] Run the test for lezer and see if the lezer grammar generation throws any error like "Unused rules". If so need to investigate this and fix this issue.
- [ ] When lezer backend is selected LezerCompletionProvider should be used by default.
- [ ] Refactor completion code to delegate parser specific code to their respective adapter classes.

BUGS:
- This code in `packages/langium-lezer/src/parser/lezer-module.ts` seems like an workaround.
```
    LangiumParser: () => undefined,
    CompletionParser: () => undefined,
    Lexer: () => undefined,
    TokenBuilder: () => undefined,
```
In the comment you added: "Null out Chevrotain-specific services so the document factory uses the ParserAdapter path (not the LangiumParser fast path)" -  we should not be nulling out Chevrotain-specific services like this.

"These may be present when createDefaultModule() is used." - shouldn't these chevrotain specific code be removed for createDefaultModule()?
