# Performance Improvements for Large Files

Analysis based on the simple-sql example with a 6515-line file (1670 statements, 1336 cross-references).

## Benchmark Results (Lezer backend)

| Phase | Time | Notes |
|-------|------|-------|
| Lezer parse (adapter.parse) | 27ms | Fast — incremental parser |
| AST build (SyntaxNodeAstBuilder) | 168ms | SyntaxNode to AstNode conversion |
| **Full build (no validation)** | **1337ms** | **The bottleneck** |
| Validation | 10ms | Fast |
| Completion | 26ms | Fast |

The "full build" runs 5 phases after parsing: index content, compute local scopes, linking,
index references. Subtracting parse+AST (~195ms), the **post-parsing pipeline takes ~1140ms**.
The Langium profiler shows linking alone at ~508ms.

## Root Causes

### 1. `StreamScope.getElement()` is O(N) per lookup — the #1 bottleneck

In `packages/langium-core/src/references/scope-provider.ts:78`, `createScope()` creates a
`StreamScope`. When the linker resolves each reference, `scope.ts:84` does:

```typescript
// StreamScope.getElement()
this.elements.find(e => e.name === name)  // Linear scan!
```

For the SQL grammar, all 334 `CreateTableStmt` nodes are children of `Program`. Their names are
stored as local symbols at the `Program` level. Every SELECT/INSERT reference triggers a **linear
scan** through up to 334 descriptions to find the matching table name.

**Cost**: 1336 references x ~167 avg comparisons = ~223,000 string comparisons just for scope
lookups.

The `MapScope` class (`scope.ts:107`) exists and does O(1) lookups via `Map.get()`, but the
default `createScope` doesn't use it. The arithmetics example already uses `MapScope` in its
custom scope provider (`examples/arithmetics/src/language-server/arithmetics-scope-provider.ts`).

### 2. `getAstNodePath()` is O(depth) and called ~3000+ times

`packages/langium-core/src/workspace/ast-node-locator.ts:40-48` computes paths by recursively
walking up to the root with string concatenation:

```typescript
getAstNodePath(node: AstNode): string {
    if (node.$container) {
        const containerPath = this.getAstNodePath(node.$container);
        return containerPath + '/' + this.getPathSegment(node);
    }
    return '';
}
```

Called in `createDescription()` (`ast-descriptions.ts:53`) for every named node during both
`collectExportedSymbols` and `collectLocalSymbols`. With ~3000+ named nodes x depth 2-3, that's
~9000 recursive calls with string allocations.

### 3. Four full AST traversals in the pipeline

The pipeline traverses all AST nodes **4 separate times**:

1. `collectExportedSymbols` — direct children of root (`scope-computation.ts:97`)
2. `collectLocalSymbols` — all nodes via `streamAllContents` (`scope-computation.ts:121`)
3. `link()` — all nodes via `streamAst` (`linker.ts:145`)
4. `updateReferences` — all nodes via `streamAst` (`ast-descriptions.ts:122`)

Each traversal visits ~7000+ AST nodes (1670 statements x ~4.2 nodes each).

### 4. `interruptAndCheck()` async overhead

`packages/langium-core/src/utils/promise-utils.ts:72` is called once per AST node in each
traversal. Even with `CancellationToken.None` (early return), it's still an `async` function —
each `await` creates a microtask. With ~7000 nodes x 4 traversals = ~28,000 awaits, this adds
measurable overhead.

### 5. New scope chain created per reference (no caching)

In `scope-provider.ts:51-71`, `getScope()` walks up the container chain and creates a **new
StreamScope chain** for every single reference. Sibling references (e.g., two SELECT statements
at the same level) get identical scopes but never share them.

## Backend comparison: Chevrotain vs Lezer

The document build pipeline (indexing -> scoping -> linking -> reference indexing) is
**backend-agnostic**. It runs identically for both Chevrotain and Lezer. The only difference
is parsing and AST building. The ~1140ms post-parsing overhead would be essentially the same
with Chevrotain.

## Improvement Options

### Option A: Override `createScope()` to use `MapScope` (easiest, biggest win)

Create a custom `ScopeProvider` that uses `MapScope` instead of `StreamScope`:

```typescript
protected createScope(
    elements: Iterable<AstNodeDescription>,
    outerScope?: Scope,
    options?: ScopeOptions
): Scope {
    return new MapScope(elements, outerScope, options);
}
```

Changes scope lookups from O(N) to O(1). Eliminates ~220K string comparisons for 1336
references. **Expected savings: 200-400ms**.

Already demonstrated in the arithmetics example:
`examples/arithmetics/src/language-server/arithmetics-scope-provider.ts`.

### Option B: Cache scopes per container node

Override `getScope()` to cache the computed scope chain by container node. All references at the
same AST depth get identical scopes. With a `WeakMap<AstNode, Map<string, Scope>>` cache, 1336
references would share ~1670 cached scopes instead of creating new ones each time.

### Option C: Change `DefaultScopeProvider.createScope` upstream to use `MapScope`

The real fix: change the default in langium-core. `StreamScope` made sense for lazy evaluation
but is a performance trap for large files. `MapScope` eagerly builds a Map but then gives O(1)
lookups. For any document with >100 named symbols, `MapScope` wins.

### Option D: Cache `getAstNodePath()` results

Compute paths once during AST building or first traversal and cache them on the AstNode (e.g.,
`node.$path`). Avoids repeated recursive path computation in `createDescription()`.

### Option E: Combine traversals

Merge `collectLocalSymbols` + `link` into a single pass, or at minimum merge `link` +
`updateReferences`. Reduces 4 traversals to 2-3.

### Option F: Flat scope optimization for simple grammars

For grammars like SQL where all named declarations are at the top level (children of `Program`),
the scope for every reference is the same. A custom `ScopeProvider` could detect this pattern
and return a single pre-built `MapScope` for all references, making the entire linking phase
essentially O(N) instead of O(N^2).

## Results after implemented changes

Per-phase breakdown (6515 lines, 1670 statements, 1336 cross-refs):

| Phase | Before | After | Speedup |
|-------|--------|-------|---------|
| **Full build (no validation)** | **1380ms** | **70ms** | **~20x** |
| parse (re-parse) | 110ms | 3ms | — |
| indexContent | 836ms | 10ms | 84x |
| computeScopes | 52ms | 48ms | — |
| linking | 508ms | 9ms | 56x |
| indexRefs | ~0ms | ~0ms | — |

Memory impact: ~33 MB delta when opening the large file (442 -> 475 MB in Extension Host).
Our caches add negligibly (~52 KB line index + ~20 KB scope cache). The rest is AST, Lezer
tree, TextDocument mirror, etc.

## Todo

- [x] Option A+B: `SimpleSQLScopeProvider` with `MapScope` + `WeakMap` cache per (container, type)
  - File: `examples/simple-sql/src/language-server/simple-sql-scope-provider.ts`
  - Wired in: `examples/simple-sql/src/language-server/simple-sql-module.ts`
  - Linking: 508ms -> 9ms
- [x] Fix `offsetToPosition` O(N) linear scan in `LezerSyntaxNode`
  - File: `packages/langium-lezer/src/parser/lezer-syntax-node.ts`
  - Added cached line index + binary search (O(log N) per lookup)
  - indexContent: 836ms -> 10ms (was the hidden dominant bottleneck)
- [ ] Option C: Change `DefaultScopeProvider.createScope` upstream to use `MapScope`
  - Would benefit all Langium users, not just simple-sql
- [ ] Option D: Cache `getAstNodePath()` results on AstNode
  - Would further reduce indexContent and computeScopes phases
- [ ] Option E: Combine AST traversals (collectLocalSymbols + link, or link + updateReferences)
  - Would reduce overhead from 4 full AST traversals to 2-3
- [ ] Option F: Flat scope optimization for top-level-only grammars
  - Single pre-built MapScope for all references in flat grammars like SQL

## Recommended next steps

1. **Option C** for all Langium users — change the upstream default from `StreamScope` to `MapScope`.
2. **Option D** as a follow-up for reducing scope computation and indexing time.
3. **Option F** for maximum performance on flat grammars (combine with A+B).
