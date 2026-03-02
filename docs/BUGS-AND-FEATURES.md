- [ ] Run the test for lezer and see if the lezer grammar generation throws any error like "Unused rules". If so need to investigate this and fix this issue.
- [ ] When lezer backend is selected LezerCompletionProvider should be used by default.
- [ ] Refactor completion code to delegate parser specific code to their respective adapter classes.

BUGS:
- [ ] IN PROGRESS: This code in `packages/langium-lezer/src/parser/lezer-module.ts` seems like an workaround.
```
    LangiumParser: () => undefined,
    CompletionParser: () => undefined,
    Lexer: () => undefined,
    TokenBuilder: () => undefined,
```
In the comment you added: "Null out Chevrotain-specific services so the document factory uses the ParserAdapter path (not the LangiumParser fast path)" -  we should not be nulling out Chevrotain-specific services like this.

"These may be present when createDefaultModule() is used." - shouldn't these chevrotain specific code be removed for createDefaultModule()?

- [ ] In `packages/langium-core/src/utils/syntax-node-utils.ts` file there are a lot of checks for `isChevrotainSyntaxNode()`. This is not ideal and goes against the idea of a good design. These backend specific checks should move to the code in the respective backend codes.
Find out if there are any other places where we check for chevrotain vs lezer backend. Fix those as well.


## Bugs Fixed
1. Keyword completion after anonymous tokens (lezer-completion.ts)
Problem: In Lezer, non-identifier keywords like (, ), ;, * are anonymous inline tokens that don't appear in the parse tree at all. The grammar walker tried to match them against tree children and got stuck, preventing subsequent elements from being completed.

Example: select * <|> didn't suggest from because the walker couldn't advance past the * and ; grammar elements that have no corresponding tree nodes.

Fix: walkKeyword now skips non-identifier keywords (returns consumed: 0) so the walker advances past them in the grammar definition.

2. Assignment wrapper matching (lezer-completion.ts)
Problem: The Lezer grammar translator creates wrapper nonterminals for each assignment (e.g., star?='*' becomes a tree node named SelectItemStar). The walker didn't recognize these wrapper nodes, so it couldn't advance past consumed assignments.

Example: insert into <|> didn't suggest table names because the walker couldn't match the tree structure.

Fix: walkAssignment now reconstructs the expected wrapper name (RuleName + capitalize(fieldName)) and matches it against the tree.

3. Partial prefix cross-reference completion (lezer-completion.ts)
Problem: getExpectedFeatures used child.end <= offset to collect matched children. When the cursor is at the end of a partial token (e.g., insert into u|), the wrapper node for "u" ends exactly at the cursor, so it was counted as "consumed". The walker then skipped past the cross-reference and suggested the next keyword (values) instead.

Fix: Changed to child.end < offset (strict less-than). Tokens ending at the cursor are now excluded from matched types, so the walker offers cross-reference completion at that position. The fuzzy matcher then filters "u" against "users".

4. Lazy quantifier in regex-to-lezer converter (regex-to-lezer.ts)
Problem: The regex *? (lazy quantifier) was converted incorrectly — the * was treated as a greedy quantifier and the ? was emitted as a literal character "?". This broke the ML_COMMENT token definition: /\/\*[\s\S]*?\*\// became "/" "*" $[...]* "?" "*" "/" instead of something meaningful.

Fix: All lazy quantifier forms (*?, +?, ??) now strip the trailing ? since Lezer doesn't support lazy quantifiers.

5. Block comment token special-casing (lezer-grammar-translator.ts)
Problem: Even with the *? fix, a greedy [\s\S]* would consume past the closing */. The standard block comment regex can't be directly converted to a correct Lezer token.

Fix: tryBlockCommentPattern detects the common block comment regex pattern (/\/\*[\s\S]*?\*\//) and emits the idiomatic Lezer token: "/*" (![*] | "*" ![/])* "*/".

6. GrammarConfig terminal name mapping (lezer-module.ts, lezer-services.ts)
Problem: GrammarConfig.multilineCommentRules stores Langium terminal names (e.g., 'ML_COMMENT'), but the Lezer tree uses different type names (e.g., 'BlockComment'). The CommentProvider compared node.tokenType against commentNames and never found a match.

Fix: The Lezer module now overrides GrammarConfig to map Langium names to Lezer names (ML_COMMENT → BlockComment, SL_COMMENT → LineComment, etc.).

7. SyntaxNode sibling navigation identity mismatch (syntax-node-utils.ts)
Problem: getPreviousSyntaxNode and getNextSyntaxNode used siblings.indexOf(current) which relies on reference equality. Lezer creates new SyntaxNode instances for the same logical node (.parent returns a different object than what .children enumerates), so indexOf returned -1 and sibling navigation silently failed. This broke comment finding for Lezer — findCommentSyntaxNode couldn't find BlockComment nodes preceding AST nodes.

Fix: Both functions now fall back to position-based matching (offset + end + type) when indexOf fails.

Tests
Unskipped (previously skipped for Lezer, now passing)
"Should show documentation on completion items" — required fixes 4, 5, 6, and 7 working together
"Should not remove same named NodeDescriptions" — was incorrectly marked as "Chevrotain-specific" but DefaultCompletionProvider is backend-agnostic; just needed unskipping
New test cases (both Chevrotain and Lezer backends)
Cross-reference after keyword sequence — table users insert into <|> → suggests users
Cross-reference with multiple definitions — table users table orders insert into <|> → suggests both
Cross-reference with partial prefix — table users insert into u<|> → suggests users (fix #3)
Keyword after star operator — select * <|> → suggests from (fix #1)
Keyword after parenthesized group — begin ( foo ) <|> → suggests end (fix #1)
