/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

/**
 * Versioned, language-agnostic description of a tree-sitter grammar consumed by
 * Langium's runtime services (in particular the runtime index builder and the
 * LSP adapters). The shape is stable across Langium versions; new optional
 * fields may be added but existing fields are not removed or repurposed.
 *
 * Compilers (such as `langium generate`) emit a `GrammarMetadata` constant
 * alongside the generated `grammar.js` / `grammar.wasm` artifacts. Runtime
 * consumers read this metadata to map tree-sitter `SyntaxNode` types to
 * Langium AST types, to recognise cross-reference fields, and to find the
 * grammar's word and extras terminals.
 */
export interface GrammarMetadata {
    /**
     * Schema version of the metadata format itself (not the grammar's
     * version). Bumped whenever the GrammarMetadata shape changes in a way
     * that requires consumers to adapt.
     */
    version: string;
    /**
     * Map from tree-sitter node type (the value of `SyntaxNode.type`) to the
     * Langium-level metadata describing that node — its fields, whether it is
     * an action node, etc.
     */
    nodes: Record<string, NodeMetadata>;
    /**
     * Names of terminal rules emitted in the tree-sitter grammar's `extras`
     * array (typically whitespace and comments). Listed by tree-sitter type
     * name, e.g. `"WS"`, `"ML_COMMENT"`, `"SL_COMMENT"`.
     */
    extras: string[];
    /**
     * Tree-sitter type name of the terminal annotated with `@word` in the
     * source grammar (used for keyword/identifier disambiguation), if any.
     */
    word?: string;
}

/**
 * Metadata for a single tree-sitter node type.
 */
export interface NodeMetadata {
    /**
     * Tree-sitter node type name. Matches the key under which this entry is
     * registered in {@link GrammarMetadata.nodes}.
     */
    nodeType: string;
    /**
     * Field assignments declared on this node, in source order.
     */
    fields: FieldMetadata[];
    /**
     * `true` when this node represents a Langium grammar action
     * (e.g. `{infer Foo}` or `{Foo.field=current}`) rather than a plain
     * parser rule.
     */
    isAction?: boolean;
    /**
     * For action nodes, the inferred or referenced AST type name produced by
     * the action (e.g. the `Foo` in `{infer Foo}`).
     */
    actionType?: string;
}

/**
 * Metadata for a single field assignment within a node.
 */
export interface FieldMetadata {
    /**
     * Field name as written in the Langium grammar (i.e. the LHS of `=`,
     * `+=`, or `?=`).
     */
    name: string;
    /**
     * Assignment operator used in the grammar:
     *  - `'='`  — single-valued assignment
     *  - `'+='` — list append
     *  - `'?='` — boolean flag (presence implies `true`)
     */
    operator: '=' | '+=' | '?=';
    /**
     * `true` when the field is a cross-reference assignment (i.e. the
     * grammar wrote `[Type:Rule]` or `[Type]`). The runtime index builder
     * uses this flag to decide whether to record a `ReferenceInfo` for the
     * child node.
     */
    isRef?: boolean;
}

/**
 * Metadata describing a single cross-reference within a grammar. Currently
 * provided for forward compatibility with future tooling that wants a
 * flattened reference list separate from per-node {@link FieldMetadata}.
 */
export interface ReferenceMetadata {
    /**
     * Tree-sitter node type that contains the cross-reference field.
     */
    sourceNodeType: string;
    /**
     * Name of the field on the source node holding the reference.
     */
    fieldName: string;
    /**
     * AST type name of the declaration target (the `Type` in `[Type:Rule]`).
     */
    targetType: string;
}
