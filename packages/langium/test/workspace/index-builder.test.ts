/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Node as SyntaxNode } from 'web-tree-sitter';
import { describe, expect, test } from 'vitest';
import { DefaultIndexBuilder } from 'langium';
import { ARITHMETIC_METADATA } from '../fixtures/arithmetic/metadata.js';

interface MockNodeSpec {
    type: string;
    text?: string;
    startPosition?: { row: number, column: number };
    endPosition?: { row: number, column: number };
    fields?: Record<string, MockNodeSpec>;
    children?: MockNodeSpec[];
}

function mockNode(spec: MockNodeSpec): SyntaxNode {
    const fieldEntries = Object.entries(spec.fields ?? {});
    const fieldChildren = fieldEntries.map(([, childSpec]) => mockNode(childSpec));
    const namedChildren = (spec.children ?? []).map(child => mockNode(child));
    const children = [...fieldChildren, ...namedChildren];
    const fieldByName = new Map<string, SyntaxNode>();
    fieldEntries.forEach(([name], i) => fieldByName.set(name, fieldChildren[i]));
    const node = {
        type: spec.type,
        text: spec.text ?? '',
        startPosition: spec.startPosition ?? { row: 0, column: 0 },
        endPosition: spec.endPosition ?? { row: 0, column: 0 },
        children,
        childForFieldName(name: string): SyntaxNode | null {
            return fieldByName.get(name) ?? null;
        }
    };
    return node as unknown as SyntaxNode;
}

describe('DefaultIndexBuilder declarations walk', () => {

    const builder = new DefaultIndexBuilder();
    const uri = 'file:///test.arith';

    test('records a single Definition as a declaration keyed by its name', () => {
        const root = mockNode({
            type: 'source_file',
            children: [
                {
                    type: 'Definition',
                    fields: {
                        name: {
                            type: 'ID',
                            text: 'x',
                            startPosition: { row: 0, column: 4 },
                            endPosition: { row: 0, column: 5 }
                        },
                        expr: {
                            type: 'NumberLiteral',
                            fields: {
                                value: { type: 'Number', text: '5' }
                            }
                        }
                    }
                }
            ]
        });

        const index = builder.build(root, ARITHMETIC_METADATA, uri);

        expect(index.declarations.size).toBe(1);
        const decls = index.declarations.get('x');
        expect(decls).toHaveLength(1);
        const [decl] = decls!;
        expect(decl.name).toBe('x');
        expect(decl.nodeType).toBe('Definition');
        expect(decl.range).toEqual({
            start: { line: 0, character: 4 },
            end: { line: 0, character: 5 }
        });
        expect(decl.uri.toString()).toBe(uri);
    });

    test('groups multiple declarations under the same name', () => {
        const root = mockNode({
            type: 'source_file',
            children: [
                {
                    type: 'Definition',
                    fields: {
                        name: { type: 'ID', text: 'foo', startPosition: { row: 0, column: 4 }, endPosition: { row: 0, column: 7 } },
                        expr: { type: 'NumberLiteral', fields: { value: { type: 'Number', text: '1' } } }
                    }
                },
                {
                    type: 'Definition',
                    fields: {
                        name: { type: 'ID', text: 'foo', startPosition: { row: 1, column: 4 }, endPosition: { row: 1, column: 7 } },
                        expr: { type: 'NumberLiteral', fields: { value: { type: 'Number', text: '2' } } }
                    }
                }
            ]
        });

        const index = builder.build(root, ARITHMETIC_METADATA, uri);

        expect(index.declarations.size).toBe(1);
        const decls = index.declarations.get('foo');
        expect(decls).toHaveLength(2);
        expect(decls!.map(d => d.range.start.line)).toEqual([0, 1]);
    });

    test('records distinct declarations under separate keys', () => {
        const root = mockNode({
            type: 'source_file',
            children: [
                {
                    type: 'Definition',
                    fields: {
                        name: { type: 'ID', text: 'a', startPosition: { row: 0, column: 4 }, endPosition: { row: 0, column: 5 } },
                        expr: { type: 'NumberLiteral', fields: { value: { type: 'Number', text: '1' } } }
                    }
                },
                {
                    type: 'Definition',
                    fields: {
                        name: { type: 'ID', text: 'b', startPosition: { row: 1, column: 4 }, endPosition: { row: 1, column: 5 } },
                        expr: { type: 'NumberLiteral', fields: { value: { type: 'Number', text: '2' } } }
                    }
                }
            ]
        });

        const index = builder.build(root, ARITHMETIC_METADATA, uri);

        expect([...index.declarations.keys()].sort()).toEqual(['a', 'b']);
        expect(index.declarations.get('a')).toHaveLength(1);
        expect(index.declarations.get('b')).toHaveLength(1);
        expect(index.declarations.get('a')![0].nodeType).toBe('Definition');
    });

    test('ignores nodes whose type has no metadata entry', () => {
        const root = mockNode({
            type: 'source_file',
            children: [
                {
                    type: 'UnknownNode',
                    fields: {
                        name: { type: 'ID', text: 'ghost', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 5 } }
                    }
                }
            ]
        });

        const index = builder.build(root, ARITHMETIC_METADATA, uri);

        expect(index.declarations.size).toBe(0);
    });

    test('does not record a declaration for nodes without a name field in their metadata', () => {
        // NumberLiteral has metadata, but no `name` field — only `value`.
        const root = mockNode({
            type: 'source_file',
            children: [
                {
                    type: 'NumberLiteral',
                    fields: {
                        value: { type: 'Number', text: '42', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 2 } }
                    }
                }
            ]
        });

        const index = builder.build(root, ARITHMETIC_METADATA, uri);

        expect(index.declarations.size).toBe(0);
    });

    test('returns empty references and diagnostics maps in the declarations-only walk', () => {
        const root = mockNode({ type: 'source_file' });
        const index = builder.build(root, ARITHMETIC_METADATA, uri);
        expect(index.references.size).toBe(0);
        expect(index.diagnostics).toEqual([]);
    });

    test('walks deeply nested declarations', () => {
        // Tree-sitter can place declarations inside Parenthesized expressions or
        // anywhere else; the walker must not assume top-level only.
        const root = mockNode({
            type: 'source_file',
            children: [
                {
                    type: 'Parenthesized',
                    fields: {
                        expression: {
                            type: 'Definition',
                            fields: {
                                name: { type: 'ID', text: 'inner', startPosition: { row: 2, column: 8 }, endPosition: { row: 2, column: 13 } },
                                expr: { type: 'NumberLiteral', fields: { value: { type: 'Number', text: '7' } } }
                            }
                        }
                    }
                }
            ]
        });

        const index = builder.build(root, ARITHMETIC_METADATA, uri);

        expect(index.declarations.get('inner')).toHaveLength(1);
        expect(index.declarations.get('inner')![0].range).toEqual({
            start: { line: 2, character: 8 },
            end: { line: 2, character: 13 }
        });
    });
});

describe('DefaultIndexBuilder cross-references walk', () => {

    const builder = new DefaultIndexBuilder();
    const uri = 'file:///test.arith';

    test('records a single cross-reference keyed by the referenced name', () => {
        // `def y = x;` — the right-hand side is a NamedExpression whose `element`
        // field is a cross-reference (isRef: true in ARITHMETIC_METADATA).
        const root = mockNode({
            type: 'source_file',
            children: [
                {
                    type: 'Definition',
                    fields: {
                        name: { type: 'ID', text: 'y', startPosition: { row: 0, column: 4 }, endPosition: { row: 0, column: 5 } },
                        expr: {
                            type: 'NamedExpression',
                            fields: {
                                element: {
                                    type: 'ID',
                                    text: 'x',
                                    startPosition: { row: 0, column: 8 },
                                    endPosition: { row: 0, column: 9 }
                                }
                            }
                        }
                    }
                }
            ]
        });

        const index = builder.build(root, ARITHMETIC_METADATA, uri);

        expect(index.references.size).toBe(1);
        const refs = index.references.get('x');
        expect(refs).toHaveLength(1);
        const [ref] = refs!;
        expect(ref.name).toBe('x');
        expect(ref.range).toEqual({
            start: { line: 0, character: 8 },
            end: { line: 0, character: 9 }
        });
        expect(ref.targetUri).toBeUndefined();
    });

    test('groups multiple references under the same name', () => {
        const root = mockNode({
            type: 'source_file',
            children: [
                {
                    type: 'NamedExpression',
                    fields: {
                        element: { type: 'ID', text: 'foo', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 3 } }
                    }
                },
                {
                    type: 'NamedExpression',
                    fields: {
                        element: { type: 'ID', text: 'foo', startPosition: { row: 1, column: 4 }, endPosition: { row: 1, column: 7 } }
                    }
                }
            ]
        });

        const index = builder.build(root, ARITHMETIC_METADATA, uri);

        expect(index.references.size).toBe(1);
        const refs = index.references.get('foo');
        expect(refs).toHaveLength(2);
        expect(refs!.map(r => r.range.start.line)).toEqual([0, 1]);
    });

    test('records distinct references under separate keys', () => {
        const root = mockNode({
            type: 'source_file',
            children: [
                {
                    type: 'NamedExpression',
                    fields: {
                        element: { type: 'ID', text: 'a', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 1 } }
                    }
                },
                {
                    type: 'NamedExpression',
                    fields: {
                        element: { type: 'ID', text: 'b', startPosition: { row: 1, column: 0 }, endPosition: { row: 1, column: 1 } }
                    }
                }
            ]
        });

        const index = builder.build(root, ARITHMETIC_METADATA, uri);

        expect([...index.references.keys()].sort()).toEqual(['a', 'b']);
        expect(index.references.get('a')).toHaveLength(1);
        expect(index.references.get('b')).toHaveLength(1);
    });

    test('does not record references for fields that are not marked isRef', () => {
        // Definition.expr is a regular field (operator '=', not isRef). The
        // walker must not treat the expression child as a reference.
        const root = mockNode({
            type: 'source_file',
            children: [
                {
                    type: 'Definition',
                    fields: {
                        name: { type: 'ID', text: 'a', startPosition: { row: 0, column: 4 }, endPosition: { row: 0, column: 5 } },
                        expr: {
                            type: 'NumberLiteral',
                            fields: { value: { type: 'Number', text: '5' } }
                        }
                    }
                }
            ]
        });

        const index = builder.build(root, ARITHMETIC_METADATA, uri);

        expect(index.references.size).toBe(0);
    });

    test('records both declarations and references in a single walk', () => {
        // `def y = x;` — should produce one declaration ('y') AND one reference ('x').
        const root = mockNode({
            type: 'source_file',
            children: [
                {
                    type: 'Definition',
                    fields: {
                        name: { type: 'ID', text: 'y', startPosition: { row: 0, column: 4 }, endPosition: { row: 0, column: 5 } },
                        expr: {
                            type: 'NamedExpression',
                            fields: {
                                element: { type: 'ID', text: 'x', startPosition: { row: 0, column: 8 }, endPosition: { row: 0, column: 9 } }
                            }
                        }
                    }
                }
            ]
        });

        const index = builder.build(root, ARITHMETIC_METADATA, uri);

        expect(index.declarations.get('y')).toHaveLength(1);
        expect(index.references.get('x')).toHaveLength(1);
    });

    test('walks deeply nested cross-references', () => {
        // Reference can sit inside any expression position — e.g. inside an
        // Addition's `right` field. The walker must descend into all children.
        const root = mockNode({
            type: 'source_file',
            children: [
                {
                    type: 'Addition',
                    fields: {
                        left: { type: 'NumberLiteral', fields: { value: { type: 'Number', text: '1' } } },
                        right: {
                            type: 'NamedExpression',
                            fields: {
                                element: { type: 'ID', text: 'deep', startPosition: { row: 3, column: 12 }, endPosition: { row: 3, column: 16 } }
                            }
                        }
                    }
                }
            ]
        });

        const index = builder.build(root, ARITHMETIC_METADATA, uri);

        expect(index.references.get('deep')).toHaveLength(1);
        expect(index.references.get('deep')![0].range).toEqual({
            start: { line: 3, character: 12 },
            end: { line: 3, character: 16 }
        });
    });
});
