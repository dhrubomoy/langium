/******************************************************************************
 * Copyright 2023 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type {
    CancellationToken,
    TypeHierarchyItem,
    TypeHierarchyPrepareParams,
    TypeHierarchySubtypesParams,
    TypeHierarchySupertypesParams
} from 'vscode-languageserver';
import { SymbolKind } from 'vscode-languageserver';
import type { GrammarConfig, NameProvider, References, AstNode, LangiumDocument, LangiumDocuments, MaybePromise } from 'langium-core';
import type { LangiumServices } from './lsp-services.js';
import { SyntaxNodeUtils, URI } from 'langium-core';

/**
 * Language-specific service for handling type hierarchy requests.
 */

export interface TypeHierarchyProvider {
    prepareTypeHierarchy(document: LangiumDocument, params: TypeHierarchyPrepareParams, cancelToken?: CancellationToken): MaybePromise<TypeHierarchyItem[] | undefined>;

    supertypes(params: TypeHierarchySupertypesParams, cancelToken?: CancellationToken): MaybePromise<TypeHierarchyItem[] | undefined>;

    subtypes(params: TypeHierarchySubtypesParams, cancelToken?: CancellationToken): MaybePromise<TypeHierarchyItem[] | undefined>;
}

export abstract class AbstractTypeHierarchyProvider implements TypeHierarchyProvider {
    protected readonly grammarConfig: GrammarConfig;
    protected readonly nameProvider: NameProvider;
    protected readonly documents: LangiumDocuments;
    protected readonly references: References;

    constructor(services: LangiumServices) {
        this.grammarConfig = services.parser.GrammarConfig;
        this.nameProvider = services.references.NameProvider;
        this.documents = services.shared.workspace.LangiumDocuments;
        this.references = services.references.References;
    }

    prepareTypeHierarchy(document: LangiumDocument, params: TypeHierarchyPrepareParams, _cancelToken?: CancellationToken): MaybePromise<TypeHierarchyItem[] | undefined> {
        const rootNode = document.parseResult.value;
        const targetNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(
            rootNode.$syntaxNode,
            document.textDocument.offsetAt(params.position),
            this.grammarConfig.nameRegexp,
        );
        if (!targetNode) {
            return undefined;
        }

        const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(targetNode);
        if (!astNode) {
            return undefined;
        }
        const declarationNodes = this.references.findDeclarationsSN(astNode, targetNode);
        const items: TypeHierarchyItem[] = [];
        for (const declarationNode of declarationNodes) {
            items.push(...(this.getTypeHierarchyItems(declarationNode, document) ?? []));
        }
        return items;
    }

    protected getTypeHierarchyItems(targetNode: AstNode, document: LangiumDocument): TypeHierarchyItem[] | undefined {
        const nameNode = this.nameProvider.getNameSyntaxNode(targetNode);
        const name = this.nameProvider.getName(targetNode);
        if (!nameNode || !targetNode.$syntaxNode || name === undefined) {
            return undefined;
        }

        return [
            {
                kind: SymbolKind.Class,
                name,
                range: targetNode.$syntaxNode.range,
                selectionRange: nameNode.range,
                uri: document.uri.toString(),
                ...this.getTypeHierarchyItem(targetNode),
            },
        ];
    }

    /**
     * Override this method to change default properties of the type hierarchy item or add additional ones like `tags`
     * or `details`.
     *
     * @example
     * // Change the node kind to SymbolKind.Interface
     * return { kind: SymbolKind.Interface }
     *
     * @see NodeKindProvider
     */
    protected getTypeHierarchyItem(_targetNode: AstNode): Partial<TypeHierarchyItem> | undefined {
        return undefined;
    }

    async supertypes(params: TypeHierarchySupertypesParams, _cancelToken?: CancellationToken): Promise<TypeHierarchyItem[] | undefined> {
        const document = await this.documents.getOrCreateDocument(URI.parse(params.item.uri));
        const rootNode = document.parseResult.value;
        const targetNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(
            rootNode.$syntaxNode,
            document.textDocument.offsetAt(params.item.range.start),
            this.grammarConfig.nameRegexp,
        );
        if (!targetNode) {
            return undefined;
        }

        // Bridge to AstNode for getSupertypes()
        const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(targetNode);
        if (!astNode) {
            return undefined;
        }
        return this.getSupertypes(astNode);
    }

    /**
     * Override this method to collect the supertypes for your language.
     */
    protected abstract getSupertypes(node: AstNode): MaybePromise<TypeHierarchyItem[] | undefined>;

    async subtypes(params: TypeHierarchySubtypesParams, _cancelToken?: CancellationToken): Promise<TypeHierarchyItem[] | undefined> {
        const document = await this.documents.getOrCreateDocument(URI.parse(params.item.uri));
        const rootNode = document.parseResult.value;
        const targetNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(
            rootNode.$syntaxNode,
            document.textDocument.offsetAt(params.item.range.start),
            this.grammarConfig.nameRegexp,
        );
        if (!targetNode) {
            return undefined;
        }

        // Bridge to AstNode for getSubtypes()
        const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(targetNode);
        if (!astNode) {
            return undefined;
        }
        return this.getSubtypes(astNode);
    }

    /**
     * Override this method to collect the subtypes for your language.
     */
    protected abstract getSubtypes(node: AstNode): MaybePromise<TypeHierarchyItem[] | undefined>;
}
