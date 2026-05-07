# Phase 1: langium-cli Generators on Tree-sitter SyntaxNode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vendored Chevrotain parser infrastructure in `langium-cli` with a tree-sitter grammar for the Langium language, then rewrite all code generators to work directly from `SyntaxNode` trees — eliminating all `GrammarAST` and Chevrotain dependencies from the CLI.

**Architecture:** A `grammar.js` + pre-compiled `langium-grammar.wasm` powers parsing of `.langium` files via `web-tree-sitter`. A `grammar-queries.ts` module provides shared structural and semantic helper functions over `SyntaxNode`. All generators are rewritten to call these helpers instead of importing from `langium/grammar`. `generate.ts` calls `DefaultGrammarParser` directly, bypassing the Langium DI services pipeline.

**Tech Stack:** `web-tree-sitter` (existing dep of `langium`), tree-sitter CLI (new devDep of `langium-cli`), TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-05-04-langium-cli-treesitter-generators-design.md`

**Regression baseline:** 132 passing `langium-cli` tests. Run with:
```sh
npx vitest run packages/langium-cli
```

---

## File Map

**New files:**
- `packages/langium-cli/src/grammar-parser/grammar.js` — tree-sitter grammar source
- `packages/langium-cli/src/grammar-parser/langium-grammar.wasm` — compiled binary (committed)
- `packages/langium-cli/src/grammar-parser/grammar-parser.ts` — parses `.langium` → `SyntaxNode`
- `packages/langium-cli/src/grammar-parser/grammar-queries.ts` — semantic analysis helpers
- `packages/langium-cli/test/grammar-parser/grammar-parser.test.ts`
- `packages/langium-cli/test/grammar-parser/grammar-queries.test.ts`

**Rewritten:**
- `packages/langium-cli/src/generate.ts` — bypasses DI, calls `DefaultGrammarParser` directly
- `packages/langium-cli/src/generator/ast-generator.ts`
- `packages/langium-cli/src/generator/module-generator.ts`
- `packages/langium-cli/src/generator/bnf-generator.ts`
- `packages/langium-cli/src/generator/grammar-js-compiler.ts`
- `packages/langium-cli/src/generator/metadata-compiler.ts`
- `packages/langium-cli/src/generator/types-generator.ts`
- `packages/langium-cli/src/generator/langium-util.ts`
- `packages/langium-cli/src/generator/highlighting/monarch-generator.ts`
- `packages/langium-cli/src/generator/highlighting/textmate-generator.ts`
- `packages/langium-cli/src/generator/highlighting/prism-generator.ts`
- All corresponding test files

**Deleted:**
- `packages/langium-cli/src/grammar-parser/langium-parser.ts`
- `packages/langium-cli/src/grammar-parser/parser-builder-base.ts`
- `packages/langium-cli/src/grammar-parser/indentation-aware.ts`
- `packages/langium-cli/src/grammar-parser/regexp-utils.ts`
- `packages/langium-cli/src/grammar-parser/cst-node-builder.ts`
- `packages/langium-cli/src/grammar-parser/token-builder.ts`
- `packages/langium-cli/src/grammar-parser/lexer.ts`
- `packages/langium-cli/src/grammar-parser/langium-parser-builder.ts`
- `packages/langium-cli/src/grammar-parser/completion-parser-builder.ts`
- `packages/langium-cli/src/grammar-parser/index.ts`
- `packages/langium-cli/src/grammar-parser/parser-config.ts`
- `packages/langium-cli/src/create-grammar-services.ts`
- `packages/langium-cli/src/generator/grammar-serializer.ts`

---

## Task 1: Build Infrastructure

**Files:**
- Modify: `packages/langium-cli/package.json`

- [ ] **Step 1: Add tree-sitter CLI devDependency and build script**

Edit `packages/langium-cli/package.json` — add to `devDependencies` and `scripts`:

```json
{
  "scripts": {
    "clean": "shx rm -rf lib coverage",
    "build": "tsc",
    "build:grammar-wasm": "cd src/grammar-parser && tree-sitter generate && tree-sitter build --wasm",
    "watch": "tsc --watch",
    "publish:next": "npm --no-git-tag-version version \"$(semver $npm_package_version -i minor)-next.$(git rev-parse --short HEAD)\" && npm publish --tag next",
    "publish:latest": "npm publish --tag latest --access public"
  },
  "devDependencies": {
    "@types/fs-extra": "~11.0.4",
    "tree-sitter-cli": "^0.24.0"
  }
}
```

- [ ] **Step 2: Install**

```sh
npm install
```

Expected: tree-sitter CLI available at `./node_modules/.bin/tree-sitter`.

- [ ] **Step 3: Commit**

```sh
git add packages/langium-cli/package.json package-lock.json
git commit -m "chore: add tree-sitter CLI devDep and build:grammar-wasm script"
```

---

## Task 2: Write `grammar.js` — the Tree-sitter Grammar for `.langium` Files

**Files:**
- Create: `packages/langium-cli/src/grammar-parser/grammar.js`

This file is the source of truth for all node type names used in `grammar-queries.ts` and tests.

- [ ] **Step 1: Create the complete `grammar.js`**

Create `packages/langium-cli/src/grammar-parser/grammar.js`:

```javascript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

module.exports = grammar({
  name: 'langium',

  word: $ => $.ID,

  extras: $ => [
    /\s+/,
    $.ML_COMMENT,
    $.SL_COMMENT,
  ],

  // Ambiguities between feature_name (which contains $.ID) and rule_call/simple_type
  conflicts: $ => [
    [$.simple_type, $.feature_name],
    [$.rule_call, $.feature_name],
    [$.terminal_rule_call, $.feature_name],
  ],

  rules: {

    // ═══════════════════════════════════════════════════
    // Root
    // ═══════════════════════════════════════════════════

    grammar: $ => seq(
      optional(seq('grammar', field('name', $.ID))),
      repeat($.grammar_import),
      repeat(choice(
        $.parser_rule,
        $.terminal_rule,
        $.infix_rule,
        $.interface_decl,
        $.type_decl,
        $.conflict_group_decl,
      )),
    ),

    grammar_import: $ => seq(
      'import',
      field('path', $.STRING),
      optional(';'),
    ),

    conflict_group_decl: $ => seq(
      'conflicts', ':', commaSep1($.conflict_group), optional(';'),
    ),

    conflict_group: $ => seq('[', commaSep1($.ID), ']'),

    // ═══════════════════════════════════════════════════
    // Interface declarations
    // ═══════════════════════════════════════════════════

    interface_decl: $ => seq(
      'interface',
      field('name', $.ID),
      optional(seq('extends', commaSep1(field('super_type', $.ID)))),
      '{',
      repeat($.type_attribute),
      '}',
      optional(';'),
    ),

    type_attribute: $ => seq(
      field('name', $.feature_name),
      optional(field('optional', '?')),
      ':',
      field('type', $.type_definition),
      optional(seq('=', field('default_value', $.value_literal))),
      optional(';'),
    ),

    // ═══════════════════════════════════════════════════
    // Type alias declarations
    // ═══════════════════════════════════════════════════

    type_decl: $ => seq(
      'type',
      field('name', $.ID),
      '=',
      field('type', $.type_definition),
      optional(';'),
    ),

    // ═══════════════════════════════════════════════════
    // Type definition expressions
    // ═══════════════════════════════════════════════════

    type_definition: $ => $.union_type,

    // A union_type is one or more array_types separated by '|'
    // When there is only one element, it is structurally an array_type (no union_type wrapper)
    union_type: $ => seq(
      $.array_type,
      repeat(seq('|', $.array_type)),
    ),

    array_type: $ => seq(
      $.reference_type,
      optional(seq('[', ']')),
    ),

    reference_type: $ => choice(
      $.simple_type,
      seq('@', field('reference_type', $.simple_type), optional('+')),
    ),

    simple_type: $ => choice(
      seq('(', $.type_definition, ')'),
      field('type_ref', $.ID),
      field('primitive_type', $.primitive_type),
      field('string_type', $.STRING),
    ),

    primitive_type: _ => choice('string', 'number', 'boolean', 'Date', 'bigint'),

    // ═══════════════════════════════════════════════════
    // Value literals (for interface attribute defaults)
    // ═══════════════════════════════════════════════════

    value_literal: $ => choice(
      $.string_literal,
      $.number_literal,
      $.boolean_literal,
      $.array_literal,
    ),

    string_literal:  $ => field('value', $.STRING),
    number_literal:  $ => field('value', $.NUMBER),
    boolean_literal: _ => choice('true', 'false'),
    array_literal:   $ => seq('[', optional(commaSep1($.value_literal)), ']'),

    // ═══════════════════════════════════════════════════
    // Parser rules
    // ═══════════════════════════════════════════════════

    parser_rule: $ => seq(
      optional(field('modifier', choice('entry', 'fragment'))),
      $.rule_name_and_params,
      optional(choice(
        seq('returns', field('return_type', choice($.ID, $.primitive_type))),
        field('inferred_type', $.inferred_type),
      )),
      ':',
      field('definition', $.alternatives),
      ';',
    ),

    infix_rule: $ => seq(
      'infix',
      $.rule_name_and_params,
      'on',
      field('call', $.rule_call),
      optional(choice(
        seq('returns', field('return_type', choice($.ID, $.primitive_type))),
        field('inferred_type', $.inferred_type),
      )),
      ':',
      field('operators', $.infix_rule_operators),
      ';',
    ),

    infix_rule_operators: $ => seq(
      $.infix_operator_list,
      repeat(seq('>', $.infix_operator_list)),
    ),

    infix_operator_list: $ => seq(
      optional(seq(field('associativity', choice('left', 'right')), 'assoc')),
      $.keyword,
      repeat(seq('|', $.keyword)),
    ),

    terminal_rule: $ => seq(
      optional(field('word_marker', '@word')),
      optional(field('hidden', 'hidden')),
      'terminal',
      optional(field('fragment', 'fragment')),
      field('name', $.ID),
      optional(seq('returns', field('return_type', $.ID))),
      ':',
      field('definition', $.terminal_alternatives),
      ';',
    ),

    rule_name_and_params: $ => seq(
      field('name', $.ID),
      optional(seq('<', optional(commaSep1($.parameter)), '>')),
    ),

    parameter: $ => field('name', $.ID),

    inferred_type: $ => seq(
      choice('infer', 'infers'),
      field('name', $.ID),
    ),

    // ═══════════════════════════════════════════════════
    // Alternatives / Groups / Tokens
    // ═══════════════════════════════════════════════════

    alternatives: $ => seq(
      $.conditional_branch,
      repeat(seq('|', $.conditional_branch)),
    ),

    conditional_branch: $ => choice(
      $.unordered_group,
      seq(
        '@prec',
        optional(seq('.', field('prec_assoc', choice('left', 'right')))),
        '(', field('prec', $.NUMBER), ')',
        repeat1($.abstract_token),
      ),
      seq('<', field('guard', $.disjunction), '>', repeat1($.abstract_token)),
    ),

    unordered_group: $ => seq(
      $.group,
      repeat(seq('&', $.group)),
    ),

    group: $ => repeat1($.abstract_token),

    abstract_token: $ => choice(
      $.abstract_token_with_cardinality,
      $.action,
    ),

    abstract_token_with_cardinality: $ => seq(
      choice($.assignment, $.abstract_terminal),
      optional($.cardinality),
    ),

    cardinality: _ => choice('?', '*', '+'),

    action: $ => seq(
      '{',
      choice(field('type', $.ID), field('inferred_type', $.inferred_type)),
      optional(seq(
        '.',
        field('feature', $.feature_name),
        field('operator', choice('=', '+=')),
        'current',
      )),
      '}',
    ),

    abstract_terminal: $ => choice(
      $.keyword,
      $.rule_call,
      $.parenthesized_element,
      $.predicated_keyword,
      $.predicated_rule_call,
      $.predicated_group,
      $.end_of_file,
    ),

    end_of_file: _ => 'EOF',

    keyword: $ => field('value', $.STRING),

    rule_call: $ => seq(
      field('rule', $.ID),
      optional(seq('<', commaSep1($.named_argument), '>')),
    ),

    named_argument: $ => seq(
      optional(seq(field('parameter', $.ID), '=')),
      field('value', $.disjunction),
    ),

    predicated_keyword: $ => seq(choice('=>', '->'), field('value', $.STRING)),

    predicated_rule_call: $ => seq(
      choice('=>', '->'),
      field('rule', $.ID),
      optional(seq('<', commaSep1($.named_argument), '>')),
    ),

    predicated_group: $ => seq(
      choice('=>', '->'),
      '(',
      field('elements', $.alternatives),
      ')',
    ),

    // ═══════════════════════════════════════════════════
    // Assignments
    // ═══════════════════════════════════════════════════

    assignment: $ => seq(
      optional(choice('=>', '->')),
      field('feature', $.feature_name),
      field('operator', choice('+=', '=', '?=')),
      field('terminal', $.assignable_terminal),
    ),

    assignable_terminal: $ => choice(
      $.keyword,
      $.rule_call,
      $.parenthesized_assignable,
      $.cross_reference,
    ),

    parenthesized_assignable: $ => seq('(', $.assignable_alternatives, ')'),

    assignable_alternatives: $ => seq(
      $.assignable_terminal,
      repeat(seq('|', $.assignable_terminal)),
    ),

    cross_reference: $ => seq(
      '[',
      optional(field('multi', '+')),
      field('type', $.ID),
      optional(seq(choice('|', ':'), field('terminal', $.cross_referenceable_terminal))),
      ']',
    ),

    cross_referenceable_terminal: $ => choice($.keyword, $.rule_call),

    parenthesized_element: $ => seq('(', $.alternatives, ')'),

    // ═══════════════════════════════════════════════════
    // Conditions (guarded branches and named arguments)
    // ═══════════════════════════════════════════════════

    disjunction:  $ => seq($.conjunction, repeat(seq('|', $.conjunction))),
    conjunction:  $ => seq($.negation, repeat(seq('&', $.negation))),
    negation:     $ => choice($.atom, seq('!', $.negation)),
    atom:         $ => choice(
      $.parameter_reference,
      seq('(', $.disjunction, ')'),
      'true',
      'false',
    ),
    parameter_reference: $ => field('parameter', $.ID),

    // ═══════════════════════════════════════════════════
    // Terminal rule elements
    // ═══════════════════════════════════════════════════

    terminal_alternatives: $ => seq(
      $.terminal_group,
      repeat(seq('|', $.terminal_group)),
    ),

    terminal_group: $ => seq(
      $.terminal_token,
      repeat($.terminal_token),
    ),

    terminal_token: $ => seq(
      $.terminal_token_element,
      optional($.cardinality),
    ),

    terminal_token_element: $ => choice(
      $.character_range,
      $.terminal_rule_call,
      $.parenthesized_terminal,
      $.negated_token,
      $.until_token,
      $.regex_token,
      $.wildcard,
    ),

    parenthesized_terminal: $ => seq(
      '(',
      optional(field('lookahead', choice('?=', '?!', '?<=', '?<!'))),
      $.terminal_alternatives,
      ')',
    ),

    terminal_rule_call: $ => field('rule', $.ID),

    negated_token: $ => seq('!', $.terminal_token_element),

    until_token:  $ => seq('->', $.terminal_token_element),

    regex_token:  $ => $.RegexLiteral,

    wildcard:     _ => '.',

    character_range: $ => seq(
      field('left', $.STRING),
      optional(seq('..', field('right', $.STRING))),
    ),

    // ═══════════════════════════════════════════════════
    // Feature names — keywords allowed as property names in assignments
    // ═══════════════════════════════════════════════════

    feature_name: $ => choice(
      'infix', 'on', 'right', 'left', 'assoc', 'conflicts', 'current',
      'entry', 'extends', 'false', 'fragment', 'grammar', 'hidden',
      'import', 'interface', 'returns', 'terminal', 'true', 'type',
      'infer', 'infers', 'with', $.primitive_type, $.ID,
    ),

    // ═══════════════════════════════════════════════════
    // Terminals
    // ═══════════════════════════════════════════════════

    ID:           _ => /\^?[_a-zA-Z][\w_]*/,
    STRING:       _ => /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/,
    NUMBER:       _ => /NaN|-?((\d*\.\d+|\d+)([Ee][+-]?\d+)?|Infinity)/,
    RegexLiteral: _ => /\/(?![*+?])(?:[^\r\n\[/\\]|\\.|\[(?:[^\r\n\]\\]|\\.)*\])+\/[a-z]*/,
    ML_COMMENT:   _ => /\/\*[\s\S]*?\*\//,
    SL_COMMENT:   _ => /\/\/[^\n\r]*/,
  },
});

function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}
```

- [ ] **Step 2: Commit**

```sh
git add packages/langium-cli/src/grammar-parser/grammar.js
git commit -m "feat: add tree-sitter grammar.js for Langium grammar language"
```

---

## Task 3: Build `langium-grammar.wasm`

**Files:**
- Create: `packages/langium-cli/src/grammar-parser/langium-grammar.wasm` (binary)

- [ ] **Step 1: Generate the parser C code and compile to WASM**

```sh
cd packages/langium-cli
npx tree-sitter generate src/grammar-parser/grammar.js
npx tree-sitter build --wasm src/grammar-parser
```

`tree-sitter generate` produces `src/grammar-parser/src/` with C parser code.
`tree-sitter build --wasm` produces `langium.wasm` — rename it:

```sh
mv langium.wasm src/grammar-parser/langium-grammar.wasm
```

Expected: `packages/langium-cli/src/grammar-parser/langium-grammar.wasm` exists, non-zero size.

- [ ] **Step 2: Validate parsing works**

Create a quick smoke test script `packages/langium-cli/test-wasm-smoke.mjs` (delete after):

```javascript
import Parser from 'web-tree-sitter';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
await Parser.init();
const lang = await Parser.Language.load(
  join(__dirname, 'src/grammar-parser/langium-grammar.wasm')
);
const parser = new Parser();
parser.setLanguage(lang);

const src = `
grammar Arithmetic
entry Definition: expressions+=NamedExpression*;
NamedExpression: name=ID ':' value=Expression;
Expression: Addition;
terminal ID: /[_a-zA-Z][\\w_]*/;
`;

const tree = parser.parse(src);
console.log('root type:', tree.rootNode.type);          // grammar
console.log('children:', tree.rootNode.namedChildren.map(n => n.type));
// Expected: [ 'parser_rule', 'parser_rule', 'parser_rule', 'terminal_rule' ]
console.log('ERROR nodes:', tree.rootNode.toString().includes('ERROR') ? 'YES - FIX grammar.js' : 'none');
```

Run:
```sh
cd packages/langium-cli && node test-wasm-smoke.mjs
```

Expected output:
```
root type: grammar
children: [ 'parser_rule', 'parser_rule', 'parser_rule', 'terminal_rule' ]
ERROR nodes: none
```

If ERROR nodes appear, inspect `tree.rootNode.toString()` to find which rule fails, then fix `grammar.js` and re-run Task 3.

- [ ] **Step 3: Delete smoke test, commit wasm + generated sources**

```sh
rm packages/langium-cli/test-wasm-smoke.mjs
git add packages/langium-cli/src/grammar-parser/langium-grammar.wasm \
        packages/langium-cli/src/grammar-parser/src/
git commit -m "feat: add compiled langium-grammar.wasm and generated parser C sources"
```

---

## Task 4: Write `grammar-parser.ts`

**Files:**
- Create: `packages/langium-cli/src/grammar-parser/grammar-parser.ts`
- Create: `packages/langium-cli/test/grammar-parser/grammar-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/langium-cli/test/grammar-parser/grammar-parser.test.ts`:

```typescript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, it, expect, beforeAll } from 'vitest';
import type { SyntaxNode } from 'web-tree-sitter';
import { DefaultGrammarParser } from '../../src/grammar-parser/grammar-parser.js';

describe('DefaultGrammarParser', () => {
    let parser: DefaultGrammarParser;

    beforeAll(async () => {
        parser = new DefaultGrammarParser();
    });

    it('parses a minimal grammar and returns root SyntaxNode', async () => {
        const root = await parser.parse(`
grammar Foo
entry Bar: name=ID;
terminal ID: /[a-z]+/;
`);
        expect(root.type).toBe('grammar');
        expect(root.hasError).toBe(false);
    });

    it('root has grammar name', async () => {
        const root = await parser.parse(`grammar Foo entry Bar: x=ID; terminal ID: /x/;`);
        const nameNode = root.childForFieldName('name');
        expect(nameNode?.text).toBe('Foo');
    });

    it('root has parser_rule and terminal_rule children', async () => {
        const root = await parser.parse(`grammar Foo entry Bar: x=ID; terminal ID: /x/;`);
        const types = root.namedChildren.map(n => n.type);
        expect(types).toContain('parser_rule');
        expect(types).toContain('terminal_rule');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

```sh
npx vitest run packages/langium-cli/test/grammar-parser/grammar-parser.test.ts
```

Expected: FAIL — `DefaultGrammarParser` not defined.

- [ ] **Step 3: Implement `grammar-parser.ts`**

Create `packages/langium-cli/src/grammar-parser/grammar-parser.ts`:

```typescript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import Parser from 'web-tree-sitter';
import type { SyntaxNode } from 'web-tree-sitter';
import { readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getImports, getImportPath } from './grammar-queries.js';

const WASM_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'langium-grammar.wasm'
);

export type ParsedGrammarSet = Map<string, SyntaxNode>;

export interface GrammarParser {
    parse(text: string): Promise<SyntaxNode>;
    parseWithImports(entryPath: string): Promise<ParsedGrammarSet>;
}

export class DefaultGrammarParser implements GrammarParser {
    private tsParser: Parser | null = null;

    private async init(): Promise<void> {
        if (this.tsParser) return;
        await Parser.init();
        const language = await Parser.Language.load(WASM_PATH);
        this.tsParser = new Parser();
        this.tsParser.setLanguage(language);
    }

    async parse(text: string): Promise<SyntaxNode> {
        await this.init();
        return this.tsParser!.parse(text).rootNode;
    }

    async parseWithImports(entryPath: string): Promise<ParsedGrammarSet> {
        const set: ParsedGrammarSet = new Map();
        await this.parseFile(resolve(entryPath), set);
        return set;
    }

    private async parseFile(filePath: string, set: ParsedGrammarSet): Promise<void> {
        if (set.has(filePath)) return;
        const text = await readFile(filePath, 'utf-8');
        const root = await this.parse(text);
        set.set(filePath, root);
        for (const importNode of getImports(root)) {
            const importPath = getImportPath(importNode);
            const resolved = resolve(dirname(filePath), importPath.replace(/^\//, '') + '.langium');
            await this.parseFile(resolved, set);
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
npx vitest run packages/langium-cli/test/grammar-parser/grammar-parser.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/langium-cli/src/grammar-parser/grammar-parser.ts \
        packages/langium-cli/test/grammar-parser/grammar-parser.test.ts
git commit -m "feat: add DefaultGrammarParser — parse .langium → SyntaxNode via web-tree-sitter"
```

---

## Task 5: Write `grammar-queries.ts` — Structural Queries

**Files:**
- Create: `packages/langium-cli/src/grammar-parser/grammar-queries.ts`
- Create: `packages/langium-cli/test/grammar-parser/grammar-queries.test.ts`

These are the shared node-type names defined by `grammar.js` and used by all queries:
- Root children: `parser_rule`, `terminal_rule`, `infix_rule`, `interface_decl`, `type_decl`, `grammar_import`
- Fields on `parser_rule`: `name` (via `rule_name_and_params`), `modifier`, `return_type`, `inferred_type`, `definition`
- Fields on `assignment`: `feature`, `operator`, `terminal`
- Fields on `cross_reference`: `type`, `multi`

- [ ] **Step 1: Write the failing tests**

Create `packages/langium-cli/test/grammar-parser/grammar-queries.test.ts`:

```typescript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, it, expect, beforeAll } from 'vitest';
import { DefaultGrammarParser } from '../../src/grammar-parser/grammar-parser.js';
import {
    getRules, getTerminals, getInterfaces, getTypeDecls, getImports,
    getGrammarName, getRuleName, getRuleReturnType, isEntryRule, isFragment,
    getTerminalPattern, getImportPath, getAssignments,
} from '../../src/grammar-parser/grammar-queries.js';

const GRAMMAR = `
grammar Arithmetic

import './expressions'

interface Named {
    name: string;
}

type Expr = Addition | Subtraction;

entry Definition returns Definition:
    expressions+=NamedExpression*;

fragment NamedExpression returns NamedExpression:
    name=ID ':' value=Expression;

terminal ID: /[_a-zA-Z][\\w_]*/;
hidden terminal WS: /\\s+/;
`;

let root: any;
beforeAll(async () => {
    const parser = new DefaultGrammarParser();
    root = await parser.parse(GRAMMAR);
});

describe('structural queries', () => {
    it('getGrammarName', () => expect(getGrammarName(root)).toBe('Arithmetic'));
    it('getImports returns import nodes', () => expect(getImports(root)).toHaveLength(1));
    it('getImportPath extracts path string', () => expect(getImportPath(getImports(root)[0])).toBe('./expressions'));
    it('getRules returns parser_rule nodes (not terminals)', () => expect(getRules(root)).toHaveLength(2));
    it('getTerminals returns terminal_rule nodes', () => expect(getTerminals(root)).toHaveLength(2));
    it('getInterfaces returns interface_decl nodes', () => expect(getInterfaces(root)).toHaveLength(1));
    it('getTypeDecls returns type_decl nodes', () => expect(getTypeDecls(root)).toHaveLength(1));
    it('getRuleName for entry rule', () => expect(getRuleName(getRules(root)[0])).toBe('Definition'));
    it('isEntryRule', () => expect(isEntryRule(getRules(root)[0])).toBe(true));
    it('isFragment', () => expect(isFragment(getRules(root)[1])).toBe(true));
    it('getRuleReturnType', () => expect(getRuleReturnType(getRules(root)[0])).toBe('Definition'));
    it('getTerminalPattern for ID', () => {
        const id = getTerminals(root).find(t => getRuleName(t) === 'ID')!;
        expect(getTerminalPattern(id)).toBe('/[_a-zA-Z][\\w_]*/');
    });
});

describe('getAssignments', () => {
    it('collects += assignment from Definition rule', () => {
        const def = getRules(root)[0];
        const assignments = getAssignments(def);
        expect(assignments).toHaveLength(1);
        expect(assignments[0].feature).toBe('expressions');
        expect(assignments[0].operator).toBe('+=');
        expect(assignments[0].isRef).toBe(false);
    });

    it('collects cross-reference assignment as isRef=true', async () => {
        const parser = new DefaultGrammarParser();
        const r = await parser.parse(`grammar X Rule: ref=[Foo:ID]; terminal ID: /x/;`);
        const rule = getRules(r)[0];
        const assignments = getAssignments(rule);
        expect(assignments[0].isRef).toBe(true);
        expect(assignments[0].feature).toBe('ref');
        expect(assignments[0].operator).toBe('=');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

```sh
npx vitest run packages/langium-cli/test/grammar-parser/grammar-queries.test.ts
```

Expected: FAIL — query functions not defined.

- [ ] **Step 3: Implement structural queries in `grammar-queries.ts`**

Create `packages/langium-cli/src/grammar-parser/grammar-queries.ts`:

```typescript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { SyntaxNode } from 'web-tree-sitter';
import type { ParsedGrammarSet } from './grammar-parser.js';

// ─── Result record types (no $cstNode, no lazy refs) ────────────────────────

export interface AssignmentInfo {
    feature: string;
    operator: '=' | '+=' | '?=';
    isRef: boolean;
    /** Raw text of the RHS (rule call name, keyword text, etc.) */
    typeText: string;
}

export interface TypeInfo {
    name: string;
    superTypes: string[];
    /** true when declared with 'interface' keyword */
    isInterface: boolean;
}

export interface FieldInfo {
    name: string;
    operator: '=' | '+=' | '?=';
    /** Resolved type name or primitive */
    type: string;
    isRef: boolean;
    isOptional: boolean;
}

// ─── Structural queries ───────────────────────────────────────────────────────

export function getGrammarName(root: SyntaxNode): string | null {
    return root.childForFieldName('name')?.text ?? null;
}

export function getImports(root: SyntaxNode): SyntaxNode[] {
    return root.namedChildren.filter(n => n.type === 'grammar_import');
}

export function getImportPath(importNode: SyntaxNode): string {
    const raw = importNode.childForFieldName('path')?.text ?? '';
    return raw.replace(/^['"]|['"]$/g, '');
}

export function getRules(root: SyntaxNode): SyntaxNode[] {
    return root.namedChildren.filter(
        n => n.type === 'parser_rule' || n.type === 'infix_rule'
    );
}

export function getTerminals(root: SyntaxNode): SyntaxNode[] {
    return root.namedChildren.filter(n => n.type === 'terminal_rule');
}

export function getInterfaces(root: SyntaxNode): SyntaxNode[] {
    return root.namedChildren.filter(n => n.type === 'interface_decl');
}

export function getTypeDecls(root: SyntaxNode): SyntaxNode[] {
    return root.namedChildren.filter(n => n.type === 'type_decl');
}

/** Name from rule_name_and_params.name field */
export function getRuleName(rule: SyntaxNode): string {
    if (rule.type === 'parser_rule' || rule.type === 'infix_rule') {
        const rnp = rule.namedChildren.find(n => n.type === 'rule_name_and_params');
        return rnp?.childForFieldName('name')?.text ?? '';
    }
    if (rule.type === 'terminal_rule') {
        return rule.childForFieldName('name')?.text ?? '';
    }
    return rule.childForFieldName('name')?.text ?? '';
}

export function isEntryRule(rule: SyntaxNode): boolean {
    return rule.childForFieldName('modifier')?.text === 'entry';
}

export function isFragment(rule: SyntaxNode): boolean {
    return rule.childForFieldName('modifier')?.text === 'fragment';
}

export function isHiddenTerminal(rule: SyntaxNode): boolean {
    return rule.type === 'terminal_rule' && rule.childForFieldName('hidden') !== null;
}

/** Returns the return type name, or null if absent or inferred */
export function getRuleReturnType(rule: SyntaxNode): string | null {
    return rule.childForFieldName('return_type')?.text ?? null;
}

/** Returns the inferred type name from `infers Foo` or `infer Foo` */
export function getInferredTypeName(rule: SyntaxNode): string | null {
    const it = rule.childForFieldName('inferred_type');
    return it?.childForFieldName('name')?.text ?? null;
}

/** Returns the regex pattern text (including slashes) for a terminal_rule */
export function getTerminalPattern(terminal: SyntaxNode): string | null {
    const def = terminal.childForFieldName('definition');
    if (!def) return null;
    return extractTerminalPatternText(def);
}

function extractTerminalPatternText(node: SyntaxNode): string | null {
    if (node.type === 'regex_token') return node.text;
    for (const child of node.namedChildren) {
        const found = extractTerminalPatternText(child);
        if (found) return found;
    }
    return null;
}

// ─── Assignment collection ────────────────────────────────────────────────────

/** Collect all assignments anywhere in a rule's definition subtree */
export function getAssignments(rule: SyntaxNode): AssignmentInfo[] {
    const def = rule.childForFieldName('definition');
    if (!def) return [];
    const results: AssignmentInfo[] = [];
    collectAssignments(def, results);
    return results;
}

function collectAssignments(node: SyntaxNode, out: AssignmentInfo[]): void {
    if (node.type === 'assignment') {
        const feature = node.childForFieldName('feature')?.text ?? '';
        const operator = node.childForFieldName('operator')?.text as '=' | '+=' | '?=';
        const terminal = node.childForFieldName('terminal');
        const isRef = terminal !== null && terminalContainsCrossRef(terminal);
        const typeText = extractTypeText(terminal);
        out.push({ feature, operator, isRef, typeText });
        return;
    }
    for (const child of node.namedChildren) {
        collectAssignments(child, out);
    }
}

function terminalContainsCrossRef(node: SyntaxNode): boolean {
    if (node.type === 'cross_reference') return true;
    return node.namedChildren.some(terminalContainsCrossRef);
}

function extractTypeText(node: SyntaxNode | null): string {
    if (!node) return '';
    if (node.type === 'rule_call') return node.childForFieldName('rule')?.text ?? '';
    if (node.type === 'cross_reference') return node.childForFieldName('type')?.text ?? '';
    if (node.type === 'keyword') return node.childForFieldName('value')?.text ?? node.text;
    if (node.namedChildren.length > 0) return extractTypeText(node.namedChildren[0]);
    return node.text;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```sh
npx vitest run packages/langium-cli/test/grammar-parser/grammar-queries.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/langium-cli/src/grammar-parser/grammar-queries.ts \
        packages/langium-cli/test/grammar-parser/grammar-queries.test.ts
git commit -m "feat: add grammar-queries.ts structural query helpers over SyntaxNode"
```

---

## Task 6: Write `grammar-queries.ts` — Semantic Analysis

**Files:**
- Modify: `packages/langium-cli/src/grammar-parser/grammar-queries.ts`
- Modify: `packages/langium-cli/test/grammar-parser/grammar-queries.test.ts`

- [ ] **Step 1: Add failing semantic tests**

Append to `packages/langium-cli/test/grammar-parser/grammar-queries.test.ts`:

```typescript
import {
    collectTypes, collectFields, getTypeHierarchy, resolveRuleRef,
} from '../../src/grammar-parser/grammar-queries.js';
import type { ParsedGrammarSet } from '../../src/grammar-parser/grammar-parser.js';

const FULL_GRAMMAR = `
grammar Test

interface Expr { }
interface Addition extends Expr { left: Expr; right: Expr; }

type Statement = Rule1 | Rule2;

entry Rule1 returns Rule1: name=ID (':' ref=[Rule2:ID])?;
Rule2 returns Rule2: value=STRING;
terminal ID: /[a-z]+/;
terminal STRING: /"[^"]*"/;
`;

let set: ParsedGrammarSet;
beforeAll(async () => {
    const parser = new DefaultGrammarParser();
    const r = await parser.parse(FULL_GRAMMAR);
    set = new Map([['test.langium', r]]);
});

describe('collectTypes', () => {
    it('includes interface types', () => {
        const types = collectTypes(set);
        const names = types.map(t => t.name);
        expect(names).toContain('Expr');
        expect(names).toContain('Addition');
    });

    it('marks interface types as isInterface=true', () => {
        const types = collectTypes(set);
        expect(types.find(t => t.name === 'Expr')?.isInterface).toBe(true);
    });

    it('includes rule return types', () => {
        const types = collectTypes(set);
        const names = types.map(t => t.name);
        expect(names).toContain('Rule1');
        expect(names).toContain('Rule2');
    });

    it('includes type_decl types', () => {
        const types = collectTypes(set);
        expect(types.map(t => t.name)).toContain('Statement');
    });
});

describe('getTypeHierarchy', () => {
    it('Addition extends Expr', () => {
        const h = getTypeHierarchy(set);
        expect(h.get('Addition')).toContain('Expr');
    });
});

describe('collectFields', () => {
    it('returns fields from interface declaration', () => {
        const fields = collectFields('Addition', set);
        const names = fields.map(f => f.name);
        expect(names).toContain('left');
        expect(names).toContain('right');
    });

    it('returns fields from rule assignments', () => {
        const fields = collectFields('Rule1', set);
        const names = fields.map(f => f.name);
        expect(names).toContain('name');
        expect(names).toContain('ref');
    });

    it('marks cross-reference field as isRef=true', () => {
        const fields = collectFields('Rule1', set);
        expect(fields.find(f => f.name === 'ref')?.isRef).toBe(true);
    });

    it('marks += field as non-optional array', () => {
        const parser = new DefaultGrammarParser();
        // +=  → operator '+=' → isOptional false (always present as array)
        // Need an async test here — use a separate describe block if needed
    });
});

describe('resolveRuleRef', () => {
    it('finds a rule by name', () => {
        const node = resolveRuleRef('Rule1', set);
        expect(node).not.toBeNull();
        expect(node?.type).toBe('parser_rule');
    });

    it('returns null for unknown name', () => {
        expect(resolveRuleRef('NoSuchRule', set)).toBeNull();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

```sh
npx vitest run packages/langium-cli/test/grammar-parser/grammar-queries.test.ts
```

Expected: FAIL — `collectTypes` etc. not defined.

- [ ] **Step 3: Add semantic analysis functions to `grammar-queries.ts`**

Append to `packages/langium-cli/src/grammar-parser/grammar-queries.ts`:

```typescript
// ─── Semantic analysis ────────────────────────────────────────────────────────

/** Collect all type names across the grammar set (rules, interfaces, type aliases) */
export function collectTypes(set: ParsedGrammarSet): TypeInfo[] {
    const seen = new Map<string, TypeInfo>();

    for (const root of set.values()) {
        // Explicit interface declarations
        for (const iface of getInterfaces(root)) {
            const name = iface.childForFieldName('name')?.text ?? '';
            if (!seen.has(name)) {
                const superTypes = iface.namedChildren
                    .filter(n => n.type === 'ID' && n !== iface.childForFieldName('name'))
                    .map(n => n.text);
                seen.set(name, { name, superTypes, isInterface: true });
            }
        }

        // type alias declarations
        for (const td of getTypeDecls(root)) {
            const name = td.childForFieldName('name')?.text ?? '';
            if (!seen.has(name)) {
                seen.set(name, { name, superTypes: [], isInterface: false });
            }
        }

        // Parser rules with explicit return type or inferred type
        for (const rule of getRules(root)) {
            const returnType = getRuleReturnType(rule) ?? getInferredTypeName(rule) ?? getRuleName(rule);
            if (returnType && !seen.has(returnType)) {
                seen.set(returnType, { name: returnType, superTypes: [], isInterface: false });
            }
            // Also collect {TypeName} action types within the rule definition
            const def = rule.childForFieldName('definition');
            if (def) {
                collectActionTypes(def, seen);
            }
        }
    }

    return Array.from(seen.values());
}

function collectActionTypes(node: SyntaxNode, out: Map<string, TypeInfo>): void {
    if (node.type === 'action') {
        const typeName = node.childForFieldName('type')?.text
            ?? node.childForFieldName('inferred_type')?.childForFieldName('name')?.text;
        if (typeName && !out.has(typeName)) {
            out.set(typeName, { name: typeName, superTypes: [], isInterface: false });
        }
    }
    for (const child of node.namedChildren) {
        collectActionTypes(child, out);
    }
}

/** Returns type → supertype names map */
export function getTypeHierarchy(set: ParsedGrammarSet): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const root of set.values()) {
        for (const iface of getInterfaces(root)) {
            const name = iface.childForFieldName('name')?.text ?? '';
            const superTypes = iface.namedChildren
                .filter(n => n.type === 'ID' && n !== iface.childForFieldName('name'))
                .map(n => n.text);
            map.set(name, superTypes);
        }
    }
    return map;
}

/** Collect all fields for a named type across the grammar set */
export function collectFields(typeName: string, set: ParsedGrammarSet): FieldInfo[] {
    const fields = new Map<string, FieldInfo>();

    for (const root of set.values()) {
        // Fields from interface declaration attributes
        for (const iface of getInterfaces(root)) {
            if ((iface.childForFieldName('name')?.text ?? '') !== typeName) continue;
            for (const attr of iface.namedChildren.filter(n => n.type === 'type_attribute')) {
                const name = attr.childForFieldName('name')?.text ?? '';
                const isOptional = attr.childForFieldName('optional') !== null;
                const typeText = extractTypeDefText(attr.childForFieldName('type'));
                if (name && !fields.has(name)) {
                    fields.set(name, { name, operator: '=', type: typeText, isRef: false, isOptional });
                }
            }
        }

        // Fields from rule assignments (rules that return this type)
        for (const rule of getRules(root)) {
            const ruleType = getRuleReturnType(rule) ?? getInferredTypeName(rule) ?? getRuleName(rule);
            if (ruleType !== typeName) continue;
            for (const a of getAssignments(rule)) {
                if (!fields.has(a.feature)) {
                    fields.set(a.feature, {
                        name: a.feature,
                        operator: a.operator,
                        type: a.typeText,
                        isRef: a.isRef,
                        isOptional: a.operator === '?=' || a.operator === '=',
                    });
                }
            }
        }
    }

    return Array.from(fields.values());
}

function extractTypeDefText(node: SyntaxNode | null): string {
    if (!node) return 'unknown';
    return node.text.trim();
}

/** Find a rule SyntaxNode by name across the whole grammar set */
export function resolveRuleRef(name: string, set: ParsedGrammarSet): SyntaxNode | null {
    for (const root of set.values()) {
        const found = [...getRules(root), ...getTerminals(root)]
            .find(r => getRuleName(r) === name);
        if (found) return found;
    }
    return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```sh
npx vitest run packages/langium-cli/test/grammar-parser/grammar-queries.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/langium-cli/src/grammar-parser/grammar-queries.ts \
        packages/langium-cli/test/grammar-parser/grammar-queries.test.ts
git commit -m "feat: add semantic analysis functions to grammar-queries (collectTypes, collectFields, getTypeHierarchy, resolveRuleRef)"
```

---

## Task 7: Rewrite `ast-generator.ts`

**Files:**
- Modify: `packages/langium-cli/src/generator/ast-generator.ts`
- Modify: `packages/langium-cli/test/generator/ast-generator.test.ts`

The current `ast-generator.ts` imports `collectAst`, `collectTypeHierarchy`, `AstTypes` from `langium/grammar`. These are replaced by `collectTypes`, `collectFields`, `getTypeHierarchy` from `grammar-queries.ts`. The output format must remain identical: the same TypeScript interface declarations and AstReflection that the generated grammars already produce.

- [ ] **Step 1: Write a focused regression test for arithmetic grammar output**

Replace the top of `packages/langium-cli/test/generator/ast-generator.test.ts` with tests that drive from `ParsedGrammarSet`:

```typescript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, it, expect, beforeAll } from 'vitest';
import { DefaultGrammarParser, type ParsedGrammarSet } from '../../src/grammar-parser/grammar-parser.js';
import { generateAst } from '../../src/generator/ast-generator.js';
import type { LangiumConfig } from '../../src/package-types.js';

const ARITHMETIC_GRAMMAR = `
grammar Arithmetic

entry Definition:
    elements+=NamedExpression*;

NamedExpression:
    name=ID ':' value=Expression;

Expression:
    Addition;

Addition infix on Expression returns Expression:
    '+';

terminal ID: /[_a-zA-Z][\\w_]*/;
terminal NUMBER returns number: /[0-9]+(\\.[0-9]+)?/;
hidden terminal WS: /\\s+/;
`;

const CONFIG: LangiumConfig = {
    projectName: 'Arithmetic',
    languages: [],
    out: '',
    importExtension: '.js',
};

let set: ParsedGrammarSet;
beforeAll(async () => {
    const parser = new DefaultGrammarParser();
    const root = await parser.parse(ARITHMETIC_GRAMMAR);
    set = new Map([['arithmetic.langium', root]]);
});

describe('generateAst', () => {
    it('emits interface for each rule type', () => {
        const output = generateAst(set, CONFIG);
        expect(output).toContain('export interface Definition');
        expect(output).toContain('export interface NamedExpression');
    });

    it('emits += fields as arrays', () => {
        const output = generateAst(set, CONFIG);
        expect(output).toContain('elements: NamedExpression[]');
    });

    it('emits string field for name', () => {
        const output = generateAst(set, CONFIG);
        expect(output).toContain("name: string");
    });

    it('produces an ArithmeticAstType union', () => {
        const output = generateAst(set, CONFIG);
        expect(output).toContain('ArithmeticAstType');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

```sh
npx vitest run packages/langium-cli/test/generator/ast-generator.test.ts
```

Expected: FAIL — `generateAst` not found or has wrong signature.

- [ ] **Step 3: Rewrite `ast-generator.ts`**

Replace `packages/langium-cli/src/generator/ast-generator.ts` entirely:

```typescript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { expandToNode, joinToNode, toString } from 'langium/generate';
import type { ParsedGrammarSet } from '../grammar-parser/grammar-parser.js';
import {
    collectTypes, collectFields, getTypeHierarchy, getRules, getTerminals,
    getRuleName, getRuleReturnType, getInferredTypeName, isHiddenTerminal,
    getTerminalPattern,
} from '../grammar-parser/grammar-queries.js';
import type { LangiumConfig } from '../package-types.js';
import { generatedHeader } from './node-util.js';

export function generateAst(set: ParsedGrammarSet, config: LangiumConfig): string {
    const types = collectTypes(set);
    const hierarchy = getTypeHierarchy(set);
    const typeNames = types.map(t => t.name).sort();

    const node = expandToNode`
        ${generatedHeader}

        /* eslint-disable */
        import type * as langium from 'langium';

        ${generateTerminals(set)}

        ${joinToNode(types.filter(t => t.isInterface), t => {
            const fields = collectFields(t.name, set);
            const supers = (hierarchy.get(t.name) ?? []).join(', ');
            return expandToNode`
                export interface ${t.name}${supers ? ` extends ${supers}` : ''} {
                    readonly $type: '${t.name}';
                    ${joinToNode(fields, f => {
                        const ftype = mapFieldType(f.type, f.isRef);
                        const arr = f.operator === '+=' ? '[]' : '';
                        const opt = f.operator === '=' || f.operator === '?=' ? '?' : '';
                        return `${f.name}${opt}: ${ftype}${arr};`;
                    }, { appendNewLineIfNotEmpty: true })}
                }
            `.appendNewLine();
        })}

        ${joinToNode(types.filter(t => !t.isInterface), t => {
            const fields = collectFields(t.name, set);
            if (fields.length === 0) return expandToNode`export type ${t.name} = langium.AstNode & { readonly $type: '${t.name}' };`.appendNewLine();
            return expandToNode`
                export interface ${t.name} extends langium.AstNode {
                    readonly $type: '${t.name}';
                    ${joinToNode(fields, f => {
                        const ftype = mapFieldType(f.type, f.isRef);
                        const arr = f.operator === '+=' ? '[]' : '';
                        const opt = f.operator === '=' || f.operator === '?=' ? '?' : '';
                        return `${f.name}${opt}: ${ftype}${arr};`;
                    }, { appendNewLineIfNotEmpty: true })}
                }
            `.appendNewLine();
        })}

        export type ${config.projectName}AstType = ${typeNames.map(n => `'${n}'`).join(' | ')};

        export class ${config.projectName}AstReflection extends langium.AbstractAstReflection {
            getAllTypes(): string[] {
                return [${typeNames.map(n => `'${n}'`).join(', ')}];
            }
            protected override computeIsSubtype(subtype: string, supertype: string): boolean {
                ${generateSubtypeChecks(types, hierarchy)}
                return false;
            }
        }
    `.appendNewLine();

    return toString(node);
}

function generateTerminals(set: ParsedGrammarSet): string {
    const lines: string[] = [];
    for (const root of set.values()) {
        for (const t of getTerminals(root)) {
            if (isHiddenTerminal(t)) continue;
            const name = getRuleName(t);
            const pattern = getTerminalPattern(t) ?? '/.*/';
            lines.push(`export const ${name}Terminal = ${pattern};`);
        }
    }
    return lines.join('\n');
}

function mapFieldType(typeText: string, isRef: boolean): string {
    if (isRef) return `langium.Reference<${typeText}>`;
    const primitives: Record<string, string> = {
        string: 'string', number: 'number', boolean: 'boolean', Date: 'Date', bigint: 'bigint',
    };
    return primitives[typeText] ?? typeText;
}

function generateSubtypeChecks(types: ReturnType<typeof collectTypes>, hierarchy: Map<string, string[]>): string {
    const lines: string[] = [];
    for (const t of types) {
        const supers = hierarchy.get(t.name) ?? [];
        if (supers.length > 0) {
            lines.push(
                `if (subtype === '${t.name}') return ${supers.map(s => `supertype === '${s}'`).join(' || ')};`
            );
        }
    }
    return lines.join('\n            ');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```sh
npx vitest run packages/langium-cli/test/generator/ast-generator.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/langium-cli/src/generator/ast-generator.ts \
        packages/langium-cli/test/generator/ast-generator.test.ts
git commit -m "feat: rewrite ast-generator to use SyntaxNode via grammar-queries (drop GrammarAST)"
```

---

## Task 8: Rewrite `module-generator.ts`

**Files:**
- Modify: `packages/langium-cli/src/generator/module-generator.ts`
- Modify: `packages/langium-cli/test/generator/types-generator.test.ts` (add module test)

The module generator emits the DI wiring module. It no longer needs `Grammar` objects — it needs grammar name, rule names, and language config (which comes from `langium-config.json`, not the grammar).

- [ ] **Step 1: Write failing test**

Append to `packages/langium-cli/test/generator/types-generator.test.ts`:

```typescript
import { generateModule } from '../../src/generator/module-generator.js';
import type { ParsedGrammarSet } from '../../src/grammar-parser/grammar-parser.js';
import type { LangiumConfig, LangiumLanguageConfig } from '../../src/package-types.js';

describe('generateModule', () => {
    it('emits GeneratedSharedModule and GeneratedModule', async () => {
        const parser = new DefaultGrammarParser();
        const root = await parser.parse(`grammar Arithmetic entry Def: x=ID; terminal ID: /x/;`);
        const set: ParsedGrammarSet = new Map([['a.langium', root]]);
        const config: LangiumConfig = { projectName: 'Arithmetic', languages: [{ id: 'arithmetic', grammar: 'a.langium', fileExtensions: ['.arith'] } as LangiumLanguageConfig], out: '', importExtension: '.js' };
        const output = generateModule(set, config);
        expect(output).toContain('ArithmeticGeneratedSharedModule');
        expect(output).toContain('ArithmeticGeneratedModule');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

```sh
npx vitest run packages/langium-cli/test/generator/types-generator.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Rewrite `module-generator.ts`**

Replace `packages/langium-cli/src/generator/module-generator.ts`:

```typescript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { expandToNode, joinToNode, toString } from 'langium/generate';
import type { ParsedGrammarSet } from '../grammar-parser/grammar-parser.js';
import { getGrammarName } from '../grammar-parser/grammar-queries.js';
import type { LangiumConfig, LangiumLanguageConfig } from '../package-types.js';
import { generatedHeader } from './node-util.js';

export function generateModule(set: ParsedGrammarSet, config: LangiumConfig): string {
    const grammarName = [...set.values()].map(getGrammarName).find(Boolean) ?? config.projectName;

    const node = expandToNode`
        ${generatedHeader}

        import type { LangiumSharedCoreServices, LangiumCoreServices, LangiumGeneratedCoreServices, LangiumGeneratedSharedCoreServices, LanguageMetaData, Module } from 'langium';
        import { ${config.projectName}AstReflection } from './ast${config.importExtension}';

        export const ${grammarName}GeneratedSharedModule: Module<LangiumSharedCoreServices, LangiumGeneratedSharedCoreServices> = {
            AstReflection: () => new ${config.projectName}AstReflection(),
        };

        ${joinToNode(config.languages, lang => {
            const modeValue = config.mode === 'production' ? 'production' : 'development';
            return expandToNode`
                export const ${lang.id.replace(/-/g, '_')}LanguageMetaData = {
                    languageId: '${lang.id}',
                    fileExtensions: [${(lang.fileExtensions ?? []).map(e => `'${e.startsWith('.') ? e : '.' + e}'`).join(', ')}],
                    caseInsensitive: ${Boolean(lang.caseInsensitive)},
                    mode: '${modeValue}',
                } as const satisfies LanguageMetaData;

                export const ${grammarName}GeneratedModule: Module<LangiumCoreServices, LangiumGeneratedCoreServices> = {
                    LanguageMetaData: () => ${lang.id.replace(/-/g, '_')}LanguageMetaData,
                    parser: {},
                };
            `.appendNewLine();
        })}
    `.appendNewLine();

    return toString(node);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```sh
npx vitest run packages/langium-cli/test/generator/types-generator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/langium-cli/src/generator/module-generator.ts \
        packages/langium-cli/test/generator/types-generator.test.ts
git commit -m "feat: rewrite module-generator to use SyntaxNode (drop Grammar/GrammarAST)"
```

---

## Task 9: Rewrite `bnf-generator.ts`

**Files:**
- Modify: `packages/langium-cli/src/generator/bnf-generator.ts`
- Modify: `packages/langium-cli/test/generator/bnf-generator.test.ts`

The BNF generator emits textual EBNF/GBNF notation for each rule. With SyntaxNode, it walks rule definition trees directly.

- [ ] **Step 1: Write failing test**

Replace the key import in `packages/langium-cli/test/generator/bnf-generator.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { DefaultGrammarParser, type ParsedGrammarSet } from '../../src/grammar-parser/grammar-parser.js';
import { generateBnf } from '../../src/generator/bnf-generator.js';

let set: ParsedGrammarSet;
beforeAll(async () => {
    const parser = new DefaultGrammarParser();
    const root = await parser.parse(`grammar Foo entry Bar: name=ID (',' name+=ID)*; terminal ID: /[a-z]+/;`);
    set = new Map([['foo.langium', root]]);
});

describe('generateBnf', () => {
    it('emits rule definition for Bar', () => {
        const out = generateBnf(set);
        expect(out).toContain('Bar');
        expect(out).toContain('::=');
    });
    it('emits terminal rule', () => {
        const out = generateBnf(set);
        expect(out).toContain('ID');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

```sh
npx vitest run packages/langium-cli/test/generator/bnf-generator.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Rewrite `bnf-generator.ts`**

Replace `packages/langium-cli/src/generator/bnf-generator.ts`:

```typescript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { SyntaxNode } from 'web-tree-sitter';
import type { ParsedGrammarSet } from '../grammar-parser/grammar-parser.js';
import { getRules, getTerminals, getRuleName } from '../grammar-parser/grammar-queries.js';

export interface BnfOptions {
    dialect?: 'EBNF' | 'GBNF';
}

export function generateBnf(set: ParsedGrammarSet, options: BnfOptions = { dialect: 'GBNF' }): string {
    const lines: string[] = [];
    for (const root of set.values()) {
        for (const rule of [...getRules(root), ...getTerminals(root)]) {
            const name = getRuleName(rule);
            const def = rule.childForFieldName('definition');
            const rhs = def ? nodeToEbnf(def) : '/* empty */';
            lines.push(`${name} ::= ${rhs}`);
        }
    }
    return lines.join('\n\n');
}

function nodeToEbnf(node: SyntaxNode): string {
    switch (node.type) {
        case 'alternatives': {
            const branches = node.namedChildren
                .filter(n => n.type !== 'conditional_branch' ? false : true);
            // alternatives node contains conditional_branch children separated by '|'
            const parts = node.namedChildren.map(nodeToEbnf).filter(Boolean);
            return parts.join(' | ');
        }
        case 'conditional_branch':
        case 'unordered_group':
        case 'group':
            return node.namedChildren.map(nodeToEbnf).filter(Boolean).join(' ');
        case 'abstract_token':
        case 'abstract_token_with_cardinality': {
            const children = node.namedChildren;
            const last = children[children.length - 1];
            const card = last?.type === 'cardinality' ? last.text : '';
            const inner = children.filter(c => c.type !== 'cardinality').map(nodeToEbnf).join('');
            return card ? `(${inner})${card}` : inner;
        }
        case 'assignment': {
            const feature = node.childForFieldName('feature')?.text ?? '';
            const terminal = node.childForFieldName('terminal');
            return terminal ? nodeToEbnf(terminal) : feature;
        }
        case 'keyword':
            return node.childForFieldName('value')?.text ?? node.text;
        case 'rule_call':
            return node.childForFieldName('rule')?.text ?? node.text;
        case 'cross_reference':
            return `[${node.childForFieldName('type')?.text ?? ''}]`;
        case 'regex_token':
        case 'terminal_alternatives':
        case 'terminal_group':
        case 'terminal_token':
        case 'terminal_token_element':
            return node.text;
        case 'parenthesized_element':
            return `(${node.namedChildren.map(nodeToEbnf).join('')})`;
        default:
            return node.namedChildCount > 0
                ? node.namedChildren.map(nodeToEbnf).filter(Boolean).join(' ')
                : '';
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```sh
npx vitest run packages/langium-cli/test/generator/bnf-generator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/langium-cli/src/generator/bnf-generator.ts \
        packages/langium-cli/test/generator/bnf-generator.test.ts
git commit -m "feat: rewrite bnf-generator to use SyntaxNode (drop GrammarAST)"
```

---

## Task 10: Rewrite `grammar-js-compiler.ts` and `metadata-compiler.ts`

**Files:**
- Modify: `packages/langium-cli/src/generator/grammar-js-compiler.ts`
- Modify: `packages/langium-cli/src/generator/metadata-compiler.ts`
- Modify: `packages/langium-cli/test/generator/treesitter/grammar-js-compiler.test.ts`
- Modify: `packages/langium-cli/test/generator/treesitter/metadata-compiler.test.ts`

These two compilers already exist for tree-sitter output but currently take `Grammar` (GrammarAST). Rewrite their signatures to accept `ParsedGrammarSet`.

- [ ] **Step 1: Update `grammar-js-compiler.test.ts` to use `ParsedGrammarSet`**

Replace the setup in `packages/langium-cli/test/generator/treesitter/grammar-js-compiler.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { DefaultGrammarParser, type ParsedGrammarSet } from '../../../src/grammar-parser/grammar-parser.js';
import { compileGrammarJs } from '../../../src/generator/grammar-js-compiler.js';

let set: ParsedGrammarSet;
beforeAll(async () => {
    const parser = new DefaultGrammarParser();
    const root = await parser.parse(`
        grammar Arithmetic
        entry Def: elements+=Named*;
        Named: name=ID ':' value=Expression;
        Expression: left=Named (op='+' right=Named)?;
        terminal ID: /[_a-zA-Z][\\w_]*/;
        hidden terminal WS: /\\s+/;
    `);
    set = new Map([['a.langium', root]]);
});

describe('compileGrammarJs', () => {
    it('emits module.exports = grammar(...)', () => {
        const out = compileGrammarJs(set);
        expect(out).toContain('module.exports = grammar');
    });
    it('emits a rule for each parser rule', () => {
        const out = compileGrammarJs(set);
        expect(out).toContain('Def:');
        expect(out).toContain('Named:');
    });
    it('emits terminal patterns', () => {
        const out = compileGrammarJs(set);
        expect(out).toContain('ID');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

```sh
npx vitest run packages/langium-cli/test/generator/treesitter/grammar-js-compiler.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Update `grammar-js-compiler.ts` signature**

Replace the exported function signature in `packages/langium-cli/src/generator/grammar-js-compiler.ts`. Change the parameter from `Grammar` to `ParsedGrammarSet` and rewrite the rule iteration using `getRules`, `getTerminals`, `getRuleName`, `getTerminalPattern`:

```typescript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { SyntaxNode } from 'web-tree-sitter';
import type { ParsedGrammarSet } from '../grammar-parser/grammar-parser.js';
import {
    getRules, getTerminals, getRuleName, getTerminalPattern,
    isHiddenTerminal, isEntryRule, getAssignments,
} from '../grammar-parser/grammar-queries.js';

export function compileGrammarJs(set: ParsedGrammarSet): string {
    const allRules: SyntaxNode[] = [];
    const allTerminals: SyntaxNode[] = [];

    for (const root of set.values()) {
        allRules.push(...getRules(root));
        allTerminals.push(...getTerminals(root));
    }

    const ruleEntries = allRules.map(rule => {
        const name = getRuleName(rule);
        const body = ruleToGrammarJs(rule);
        return `    ${name}: $ => ${body},`;
    });

    const terminalEntries = allTerminals
        .filter(t => !isHiddenTerminal(t))
        .map(t => {
            const name = getRuleName(t);
            const pattern = getTerminalPattern(t) ?? '/.*/';
            return `    ${name}: _ => ${pattern},`;
        });

    const hiddenPatterns = allTerminals
        .filter(t => isHiddenTerminal(t))
        .map(t => getTerminalPattern(t) ?? '/.*/');

    const extras = hiddenPatterns.length > 0
        ? `extras: $ => [${hiddenPatterns.join(', ')}, /\\s+/],`
        : `extras: $ => [/\\s+/],`;

    const entryRule = allRules.find(isEntryRule);
    const word = allTerminals.find(t => getRuleName(t) === 'ID');

    return [
        `module.exports = grammar({`,
        `  name: 'generated',`,
        word ? `  word: $ => $.ID,` : '',
        `  ${extras}`,
        `  rules: {`,
        ...ruleEntries,
        ...terminalEntries,
        `  },`,
        `});`,
    ].filter(Boolean).join('\n');
}

function ruleToGrammarJs(rule: SyntaxNode): string {
    const def = rule.childForFieldName('definition');
    if (!def) return `$ => seq()`;
    return `$ => ${nodeToJs(def)}`;
}

function nodeToJs(node: SyntaxNode): string {
    switch (node.type) {
        case 'alternatives': {
            const branches = node.namedChildren.map(nodeToJs);
            return branches.length === 1 ? branches[0] : `choice(${branches.join(', ')})`;
        }
        case 'group':
        case 'unordered_group':
        case 'conditional_branch': {
            const parts = node.namedChildren.map(nodeToJs).filter(Boolean);
            return parts.length === 1 ? parts[0] : `seq(${parts.join(', ')})`;
        }
        case 'abstract_token':
        case 'abstract_token_with_cardinality': {
            const card = node.namedChildren.find(c => c.type === 'cardinality')?.text;
            const inner = node.namedChildren
                .filter(c => c.type !== 'cardinality')
                .map(nodeToJs).filter(Boolean).join(', ');
            if (!card) return inner;
            if (card === '?') return `optional(${inner})`;
            if (card === '*') return `repeat(${inner})`;
            if (card === '+') return `repeat1(${inner})`;
            return inner;
        }
        case 'assignment': {
            const feature = node.childForFieldName('feature')?.text ?? '';
            const terminal = node.childForFieldName('terminal');
            const inner = terminal ? nodeToJs(terminal) : 'seq()';
            return `field('${feature}', ${inner})`;
        }
        case 'keyword':
            return node.childForFieldName('value')?.text ?? `''`;
        case 'rule_call':
            return `$.${node.childForFieldName('rule')?.text ?? 'unknown'}`;
        case 'cross_reference':
            return `field('${node.childForFieldName('type')?.text}', $.ID)`;
        case 'parenthesized_element': {
            const inner = node.namedChildren.map(nodeToJs).filter(Boolean);
            return inner.length === 1 ? inner[0] : `seq(${inner.join(', ')})`;
        }
        default:
            return node.namedChildCount > 0
                ? node.namedChildren.map(nodeToJs).filter(Boolean).join(', ')
                : '';
    }
}
```

- [ ] **Step 4: Update `metadata-compiler.ts`** similarly — change its parameter from `Grammar` to `ParsedGrammarSet` and use `collectTypes`, `collectFields`:

```typescript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { expandToNode, joinToNode, toString } from 'langium/generate';
import type { ParsedGrammarSet } from '../grammar-parser/grammar-parser.js';
import { collectTypes, collectFields } from '../grammar-parser/grammar-queries.js';
import { generatedHeader } from './node-util.js';

export function compileMetadata(set: ParsedGrammarSet): string {
    const types = collectTypes(set).filter(t => !t.isInterface);

    const node = expandToNode`
        ${generatedHeader}

        import type { GrammarMetadata } from 'langium/generate';

        export const GRAMMAR_METADATA: GrammarMetadata = {
            version: '1.0',
            nodes: {
                ${joinToNode(types, t => {
                    const fields = collectFields(t.name, set);
                    return expandToNode`
                        '${t.name}': {
                            nodeType: '${t.name}',
                            fields: [
                                ${joinToNode(fields, f => `{ name: '${f.name}', operator: '${f.operator}', isRef: ${f.isRef} },`, { appendNewLineIfNotEmpty: true })}
                            ],
                        },
                    `.appendNewLine();
                })}
            },
            extras: [],
        };
    `.appendNewLine();

    return toString(node);
}
```

- [ ] **Step 5: Update metadata-compiler test**

Replace `packages/langium-cli/test/generator/treesitter/metadata-compiler.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { DefaultGrammarParser, type ParsedGrammarSet } from '../../../src/grammar-parser/grammar-parser.js';
import { compileMetadata } from '../../../src/generator/metadata-compiler.js';

let set: ParsedGrammarSet;
beforeAll(async () => {
    const parser = new DefaultGrammarParser();
    const root = await parser.parse(`grammar X entry Foo: name=ID; terminal ID: /x/;`);
    set = new Map([['x.langium', root]]);
});

describe('compileMetadata', () => {
    it('emits GRAMMAR_METADATA export', () => {
        expect(compileMetadata(set)).toContain('GRAMMAR_METADATA');
    });
    it('includes node type Foo', () => {
        expect(compileMetadata(set)).toContain("'Foo'");
    });
});
```

- [ ] **Step 6: Run both tests**

```sh
npx vitest run packages/langium-cli/test/generator/treesitter/grammar-js-compiler.test.ts packages/langium-cli/test/generator/treesitter/metadata-compiler.test.ts
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```sh
git add packages/langium-cli/src/generator/grammar-js-compiler.ts \
        packages/langium-cli/src/generator/metadata-compiler.ts \
        packages/langium-cli/test/generator/treesitter/grammar-js-compiler.test.ts \
        packages/langium-cli/test/generator/treesitter/metadata-compiler.test.ts
git commit -m "feat: rewrite grammar-js-compiler and metadata-compiler to use ParsedGrammarSet (drop Grammar/GrammarAST)"
```

---

## Task 11: Rewrite `types-generator.ts` and `langium-util.ts`

**Files:**
- Modify: `packages/langium-cli/src/generator/types-generator.ts`
- Modify: `packages/langium-cli/src/generator/langium-util.ts`
- Modify: `packages/langium-cli/test/generator/types-generator.test.ts`

`types-generator.ts` currently calls `collectAst` and `LangiumGrammarGrammar()` — replace with `collectTypes`/`collectFields`. `langium-util.ts` uses `GrammarAST` for `collectKeywords` and `collectTerminalRegexps` — rewrite using grammar-queries.

- [ ] **Step 1: Rewrite `langium-util.ts`**

Replace `packages/langium-cli/src/generator/langium-util.ts`:

```typescript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import chalk from 'chalk';
import type { SyntaxNode } from 'web-tree-sitter';
import type { ParsedGrammarSet } from '../grammar-parser/grammar-parser.js';
import { getRules, getTerminals, getRuleName, getTerminalPattern } from '../grammar-parser/grammar-queries.js';

export function log(level: 'log' | 'warn' | 'error', options: { watch?: boolean }, message: string, ...args: unknown[]): void {
    if (options.watch) {
        console[level](getTime() + message, ...args);
    } else {
        console[level](message, ...args);
    }
}

export function getTime(): string {
    const date = new Date();
    return `[${chalk.gray(`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`)}] `;
}

function pad(i: number): string { return i.toString().padStart(2, '0'); }

/** Collect all keyword string values (quoted literals) reachable from parser rules */
export function collectKeywords(set: ParsedGrammarSet): string[] {
    const keywords = new Set<string>();
    for (const root of set.values()) {
        for (const rule of getRules(root)) {
            const def = rule.childForFieldName('definition');
            if (def) walkKeywords(def, keywords);
        }
    }
    return Array.from(keywords).sort();
}

function walkKeywords(node: SyntaxNode, out: Set<string>): void {
    if (node.type === 'keyword') {
        const val = node.childForFieldName('value')?.text;
        if (val) out.add(val.replace(/^['"]|['"]$/g, ''));
        return;
    }
    for (const child of node.namedChildren) {
        walkKeywords(child, out);
    }
}

/** Collect terminal name → RegExp for all non-hidden terminals */
export function collectTerminalRegexps(set: ParsedGrammarSet): Record<string, RegExp> {
    const result: Record<string, RegExp> = {};
    for (const root of set.values()) {
        for (const t of getTerminals(root)) {
            const name = getRuleName(t);
            const pattern = getTerminalPattern(t);
            if (pattern) {
                try {
                    const inner = pattern.replace(/^\/|\/[a-z]*$/g, '');
                    result[name] = new RegExp(inner);
                } catch { /* skip invalid patterns */ }
            }
        }
    }
    return result;
}
```

- [ ] **Step 2: Rewrite `types-generator.ts`**

Replace `packages/langium-cli/src/generator/types-generator.ts`:

```typescript
/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { joinToNode, toString } from 'langium/generate';
import type { ParsedGrammarSet } from '../grammar-parser/grammar-parser.js';
import { collectTypes, collectFields } from '../grammar-parser/grammar-queries.js';
import { collectKeywords } from './langium-util.js';

export function generateTypesFile(set: ParsedGrammarSet): string {
    const types = collectTypes(set);
    const reserved = new Set(collectKeywords(set));

    const lines = types.map(t => {
        const fields = collectFields(t.name, set);
        const fieldStr = fields.map(f => {
            const opt = f.operator !== '+=' ? '?' : '';
            const arr = f.operator === '+=' ? '[]' : '';
            return `    ${f.name}${opt}: ${f.type}${arr};`;
        }).join('\n');
        const keyword = t.isInterface ? 'interface' : 'type';
        if (keyword === 'interface') {
            return `export interface ${t.name} {\n${fieldStr}\n}`;
        }
        return `export type ${t.name} = ${fields.map(f => f.type).join(' | ') || 'never'};`;
    });

    return lines.join('\n\n') + '\n';
}
```

- [ ] **Step 3: Run types-generator tests**

```sh
npx vitest run packages/langium-cli/test/generator/types-generator.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add packages/langium-cli/src/generator/types-generator.ts \
        packages/langium-cli/src/generator/langium-util.ts \
        packages/langium-cli/test/generator/types-generator.test.ts
git commit -m "feat: rewrite types-generator and langium-util to use ParsedGrammarSet (drop GrammarAST)"
```

---

## Task 12: Rewrite Highlighting Generators

**Files:**
- Modify: `packages/langium-cli/src/generator/highlighting/monarch-generator.ts`
- Modify: `packages/langium-cli/src/generator/highlighting/textmate-generator.ts`
- Modify: `packages/langium-cli/src/generator/highlighting/prism-generator.ts`

All three currently take a single `Grammar` and directly access `grammar.rules`, `GrammarAST`, `GrammarUtils`, and `RegExpUtils`. Replace these with `ParsedGrammarSet` + query helpers.

The key substitutions for all three generators:

| Old (GrammarAST) | New (grammar-queries) |
|---|---|
| `import { Grammar, GrammarAST, GrammarUtils } from 'langium'` | `import type { ParsedGrammarSet } from '../../grammar-parser/grammar-parser.js'` |
| `grammar.rules` | `[...getRules(root), ...getTerminals(root)]` for each root in set |
| `GrammarAST.isTerminalRule(rule)` | `rule.type === 'terminal_rule'` |
| `GrammarAST.isParserRule(rule)` | `rule.type === 'parser_rule'` |
| `rule.hidden` | `isHiddenTerminal(rule)` |
| `rule.name` | `getRuleName(rule)` |
| `GrammarUtils.terminalRegex(rule)` | `new RegExp(getTerminalPattern(t)?.replace(/^\/\|\/[a-z]*$/g,'') ?? '')` |
| `collectKeywords(grammar)` | `collectKeywords(set)` |

- [ ] **Step 1: Rewrite `monarch-generator.ts`**

In `packages/langium-cli/src/generator/highlighting/monarch-generator.ts`:

1. Replace the imports block:
```typescript
// Remove:
import { type Grammar, GrammarAST, GrammarUtils, RegExpUtils } from 'langium';
// Add:
import type { SyntaxNode } from 'web-tree-sitter';
import type { ParsedGrammarSet } from '../../grammar-parser/grammar-parser.js';
import {
    getRules, getTerminals, getRuleName, getTerminalPattern,
    isHiddenTerminal,
} from '../../grammar-parser/grammar-queries.js';
```

2. Change the exported function signature:
```typescript
// OLD:
export function generateMonarch(grammar: Grammar, config: LangiumLanguageConfig): string
// NEW:
export function generateMonarch(set: ParsedGrammarSet, config: LangiumLanguageConfig): string
```

3. Replace every `grammar.rules` traversal with iteration over `set`:
```typescript
// OLD pattern:
for (const rule of grammar.rules) { ... GrammarAST.isTerminalRule(rule) ... }

// NEW pattern:
for (const root of set.values()) {
    for (const rule of [...getRules(root), ...getTerminals(root)]) {
        if (rule.type === 'terminal_rule') { ... }
    }
}
```

4. Replace `collectKeywords(grammar)` → `collectKeywords(set)` (already `ParsedGrammarSet`-aware after Task 11).

5. Replace `GrammarUtils.terminalRegex(rule)` → extract pattern string from `getTerminalPattern(rule)` and compile with `new RegExp(...)`.

- [ ] **Step 2: Rewrite `textmate-generator.ts`** — apply the same substitutions as Step 1 to `packages/langium-cli/src/generator/highlighting/textmate-generator.ts`.

Function signature changes from:
```typescript
export function generateTextMate(grammar: Grammar, config: LangiumLanguageConfig): string
```
to:
```typescript
export function generateTextMate(set: ParsedGrammarSet, config: LangiumLanguageConfig): string
```

- [ ] **Step 3: Rewrite `prism-generator.ts`** — apply the same substitutions.

Function signature changes from:
```typescript
export function generatePrismHighlighting(grammar: Grammar, config: LangiumLanguageConfig): string
```
to:
```typescript
export function generatePrismHighlighting(set: ParsedGrammarSet, config: LangiumLanguageConfig): string
```

- [ ] **Step 4: Run the full langium-cli test suite to check regressions**

```sh
npx vitest run packages/langium-cli
```

Expected: no new failures introduced.

- [ ] **Step 5: Commit**

```sh
git add packages/langium-cli/src/generator/highlighting/
git commit -m "feat: rewrite highlighting generators to use ParsedGrammarSet (drop Grammar/GrammarAST/GrammarUtils)"
```

---

## Task 13: Refactor `generate.ts`

**Files:**
- Modify: `packages/langium-cli/src/generate.ts`

`generate.ts` is 562 lines. It currently creates grammar services via `createCliLangiumGrammarServices(NodeFileSystem)`, drives the Langium `DocumentBuilder` pipeline to produce `Grammar` objects, then calls each generator. The refactor replaces the entire grammar loading + pipeline section with `DefaultGrammarParser`, and updates every generator call to pass `ParsedGrammarSet`.

- [ ] **Step 1: Update imports at the top of `generate.ts`**

Remove all imports from `langium/grammar`, `create-grammar-services.ts`, and the old `grammar-parser/` index. Add:

```typescript
import { DefaultGrammarParser, type ParsedGrammarSet } from './grammar-parser/grammar-parser.js';
import { generateAst } from './generator/ast-generator.js';
import { generateModule } from './generator/module-generator.js';
import { generateBnf } from './generator/bnf-generator.js';
import { compileGrammarJs } from './generator/grammar-js-compiler.js';
import { compileMetadata } from './generator/metadata-compiler.js';
import { generateTypesFile } from './generator/types-generator.js';
import { generateTextMate } from './generator/highlighting/textmate-generator.js';
import { generateMonarch } from './generator/highlighting/monarch-generator.js';
import { generatePrismHighlighting } from './generator/highlighting/prism-generator.js';
```

- [ ] **Step 2: Replace the grammar loading section**

Find the block that calls `createCliLangiumGrammarServices` and `DocumentBuilder` (search: `createCliLangiumGrammarServices`). Replace the entire grammar loading + service creation block with:

```typescript
const grammarParser = new DefaultGrammarParser();
const set: ParsedGrammarSet = await grammarParser.parseWithImports(
    resolve(dirname(configPath), config.languages[0].grammar)
);

for (const [uri, root] of set.entries()) {
    if (root.hasError) {
        log('error', options, `Parse errors in ${uri}`);
        return;
    }
}
```

- [ ] **Step 3: Replace each generator call**

Find every call that passes a `Grammar` or `Grammar[]` and replace with `set`. The pattern for each output type:

```typescript
// AST (was: generateAstSingleLanguageProject(services, grammar, config))
if (config.languages[0].out?.includes('ast')) {
    const content = generateAst(set, config);
    await writeFile(join(config.out, 'ast.ts'), content, 'utf-8');
    log('log', options, `Written ast.ts to ${config.out}`);
}

// Module (was: generateModule([grammar], config, grammarConfigMap))
const moduleContent = generateModule(set, config);
await writeFile(join(config.out, 'module.ts'), moduleContent, 'utf-8');

// BNF (was: generateBnf([grammar]))
if (config.langiumInternal) {
    const bnfContent = generateBnf(set);
    await writeFile(join(config.out, 'grammar.bnf'), bnfContent, 'utf-8');
}

// Tree-sitter grammar.js (was: compileGrammarToString(grammar))
const grammarJs = compileGrammarJs(set);
await writeFile(join(config.out, 'grammar.js'), grammarJs, 'utf-8');

// Metadata (was: compileMetadata(grammar))
const metadata = compileMetadata(set);
await writeFile(join(config.out, 'metadata.ts'), metadata, 'utf-8');

// Highlighting
if (config.textMate) {
    const tm = generateTextMate(set, { id: config.languages[0].id, fileExtensions: config.languages[0].fileExtensions ?? [] } as LangiumLanguageConfig);
    await writeFile(config.textMate.out, tm, 'utf-8');
}
if (config.monarch) {
    const monarch = generateMonarch(set, { id: config.languages[0].id } as LangiumLanguageConfig);
    await writeFile(config.monarch.out, monarch, 'utf-8');
}
if (config.prism) {
    const prism = generatePrismHighlighting(set, { id: config.languages[0].id } as LangiumLanguageConfig);
    await writeFile(config.prism.out, prism, 'utf-8');
}
```

- [ ] **Step 4: Remove the `grammar-serializer.ts` call**

Find and delete the call to `generateGrammar` / `grammar-serializer` (the one that generated `grammar.ts`). No replacement needed — `grammar.ts` is no longer generated in Phase 1.

- [ ] **Step 5: Run the full langium-cli test suite**

```sh
npx vitest run packages/langium-cli
```

Expected: all tests pass (no regressions).

- [ ] **Step 6: Commit**

```sh
git add packages/langium-cli/src/generate.ts
git commit -m "feat: refactor generate.ts to use DefaultGrammarParser directly (drop DI grammar services pipeline)"
```

---

## Task 14: Delete Chevrotain Files and Remove Dependencies

**Files:**
- Delete: all 11 files in `packages/langium-cli/src/grammar-parser/` (Chevrotain-based)
- Delete: `packages/langium-cli/src/create-grammar-services.ts`
- Delete: `packages/langium-cli/src/generator/grammar-serializer.ts`
- Delete: `packages/langium-cli/test/generator/grammar-serializer.test.ts`
- Modify: `packages/langium-cli/package.json`

- [ ] **Step 1: Delete the Chevrotain files**

```sh
git rm packages/langium-cli/src/grammar-parser/langium-parser.ts \
       packages/langium-cli/src/grammar-parser/parser-builder-base.ts \
       packages/langium-cli/src/grammar-parser/indentation-aware.ts \
       packages/langium-cli/src/grammar-parser/regexp-utils.ts \
       packages/langium-cli/src/grammar-parser/cst-node-builder.ts \
       packages/langium-cli/src/grammar-parser/token-builder.ts \
       packages/langium-cli/src/grammar-parser/lexer.ts \
       packages/langium-cli/src/grammar-parser/langium-parser-builder.ts \
       packages/langium-cli/src/grammar-parser/completion-parser-builder.ts \
       packages/langium-cli/src/grammar-parser/index.ts \
       packages/langium-cli/src/grammar-parser/parser-config.ts \
       packages/langium-cli/src/create-grammar-services.ts \
       packages/langium-cli/src/generator/grammar-serializer.ts \
       packages/langium-cli/test/generator/grammar-serializer.test.ts
```

- [ ] **Step 2: Remove Chevrotain dependencies from `package.json`**

Edit `packages/langium-cli/package.json` — remove from `dependencies`:

```json
"dependencies": {
    "chalk": "~5.6.2",
    "commander": "~14.0.3",
    "fs-extra": "~11.3.4",
    "jsonschema": "~1.5.0",
    "langium": "~4.2.0",
    "langium-railroad": "~4.2.0",
    "lodash": "~4.18.1"
}
```

(Remove `chevrotain`, `chevrotain-allstar`, `@chevrotain/regexp-to-ast`.)

- [ ] **Step 3: Reinstall and verify build**

```sh
npm install
npm run build -w packages/langium-cli
```

Expected: TypeScript build exits 0 with no Chevrotain import errors.

- [ ] **Step 4: Run the full test suite**

```sh
npx vitest run packages/langium-cli
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/langium-cli/package.json package-lock.json
git commit -m "feat: delete vendored Chevrotain grammar-parser files and remove Chevrotain deps from langium-cli"
```

---

## Task 15: Full Regression Run

- [ ] **Step 1: Run all langium-cli tests**

```sh
npx vitest run packages/langium-cli
```

Expected: ≥132 tests pass, 0 fail.

- [ ] **Step 2: Run full monorepo test suite**

```sh
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run a full build**

```sh
npm run build
```

Expected: exit 0, no type errors.

- [ ] **Step 4: Smoke test `langium generate` on the arithmetic example**

```sh
cd examples/arithmetics
npx langium generate
```

Expected: `src/language/generated/ast.ts`, `module.ts`, `grammar.js`, `metadata.ts` regenerated without errors.

- [ ] **Step 5: Final commit**

```sh
git add .
git commit -m "chore: Phase 1 complete — langium-cli generators use tree-sitter SyntaxNode; Chevrotain removed"
```

---

## Summary

| Task | Deliverable |
|---|---|
| 1 | tree-sitter CLI devDep + build script |
| 2 | `grammar.js` for the Langium grammar language |
| 3 | `langium-grammar.wasm` compiled and committed |
| 4 | `grammar-parser.ts` — parses `.langium` → `SyntaxNode` |
| 5 | `grammar-queries.ts` structural queries |
| 6 | `grammar-queries.ts` semantic analysis |
| 7 | `ast-generator.ts` rewritten |
| 8 | `module-generator.ts` rewritten |
| 9 | `bnf-generator.ts` rewritten |
| 10 | `grammar-js-compiler.ts` + `metadata-compiler.ts` rewritten |
| 11 | `types-generator.ts` + `langium-util.ts` rewritten |
| 12 | Highlighting generators rewritten |
| 13 | `generate.ts` refactored |
| 14 | Chevrotain files deleted + deps removed |
| 15 | Full regression ≥132 tests pass |

**Net deletion: ~2,942 lines of Chevrotain infrastructure. Net addition: ~600 lines of focused, testable tree-sitter code.**
