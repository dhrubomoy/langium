# Requirements
- Want to get rid of chevrotain and use treesitter as the parser for langium.
- Main reason is to use treesitter is to use incremental parsing, for performance reason.
- For cross references we also need to investigate how can we use incremental parsing.
- Need to accommodate tree-sitter's features in the langium grammar. How to support these features needs to be discussed carefully during the development phases.
- We need to look options to get rid of the how langium constructs CST altogether. Even typefox is moving away from langium due to performance issues. They are creating a new service in go: https://www.typefox.io/blog/xtext-langium-what-next/
> While collaborating on the PL/I Language Support of the Zowe project, we’ve already seen what this can unlock: we replaced the CST completely with metadata on the input tokens. This has completely eliminated the overhead of constructing the CST, while still retaining the essential information we need from it. The performance gains in this setup were substantial, and they point clearly toward a different architectural direction.


### Reason for choosing treesitter:
- performance and memory issues with chevrotain.
- Incremental parsing in tree-sitter.

Goals:
- In v1 we should be able to make the simple arithmatic example language work end to end using incremental parsing.
