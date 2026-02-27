# Phase 3: Grammar Extensions

**Goal**: New grammar syntax for precedence markers, external tokenizers, token specialization,
conflict declarations, and local token groups — implemented per backend per the feature support matrix.

**Source of truth**: [DESIGN.md](../../DESIGN.md) §6.2–6.7, §6.8 (support matrix), §9.Phase 3

**Prerequisites**: Phase 2 complete — Lezer adapter, translator, SyntaxNode wrapper all working
with cross-backend conformance tests passing.

---

## 1. Overview of New Grammar Constructs

| # | Feature | Langium Syntax | Lezer Output | Chevrotain Output |
|---|---------|----------------|--------------|-------------------|
| 1 | Precedence blocks + `@precMarker` | `precedence { tag1; tag2 @right }` + `@precMarker=tag1` on alternatives | `@precedence { tag1 @left, tag2 @right }` + `!tag1` markers | Desugared to rule ordering (with warning for unsupported cases) |
| 2 | External tokens | `external tokens from "./tok" { Indent Dedent }` | `@external tokens tok from "./tok" { Indent, Dedent }` | Custom matcher interface |
| 3 | External context | `external context Tracker from "./ctx"` | `@context tracker from "./ctx"` | Not supported (error) |
| 4 | Token specialization (`specialize`) | `specialize ID { 'if' => IfKw }` | `@specialize[@name={IfKw}]<Identifier, "if">` | Keyword config / `LONGER_ALT` |
| 5 | Token extension (`extend`) | `extend ID { 'async' => AsyncKw }` | `@extend[@name={AsyncKw}]<Identifier, "async">` | Limited (warning) |
| 6 | Conflict declarations | `conflicts { [Expr, TypeExpr] }` | `~ambig` markers on conflicting rules | Not supported (error) |
| 7 | Dynamic precedence | `@dynamicPrecedence(1)` on alternatives | `@dynamicPrecedence(1)` in Lezer | Not supported (error) |
| 8 | Local token groups | `local tokens in Rule { terminal ... }` | `@local tokens { ... }` scoped block | Lexer modes |

**Feature support matrix** (DESIGN.md §6.8):

| Feature | Chevrotain | Lezer |
|---------|-----------|-------|
| `@precMarker=tag` | ⚠️ Desugared | ✅ Native |
| `external tokens` | ⚠️ Custom matchers | ✅ Native |
| `external context` | ❌ Error | ✅ Native |
| `specialize` / `extend` | ⚠️ Partial | ✅ Native |
| `conflicts` / GLR | ❌ Error | ✅ Native |
| `@dynamicPrecedence` | ❌ Error | ✅ Native |
| `local tokens` | ⚠️ Lexer modes | ✅ Native |

---

## 2. Grammar Parser Changes

### 2.1 Files to Modify

| File | Change |
|------|--------|
| `packages/langium/src/grammar/langium-grammar.langium` | Add new rule types |
| `packages/langium/src/grammar/langium-types.langium` | Add new AST interfaces |
| `packages/langium-core/src/languages/generated/ast.ts` | Regenerate (auto) |
| `packages/langium-core/src/grammar/generated/grammar.ts` | Regenerate (auto) |

### 2.2 New Grammar Rules (langium-grammar.langium)

**Extend `Grammar` entry rule** to accept new top-level constructs:

```langium
// Current:
entry Grammar returns Grammar:
    (isDeclared?='grammar' name=ID)?
    imports+=GrammarImport*
    (rules+=AbstractRule | interfaces+=Interface | types+=Type)*;

// New:
entry Grammar returns Grammar:
    (isDeclared?='grammar' name=ID)?
    imports+=GrammarImport*
    (
        rules+=AbstractRule
      | interfaces+=Interface
      | types+=Type
      | precedenceBlocks+=PrecedenceBlock
      | externalTokenBlocks+=ExternalTokenBlock
      | externalContexts+=ExternalContext
      | specializeBlocks+=SpecializeBlock
      | extendBlocks+=ExtendBlock
      | conflictBlocks+=ConflictBlock
      | localTokenBlocks+=LocalTokenBlock
    )*;
```

**New rules:**

```langium
// --- Precedence blocks ---
PrecedenceBlock returns PrecedenceBlock:
    'precedence' '{' levels+=PrecedenceLevel+ '}';

PrecedenceLevel returns PrecedenceLevel:
    name=ID (associativity=Associativity 'assoc')? ';'?;

// --- @precMarker annotation on alternatives ---
// Add to AbstractElement: precMarker property
// Modify Group rule to optionally parse @precMarker=tag
// (See §2.3 for approach)

// --- External tokens ---
ExternalTokenBlock returns ExternalTokenBlock:
    'external' 'tokens' 'from' path=STRING '{'
        tokens+=ExternalTokenDecl (',' tokens+=ExternalTokenDecl)* ','?
    '}' ';'?;

ExternalTokenDecl returns ExternalTokenDecl:
    name=ID;

// --- External context ---
ExternalContext returns ExternalContext:
    'external' 'context' name=ID 'from' path=STRING ';'?;

// --- Token specialization ---
SpecializeBlock returns SpecializeBlock:
    'specialize' terminal=[TerminalRule:ID] '{'
        mappings+=TokenMapping+
    '}' ';'?;

// --- Token extension ---
ExtendBlock returns ExtendBlock:
    'extend' terminal=[TerminalRule:ID] '{'
        mappings+=TokenMapping+
    '}' ';'?;

TokenMapping returns TokenMapping:
    source=STRING '=>' target=ID ';'?;

// --- Conflict declarations ---
ConflictBlock returns ConflictBlock:
    'conflicts' '{'
        sets+=ConflictSet+
    '}' ';'?;

ConflictSet returns ConflictSet:
    '[' rules+=[AbstractRule:ID] (',' rules+=[AbstractRule:ID])+ ']' ';'?;

// --- Local token groups ---
LocalTokenBlock returns LocalTokenBlock:
    'local' 'tokens' 'in' rule=[ParserRule:ID] '{'
        terminals+=TerminalRule+
    '}' ';'?;
```

### 2.3 @precMarker and @dynamicPrecedence Annotations

These are annotations on alternatives (elements within parser rules). Two approaches:

**Approach A — Dedicated properties on AbstractElement:**

Add to `langium-types.langium`:
```langium
interface AbstractElement {
    cardinality?: "*" | "+" | "?";
    precMarker?: string;           // NEW
    dynamicPrecedence?: number;    // NEW
}
```

Modify the grammar rule to parse them:
```langium
// In AbstractTokenWithCardinality, parse annotations before the element:
AbstractTokenWithCardinality returns AbstractElement:
    ('@precMarker' '=' precMarker=ID |
     '@dynamicPrecedence' '(' dynamicPrecedence=NUMBER ')')*
    (Assignment | AbstractTerminal) cardinality=('?'|'*'|'+')?;
```

**Approach B — Annotation list (more extensible):**

```langium
AbstractTokenWithCardinality returns AbstractElement:
    annotations+=Annotation*
    (Assignment | AbstractTerminal) cardinality=('?'|'*'|'+')?;

Annotation returns Annotation:
    {PrecMarkerAnnotation} '@precMarker' '=' tag=ID
  | {DynamicPrecedenceAnnotation} '@dynamicPrecedence' '(' value=NUMBER ')';
```

**Recommendation**: Approach A (simpler, sufficient for known annotations).

### 2.4 New AST Types (langium-types.langium)

```langium
// Add to Grammar interface:
interface Grammar {
    // ... existing ...
    precedenceBlocks: PrecedenceBlock[];
    externalTokenBlocks: ExternalTokenBlock[];
    externalContexts: ExternalContext[];
    specializeBlocks: SpecializeBlock[];
    extendBlocks: ExtendBlock[];
    conflictBlocks: ConflictBlock[];
    localTokenBlocks: LocalTokenBlock[];
}

interface PrecedenceBlock {
    levels: PrecedenceLevel[];
}

interface PrecedenceLevel {
    name: string;
    associativity?: Associativity;
}

interface ExternalTokenBlock {
    path: string;
    tokens: ExternalTokenDecl[];
}

interface ExternalTokenDecl {
    name: string;
}

interface ExternalContext {
    name: string;
    path: string;
}

interface SpecializeBlock {
    terminal: @TerminalRule;
    mappings: TokenMapping[];
}

interface ExtendBlock {
    terminal: @TerminalRule;
    mappings: TokenMapping[];
}

interface TokenMapping {
    source: string;
    target: string;
}

interface ConflictBlock {
    sets: ConflictSet[];
}

interface ConflictSet {
    rules: @AbstractRule[];
}

interface LocalTokenBlock {
    rule: @ParserRule;
    terminals: TerminalRule[];
}

// Extend AbstractElement:
interface AbstractElement {
    cardinality?: "*" | "+" | "?";
    precMarker?: string;
    dynamicPrecedence?: number;
}
```

### 2.5 FeatureName Update

Add new keywords to `FeatureName` fragment so they can also be used as property names:

```langium
FeatureName returns string:
    'infix' | 'on' | 'right' | 'left' | 'assoc' | 'current' | 'entry' |
    'extends' | 'false' | 'fragment' | 'grammar' | 'hidden' | 'import' |
    'interface' | 'returns' | 'terminal' | 'true' | 'type' | 'infer' |
    'infers' | 'with' |
    // Phase 3 additions:
    'precedence' | 'external' | 'tokens' | 'context' | 'specialize' |
    'extend' | 'conflicts' | 'local' |
    PrimitiveType | ID;
```

---

## 3. LezerGrammarTranslator Extensions

### 3.1 Precedence Blocks + @precMarker

**Input:**
```langium
precedence { typeAssertion; ternary; assignment @right }
Expression:
    {TernaryExpr} @precMarker=ternary
        condition=Expression '?' consequent=Expression ':' alternate=Expression
  | {TypeAssertion} @precMarker=typeAssertion
        expr=Expression 'as' type=TypeRef
  | BinaryExpr
;
```

**Lezer output:**
```
@precedence { typeAssertion @left, ternary @left, assignment @right }

Expression { TernaryExpr | TypeAssertion | BinaryExpr }
TernaryExpr { expr !ternary "?" expr ":" expr }
TypeAssertion { expr !typeAssertion "as" TypeRef }
```

**Implementation in translator:**
1. Collect all `PrecedenceBlock`s from `grammar.precedenceBlocks`
2. Merge with infix-generated precedence levels (infix levels come from `InfixRule.operators`)
3. Emit unified `@precedence { ... }` declaration
4. When translating elements with `precMarker` set, wrap in `!tag` syntax

### 3.2 External Tokens

**Input:**
```langium
external tokens from "./tokenizer" { Indent, Dedent, Newline }
```

**Lezer output:**
```
@external tokens tokenizer from "./tokenizer" { Indent, Dedent, Newline }
```

**Implementation:**
1. For each `ExternalTokenBlock`, emit `@external tokens` declaration
2. Generate a unique tokenizer name from the path (e.g., filename without extension)
3. Validate the module path exists at build time
4. External token names become valid terminal names in rule bodies

### 3.3 External Context

**Input:**
```langium
external context IndentTracker from "./context"
```

**Lezer output:**
```
@context tracker from "./context"
```

**Implementation:**
1. Emit `@context` declaration (only one allowed per grammar)
2. Validate module path

### 3.4 Specialize / Extend

**Input:**
```langium
specialize ID {
    'if' => IfKeyword
    'else' => ElseKeyword
}
extend ID {
    'async' => AsyncKeyword
}
```

**Lezer output (in @tokens block or after):**
```
@specialize[@name={IfKeyword}]<Identifier, "if">
@specialize[@name={ElseKeyword}]<Identifier, "else">
@extend[@name={AsyncKeyword}]<Identifier, "async">
```

**Implementation:**
1. Resolve the terminal reference (e.g., `ID` → Lezer name `Identifier`)
2. For each mapping, emit `@specialize` or `@extend` annotation
3. The target names become available as node types in the Lezer tree
4. Add target names to the keyword set if they're keyword-like

### 3.5 Conflict Declarations

**Input:**
```langium
conflicts {
    [Expression, TypeExpression]
    [ParameterList, ParenthesizedExpr]
}
```

**Lezer output:**
Ambiguity markers `~ambig` on the conflicting rules' shared prefix:
```
Expression { PrimaryExpr ~exprOrType "+" Expression | ... }
TypeExpression { PrimaryExpr ~exprOrType "[" "]" | ... }
```

**Implementation:**
1. Identify shared prefixes between conflicting rules
2. Insert `~markerName` at the ambiguity point
3. Generate unique marker names from the conflict set
4. This is the **most complex** feature — may need manual annotation support

### 3.6 Dynamic Precedence

**Input:**
```langium
Expression:
    {ArrowFunction} @dynamicPrecedence(1)
        params=ParameterList '=>' body=Expression
  | ...
;
```

**Lezer output:**
```
Expression {
    ArrowFunction |
    ...
}
ArrowFunction { !dynamicPrec1 ParameterList "=>" Expression }
```

Actually, Lezer uses `@dynamicPrecedence` on rule definitions:
```
ArrowFunction[@dynamicPrecedence=1] { ParameterList "=>" Expression }
```

### 3.7 Local Token Groups

**Input:**
```langium
local tokens in StringContent {
    terminal EscapeSequence: /\\[nrt"\\]/;
    terminal StringText: /[^"\\$]+/;
}
```

**Lezer output:**
```
@local tokens {
    EscapeSequence { "\\" $[nrt"\\] }
    StringText { !["\\\$]+ }
    @else String
}
```

**Implementation:**
1. Create a `@local tokens` block scoped to the parent rule
2. Translate each terminal using existing `translateTerminalBody()`
3. Add `@else` fallback token for unmatched content

---

## 4. Chevrotain Backend Support

For each feature, the Chevrotain translator/validator needs one of:

| Feature | Chevrotain Action |
|---------|-------------------|
| `precedence` + `@precMarker` | Desugar to rule ordering; warn if complex |
| `external tokens` | Custom tokenizer interface; validate module |
| `external context` | **Error**: not supported |
| `specialize` | Map to keyword config / `LONGER_ALT` |
| `extend` | Partial support; warn about limitations |
| `conflicts` | **Error**: requires GLR (Lezer only) |
| `@dynamicPrecedence` | **Error**: not supported |
| `local tokens` | Map to Chevrotain lexer modes |

### 4.1 Validation Diagnostics

| Condition | Severity | Message |
|-----------|----------|---------|
| `external context` + Chevrotain | error | "External context trackers require the Lezer backend." |
| `conflicts` + Chevrotain | error | "Conflict declarations require the Lezer backend (GLR parsing)." |
| `@dynamicPrecedence` + Chevrotain | error | "Dynamic precedence requires the Lezer backend." |
| `@precMarker` + Chevrotain | warning | "Precedence markers are desugared for Chevrotain; complex cases may not work correctly." |
| `extend` + Chevrotain | warning | "Token extension has limited support with Chevrotain." |
| Undefined `@precMarker` tag | error | "Precedence tag 'X' is not defined in any precedence block." |
| Duplicate precedence level name | error | "Duplicate precedence level 'X'." |
| Duplicate specialize/extend mapping | warning | "Token 'X' is already specialized/extended." |
| `external tokens` path not found | error | "External tokenizer module 'path' not found." |
| >1 `external context` | error | "Only one external context tracker is allowed per grammar." |

---

## 5. GrammarRegistry Extensions

The `GrammarRegistry` (in `langium-core`) needs new methods to support Phase 3 lookups:

```typescript
interface GrammarRegistry {
    // ... existing methods ...

    /** Get all precedence levels (merged from precedence blocks + infix rules). */
    getPrecedenceLevels(): PrecedenceLevel[];

    /** Get the precedence tag for an element, if any. */
    getPrecMarker(element: AbstractElement): string | undefined;

    /** Get external token declarations. */
    getExternalTokens(): ExternalTokenDecl[];

    /** Check if a token name is from a specialize/extend block. */
    isSpecializedToken(name: string): boolean;
}
```

---

## 6. Implementation Order

Phase 3 features have dependencies. Implement in this order:

### Step 1: Grammar Parser + AST Types (Foundation) ✅

1. ~~Modify `langium-types.langium` — add all new interfaces~~
2. ~~Modify `langium-grammar.langium` — add all new rules~~
3. ~~Regenerate Grammar AST: `npm run langium:generate`~~
4. ~~Verify `npm run build` passes (existing tests still pass)~~
5. ~~Validation test: `packages/langium/test/grammar/grammar-extensions.test.ts` (13 tests)~~

**Note**: `@precMarker` and `@dynamicPrecedence` annotations are placed *after* the element
(like `cardinality`), not before. Syntax: `name=ID @precMarker=Add @dynamicPrecedence(3)`.
This is required because the `Assignment` sub-rule creates a new AST node via `{Assignment}`
action, so properties set before it would be lost on the old node.

### Step 2: Precedence Blocks + @precMarker ✅

1. ~~`collectPrecedenceLevels()` merges PrecedenceBlock + InfixRule levels into single @precedence~~
2. ~~`!tag` emission in `translateElement()` for @precMarker~~
3. ~~Validation: undefined tags, duplicate level names~~
4. ~~Chevrotain: warning diagnostic for @precMarker desugaring~~
5. ~~Tests: 7 tests in `precedence.test.ts`~~

### Step 3: External Tokens + External Context ✅

1. ~~`translateExternalTokenBlock()` → `@external tokens name from "path" { ... }`~~
2. ~~`translateExternalContext()` → `@context name from "path"`~~
3. ~~Exclude external token names from @tokens block~~
4. ~~Validation: at most one external context~~
5. ~~Tests: 5 tests in `external-tokens.test.ts`~~

### Step 4: Specialize / Extend ✅

1. ~~`translateSpecializeBlock()` → individual `@specialize` rules~~
2. ~~`translateExtendBlock()` → individual `@extend` rules~~
3. ~~Add specialize/extend source strings to keywords set~~
4. ~~Validation: duplicate source strings~~
5. ~~Tests: 5 tests in `specialize-extend.test.ts`~~

### Step 5: Conflict Declarations + Dynamic Precedence ✅

1. ~~`buildConflictMarkerMap()` → `~conflict_RuleA_RuleB` markers injected into rule bodies~~
2. ~~`findDynamicPrecedence()` → `[@dynamicPrecedence=N]` annotation on rule definition~~
3. ~~Chevrotain: error diagnostics for conflicts + @dynamicPrecedence~~
4. ~~Tests: 4 tests in `conflicts.test.ts`~~

### Step 6: Local Token Groups ✅

1. ~~`translateLocalTokenBlock()` → `@local tokens { ... @else RuleContent }`~~
2. ~~Exclude local token names from @tokens block~~
3. ~~Chevrotain: warning diagnostic for lexer mode mapping~~
4. ~~Tests: 3 tests in `local-tokens.test.ts`~~

### Step 7: Integration Testing ✅

1. Example grammars using all Phase 3 features
2. Cross-backend conformance where applicable
3. Verify diagnostics for unsupported feature+backend combos
4. Full test suite regression check

---

## 7. Files to Create

| File | Purpose |
|------|---------|
| `packages/langium-lezer/test/grammar-extensions/precedence.test.ts` | Precedence block + @precMarker tests |
| `packages/langium-lezer/test/grammar-extensions/external-tokens.test.ts` | External tokenizer tests |
| `packages/langium-lezer/test/grammar-extensions/specialize-extend.test.ts` | Token specialization tests |
| `packages/langium-lezer/test/grammar-extensions/conflicts.test.ts` | Conflict declaration tests |
| `packages/langium-lezer/test/grammar-extensions/local-tokens.test.ts` | Local token group tests |

## 8. Files to Modify

| File | Change |
|------|--------|
| `packages/langium/src/grammar/langium-grammar.langium` | Add new rule types per §2.2–2.3 |
| `packages/langium/src/grammar/langium-types.langium` | Add new AST interfaces per §2.4 |
| `packages/langium-core/src/languages/generated/ast.ts` | Regenerate |
| `packages/langium-core/src/grammar/generated/grammar.ts` | Regenerate |
| `packages/langium-core/src/grammar/grammar-registry.ts` | Add Phase 3 lookup methods |
| `packages/langium-lezer/src/parser/lezer-grammar-translator.ts` | Add translate methods per §3 |
| `packages/langium-chevrotain/src/parser/chevrotain-adapter.ts` | Add validation diagnostics per §4 |
| `CLAUDE.md` | Update progress checklist |

---

## 9. Key Risks

| Risk | Mitigation |
|------|------------|
| Grammar parser bootstrap: changing the grammar that parses itself | Careful incremental changes; build after each rule addition |
| Conflict declarations are complex (shared prefix detection) | Start with explicit `~marker` syntax; auto-detection as stretch goal |
| Local tokens interact with the global token set | Thorough validation; warn on name collisions |
| Regenerating Grammar AST may break existing code | Keep all new properties optional; run full test suite after regen |
| External token modules must exist at build time | Clear error messages; skip validation in test mode |
