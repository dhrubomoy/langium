# Migrating to Langium-X

This guide helps existing Langium users adopt Langium-X's parser-agnostic architecture,
switch to the Lezer backend for incremental parsing, and use the new grammar extensions.

## Quick Start

Langium-X is fully backward-compatible. The simplest migration is to keep using the `langium`
meta-package — it re-exports `langium-core`, `langium-chevrotain`, and `langium-lsp`:

```bash
# No change needed — this still works
npm install langium
```

To use the Lezer backend, install the individual packages:

```bash
npm install langium-core langium-lezer langium-lsp
```

## What Changed

### `$syntaxNode` replaces `$cstNode`

AST nodes now carry a `$syntaxNode` property instead of `$cstNode`. The old name is preserved
as a deprecated alias — existing code continues to work without changes.

```typescript
// Old (still works via alias)
const cst = astNode.$cstNode;

// New
const syntax = astNode.$syntaxNode;
```

### SyntaxNode replaces CstNode

The `SyntaxNode` interface replaces Langium's `CstNode`, `CompositeCstNode`, and `LeafCstNode`.
Key differences:

| CstNode | SyntaxNode |
|---------|-----------|
| `astNode` back-pointer | No AST back-pointer (avoids circular refs) |
| `grammarSource` back-pointer | Use `GrammarRegistry.getRuleByName(node.type)` |
| `container` (parent) | `parent` |
| `content` (children) | `children` |
| `hidden` | `isHidden` |
| `tokenType: TokenType` | `tokenType: string \| undefined` |
| — | `isKeyword`, `isError`, `isLeaf` |
| — | `childForField(name)`, `childrenForField(name)` |

### GrammarRegistry replaces grammarSource

Instead of `cstNode.grammarSource` (a live Grammar AST reference on every node),
use the `GrammarRegistry` service for O(1) lookups by type name:

```typescript
// Old
const rule = cstNode.grammarSource;

// New
const registry = services.grammar.GrammarRegistry;
const rule = registry.getRuleByName(syntaxNode.type);
const isKw = registry.isKeyword(syntaxNode.type);
const assignments = registry.getAssignments(parentNode.type);
```

### ParserAdapter replaces direct Chevrotain calls

If your code directly referenced `LangiumParser` or Chevrotain APIs, migrate to
the `ParserAdapter` interface:

```typescript
// Old
const parser = services.parser.LangiumParser;
const result = parser.parse(text);

// New
const adapter = services.parser.ParserAdapter;
const result = adapter.parse(text);
// result.root is a RootSyntaxNode
// result.incrementalState is opaque state for incremental re-parsing
```

## Choosing a Backend

| | Chevrotain (default) | Lezer |
|--|---------------------|-------|
| **Parsing strategy** | LL (interpreted, in-memory) | LR (pre-compiled parse tables) |
| **Incremental parsing** | No | Yes (keystroke-level re-parse) |
| **Error recovery** | Built-in | Built-in |
| **Grammar compilation** | Runtime interpretation | Build-time (`langium generate`) |
| **Tree representation** | Wrapped CstNode | Zero-copy cursor-based |
| **New grammar features** | Partial support | Full support |
| **Backward compatibility** | Full (identical to upstream Langium) | Full (same AST output) |
| **Best for** | Quick prototyping, backward compat | Production LSPs, large files |

**Recommendation**: Use Chevrotain for existing projects that don't need incremental parsing.
Use Lezer for new projects or when editing responsiveness matters (large files, complex grammars).

## Configuration

### langium-config.json

Add the `parserBackend` field to switch backends:

```jsonc
{
  "projectName": "MyLanguage",
  "parserBackend": "lezer",          // "chevrotain" (default) | "lezer"
  "languages": [{
    "id": "my-language",
    "grammar": "src/language/my-language.langium",
    "fileExtensions": [".ml"]
  }],
  "out": "src/language/generated"
}
```

### CLI

```bash
# Generate with configured backend
langium generate

# Override backend from CLI
langium generate --backend=lezer
```

For the Lezer backend, `langium generate` produces:
1. `ast.ts` — Generated AST types (same as Chevrotain)
2. `module.ts` — DI module
3. `grammar.ts` — Grammar introspection data
4. `parser.ts` — Compiled Lezer parse tables + field map

### DI Module Setup (Lezer)

```typescript
import { createDefaultCoreModule } from 'langium-core';
import { createLezerParserModule } from 'langium-lezer';
import { createLspModule } from 'langium-lsp';

const shared = createDefaultSharedModule();
const services = inject(
    createDefaultCoreModule({ shared }),
    createLezerParserModule(),
    createLspModule(),
    MyLanguageModule
);
```

## Code Migration Checklist

1. **Types**: Replace `CstNode` imports with `SyntaxNode` from `langium-core`
2. **Properties**: `$cstNode` → `$syntaxNode` (alias still works)
3. **Tree navigation**: `node.content` → `node.children`; `node.container` → `node.parent`
4. **Grammar introspection**: `node.grammarSource` → `GrammarRegistry.getRuleByName(node.type)`
5. **Field access**: Use `node.childForField('name')` and `node.childrenForField('items')`
6. **Utilities**: CstUtils functions have SyntaxNode equivalents in `syntax-node-utils.ts`
7. **Config**: Add `"parserBackend": "lezer"` to `langium-config.json` if switching
8. **Dependencies**: Switch from `langium` to `langium-core` + `langium-lezer` + `langium-lsp`

## New Grammar Features (Lezer-native)

These features are fully supported by the Lezer backend, with partial or no support in Chevrotain:

| Feature | Syntax | Chevrotain | Lezer |
|---------|--------|-----------|-------|
| Precedence markers | `@precMarker=tag` | Desugared | Native |
| External tokens | `external tokens from "./tok" { ... }` | Custom matchers | Native |
| External context | `external context Tracker from "./ctx"` | Error | Native |
| Token specialization | `specialize ID { 'if' => IfKw }` | Partial | Native |
| Token extension | `extend ID { 'async' => AsyncKw }` | Warning | Native |
| Conflict declarations | `conflicts { [Expr, TypeExpr] }` | Error | Native |
| Dynamic precedence | `@dynamicPrecedence(1)` | Error | Native |
| Local token groups | `local tokens in Rule { ... }` | Lexer modes | Native |

See [GRAMMAR-EXTENSIONS.md](GRAMMAR-EXTENSIONS.md) for detailed syntax and examples.

## Backward Compatibility

- `import { ... } from 'langium'` still works (meta-package re-exports everything)
- `$cstNode` is preserved as a deprecated alias for `$syntaxNode`
- Chevrotain backend produces identical behavior to upstream Langium 4.x
- All existing Langium grammars work with both backends without modification
- The full existing test suite (1264 tests) passes with the Chevrotain backend
