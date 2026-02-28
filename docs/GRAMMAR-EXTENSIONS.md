# Grammar Extensions Reference

Langium-X extends the Langium grammar language with new constructs that expose features
from the Lezer parser backend while remaining backward-compatible with existing grammars.

All new syntax uses keywords and constructs that don't conflict with existing Langium grammars.

## Feature Support Matrix

| Feature | Chevrotain | Lezer |
|---------|-----------|-------|
| Existing Langium grammars | Full | Full |
| `infix` (Langium 4) | Native | Translated |
| `@precMarker=tag` | Desugared (with warning) | Native |
| `external tokens` | Custom matchers | Native |
| `external context` | Error | Native |
| Terminal regex body (`/pattern/`) | Native | Best-effort conversion |
| Terminal string body (`'native'`) | Error | Verbatim passthrough |
| `conflicts` / GLR | Error | Native |
| `@dynamicPrecedence` | Error | Native |
| `specialize` / `extend` | Partial | Native |
| `local tokens` | Lexer modes | Native |
| Incremental parsing | Not supported | Native |

## 1. Precedence Blocks and `@precMarker`

For cases that `infix` rules can't handle (ternary operators, type assertions, GLR
disambiguation), declare named precedence levels and attach markers to alternatives.

### Syntax

```langium
// Declare named levels in descending priority
precedence {
    typeAssertion
    ternary
    assignment @right
}

// Attach markers to specific alternatives
Expression:
    {TernaryExpr} @precMarker=ternary
        condition=Expression '?' consequent=Expression ':' alternate=Expression
  | {TypeAssertion} @precMarker=typeAssertion
        expr=Expression 'as' type=TypeRef
  | BinaryExpr
;
```

### Behavior

- Levels are ordered top-to-bottom, highest priority first
- Default associativity is left; use `@right` to override
- `@precMarker=tag` attaches a level to a specific alternative in a rule

### Backend Translation

- **Lezer**: Maps to `@precedence { tag1 @left, tag2 @right }` and `!tag` markers
- **Chevrotain**: Desugared to rule ordering with a warning for unsupported cases

## 2. External Tokens

Declare tokens produced by user-provided TypeScript code. Useful for context-sensitive
tokenization (e.g., indentation-based languages).

### Syntax

```langium
// Declare externally-produced tokens
external tokens from "./tokenizer" {
    Indent
    Dedent
    Newline
}

// Use external tokens like any other terminal
Block: Indent statements+=Statement+ Dedent;
```

The `"./tokenizer"` path resolves to a TypeScript module relative to the grammar file.

### Lezer Tokenizer Module

```typescript
import { ExternalTokenizer } from '@lezer/lr';

export const tokenizer = new ExternalTokenizer((input, stack) => {
    // Custom tokenization logic
});
```

### Chevrotain Tokenizer Module

```typescript
import type { ExternalTokenizer } from 'langium-x/chevrotain';

export const tokenizer: ExternalTokenizer = {
    tokens: ['Indent', 'Dedent', 'Newline'],
    match(text: string, offset: number, expectedTokens: string[]): TokenMatch | null {
        // Custom matching logic
    }
};
```

## 3. External Context

Declare a context tracker for stateful tokenization. Lezer-only feature.

### Syntax

```langium
external context IndentationTracker from "./context";
```

### Lezer Context Module

```typescript
import { ContextTracker } from '@lezer/lr';

export const tracker = new ContextTracker({
    start: { indent: 0 },
    shift(context, term, stack, input) {
        // Update context on token shift
        return context;
    }
});
```

### Backend Support

- **Lezer**: Maps to `@context tracker from "./context"`
- **Chevrotain**: Not supported (produces an error diagnostic)

## 4. Token Specialization (`specialize`)

Replace a base token with a specialized token when it matches specific strings.
The specialized token completely replaces the base token.

### Syntax

```langium
terminal ID: /[a-zA-Z_]\w*/;

specialize ID {
    'if' => IfKeyword
    'else' => ElseKeyword
    'while' => WhileKeyword
}
```

### Behavior

When the lexer matches `ID`, it checks the matched text against the specialization
map. If it matches (e.g., `"if"`), the token type becomes `IfKeyword` instead of `ID`.
The base token `ID` is no longer produced for that match.

### Backend Translation

- **Lezer**: Maps to `@specialize[@name={IfKeyword}]<Identifier, "if">`
- **Chevrotain**: Keyword config / `LONGER_ALT`

## 5. Token Extension (`extend`)

Similar to `specialize`, but the base token is also valid. Both interpretations
are allowed, which may trigger GLR parsing.

### Syntax

```langium
extend ID {
    'async' => AsyncKeyword
    'yield' => YieldKeyword
}
```

### Behavior

Unlike `specialize`, `extend` allows both the base token and the extended token
to be valid at the same position. The parser resolves the ambiguity.

### Backend Translation

- **Lezer**: Maps to `@extend[@name={AsyncKeyword}]<Identifier, "async">`
- **Chevrotain**: Limited support (warning diagnostic)

## 6. Conflict Declarations

Declare intentional ambiguities for GLR parsing. Lezer-only feature.

### Syntax

```langium
conflicts {
    [Expression, TypeExpression]
    [ParameterList, ParenthesizedExpr]
}
```

### Behavior

Each entry declares a set of rules that may overlap ambiguously. The parser
explores both alternatives and uses dynamic precedence to disambiguate.

### Backend Support

- **Lezer**: Maps to `~ambiguity` markers on conflicting rules
- **Chevrotain**: Not supported (produces an error: "conflicts require Lezer backend")

## 7. Dynamic Precedence

Assign a runtime disambiguation weight to an alternative. Used with `conflicts`
for GLR ambiguity resolution.

### Syntax

```langium
Expression:
    {ArrowFunction} @dynamicPrecedence(1)
        params=ParameterList '=>' body=Expression
  | /* ... */
;
```

### Behavior

Higher dynamic precedence values are preferred when the parser encounters an
ambiguity during GLR parsing. Default is 0.

### Backend Support

- **Lezer**: Maps to `@dynamicPrecedence(1)` in generated grammar
- **Chevrotain**: Not supported (produces an error diagnostic)

## 8. Local Token Groups

Declare tokens that are only active when parsing a specific rule. Prevents
interference with main grammar tokens.

### Syntax

```langium
StringLiteral: '"' content=StringContent* '"';

local tokens in StringContent {
    terminal EscapeSequence: /\\[nrt"\\]/;
    terminal Interpolation: '${';
    terminal StringText: /[^"\\$]+/;
}
```

### Behavior

Tokens in a `local tokens` block are only active while parsing the named rule.
The main grammar's tokens are suspended within that scope.

### Backend Translation

- **Lezer**: Maps to `@local tokens { ... }` scoped block
- **Chevrotain**: Lexer modes

## Terminal Rule Body Formats

Terminal rules support two body formats for cross-backend portability:

### Regex Body (Portable)

```langium
terminal ID: /[a-zA-Z_]\w*/;
terminal INT: /[0-9]+/;
```

- **Chevrotain**: Used natively (JavaScript regex)
- **Lezer**: Best-effort conversion for simple patterns:
  - `\s` → `@whitespace`
  - `\d` → `@digit`
  - `\w` → `$[a-zA-Z0-9_]`
  - `.` → `_`
  - Complex features (backreferences, lookahead) produce an error diagnostic

### String Body (Backend-Native)

```langium
terminal ID: '$[a-zA-Z_] $[a-zA-Z0-9_]*';
terminal INT: '@digit+';
```

- **Lezer**: Passed verbatim into the `@tokens` block
- **Chevrotain**: Not supported (produces an error: "use regex `/pattern/` instead")

### Guidance

Use regex bodies for portability across backends. Use string bodies when you need
precise control over Lezer's token syntax or when regex can't express what you need.
