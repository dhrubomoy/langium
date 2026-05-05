/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { LangiumDocument } from 'langium';
import type { GrammarMetadata } from 'langium/generate';
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import { DefaultDocumentBuilder, DefaultIndexBuilder, DocumentState, EmptyFileSystem, URI } from 'langium';
import { createLangiumGrammarServices } from 'langium/grammar';
import { describe, expect, test } from 'vitest';
import { ARITHMETIC_METADATA } from '../fixtures/arithmetic/metadata.js';

/**
 * Test subclass that exposes the protected {@link DefaultDocumentBuilder.buildDocumentIndex}
 * hook so we can drive it directly without standing up the full parse pipeline.
 */
class TestableDocumentBuilder extends DefaultDocumentBuilder {
    runBuildDocumentIndex(document: LangiumDocument): void {
        this.buildDocumentIndex(document);
    }
}

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
        isMissing: false,
        children,
        childForFieldName(name: string): SyntaxNode | null {
            return fieldByName.get(name) ?? null;
        }
    };
    return node as unknown as SyntaxNode;
}

function mockTree(root: SyntaxNode): Tree {
    return { rootNode: root } as unknown as Tree;
}

function setMetadata(services: ReturnType<typeof createLangiumGrammarServices>['grammar'], metadata: GrammarMetadata | undefined): void {
    Object.defineProperty(services.workspace, 'GrammarMetadataProvider', {
        value: { getMetadata: () => metadata },
        configurable: true
    });
}

function makeDocument(uri: string, tree: Tree | undefined): LangiumDocument {
    return {
        uri: URI.parse(uri),
        textDocument: undefined as never,
        state: DocumentState.Parsed,
        parseResult: { value: { $type: 'Root' }, parserErrors: [], lexerErrors: [] } as never,
        references: [],
        treeSitterTree: tree
    };
}

describe('DefaultDocumentBuilder tree-sitter DocumentIndex wiring', () => {

    test('builds DocumentIndex from treeSitterTree when GrammarMetadataProvider supplies metadata', () => {
        const services = createLangiumGrammarServices(EmptyFileSystem).grammar;
        setMetadata(services, ARITHMETIC_METADATA);
        // Use a real DefaultIndexBuilder so the integration is end-to-end from
        // builder → metadata provider → index builder.
        Object.defineProperty(services.workspace, 'IndexBuilder', {
            value: new DefaultIndexBuilder(),
            configurable: true
        });

        const builder = new TestableDocumentBuilder(services.shared);
        const tree = mockTree(mockNode({
            type: 'source_file',
            children: [
                {
                    type: 'Definition',
                    fields: {
                        name: { type: 'ID', text: 'x', startPosition: { row: 0, column: 4 }, endPosition: { row: 0, column: 5 } },
                        expr: { type: 'NumberLiteral', fields: { value: { type: 'Number', text: '5' } } }
                    }
                }
            ]
        }));
        const document = makeDocument('file:///wired.langium', tree);

        builder.runBuildDocumentIndex(document);

        expect(document.documentIndex).toBeDefined();
        expect(document.documentIndex!.declarations.size).toBeGreaterThan(0);
        expect(document.documentIndex!.declarations.get('x')).toHaveLength(1);
    });

    test('skips the index build when treeSitterTree is undefined', () => {
        const services = createLangiumGrammarServices(EmptyFileSystem).grammar;
        setMetadata(services, ARITHMETIC_METADATA);

        const builder = new TestableDocumentBuilder(services.shared);
        const document = makeDocument('file:///no-tree.langium', undefined);

        builder.runBuildDocumentIndex(document);

        expect(document.documentIndex).toBeUndefined();
    });

    test('skips the index build when GrammarMetadataProvider returns undefined', () => {
        const services = createLangiumGrammarServices(EmptyFileSystem).grammar;
        // Default provider already returns undefined, but be explicit.
        setMetadata(services, undefined);

        const builder = new TestableDocumentBuilder(services.shared);
        const tree = mockTree(mockNode({ type: 'source_file' }));
        const document = makeDocument('file:///no-metadata.langium', tree);

        builder.runBuildDocumentIndex(document);

        expect(document.documentIndex).toBeUndefined();
    });

    test('default GrammarMetadataProvider returns undefined so the index build is a no-op out of the box', () => {
        const services = createLangiumGrammarServices(EmptyFileSystem).grammar;
        // Do not override the provider — exercise the real default.
        const builder = new TestableDocumentBuilder(services.shared);
        const tree = mockTree(mockNode({ type: 'source_file' }));
        const document = makeDocument('file:///default.langium', tree);

        builder.runBuildDocumentIndex(document);

        expect(document.documentIndex).toBeUndefined();
        expect(services.workspace.GrammarMetadataProvider.getMetadata()).toBeUndefined();
    });
});
