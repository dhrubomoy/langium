/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { CallHierarchyIncomingCall, CallHierarchyIncomingCallsParams, CallHierarchyItem, CallHierarchyOutgoingCall, CallHierarchyOutgoingCallsParams, CallHierarchyPrepareParams,  } from 'vscode-languageserver';
import type { GrammarConfig, NameProvider, References, AstNode, Stream, ReferenceDescription, LangiumDocument, LangiumDocuments, MaybePromise } from 'langium-core';
import type { LangiumServices } from './lsp-services.js';
import { SymbolKind } from 'vscode-languageserver';
import { Cancellation, CstUtils, SyntaxNodeUtils, URI } from 'langium-core';

/**
 * Language-specific service for handling call hierarchy requests.
 */
export interface CallHierarchyProvider {
    prepareCallHierarchy(document: LangiumDocument, params: CallHierarchyPrepareParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<CallHierarchyItem[] | undefined>;

    incomingCalls(params: CallHierarchyIncomingCallsParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<CallHierarchyIncomingCall[] | undefined>;

    outgoingCalls(params: CallHierarchyOutgoingCallsParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<CallHierarchyOutgoingCall[] | undefined>;
}

export abstract class AbstractCallHierarchyProvider implements CallHierarchyProvider {
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

    prepareCallHierarchy(document: LangiumDocument<AstNode>, params: CallHierarchyPrepareParams): MaybePromise<CallHierarchyItem[] | undefined> {
        const rootNode = document.parseResult.value;
        const targetNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(
            rootNode.$syntaxNode,
            document.textDocument.offsetAt(params.position),
            this.grammarConfig.nameRegexp
        );
        if (!targetNode) {
            return undefined;
        }

        // Bridge to CstNode for references.findDeclarationNodes()
        const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(targetNode);
        if (!astNode?.$cstNode) {
            return undefined;
        }
        const cstNode = CstUtils.findDeclarationNodeAtOffset(
            astNode.$cstNode,
            document.textDocument.offsetAt(params.position),
            this.grammarConfig.nameRegexp
        );
        if (!cstNode) {
            return undefined;
        }
        const declarationNodes = this.references.findDeclarationNodes(cstNode);
        if (!declarationNodes) {
            return undefined;
        }

        const items: CallHierarchyItem[] = [];
        for (const declarationNode of declarationNodes) {
            items.push(...(this.getCallHierarchyItems(declarationNode.astNode, document) ?? []));
        }
        return items;
    }

    protected getCallHierarchyItems(targetNode: AstNode, document: LangiumDocument<AstNode>): CallHierarchyItem[] | undefined {
        const nameNode = this.nameProvider.getNameSyntaxNode(targetNode);
        const name = this.nameProvider.getName(targetNode);
        if (!nameNode || !targetNode.$syntaxNode || name === undefined) {
            return undefined;
        }

        return [{
            kind: SymbolKind.Method,
            name,
            range: targetNode.$syntaxNode.range,
            selectionRange: nameNode.range,
            uri: document.uri.toString(),
            ...this.getCallHierarchyItem(targetNode)
        }];
    }

    protected getCallHierarchyItem(_targetNode: AstNode): Partial<CallHierarchyItem> | undefined {
        return undefined;
    }

    async incomingCalls(params: CallHierarchyIncomingCallsParams): Promise<CallHierarchyIncomingCall[] | undefined> {
        const document = await this.documents.getOrCreateDocument(URI.parse(params.item.uri));
        const rootNode = document.parseResult.value;
        const targetNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(
            rootNode.$syntaxNode,
            document.textDocument.offsetAt(params.item.range.start),
            this.grammarConfig.nameRegexp
        );
        if (!targetNode) {
            return undefined;
        }

        // Bridge to AstNode for references.findReferences()
        const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(targetNode);
        if (!astNode) {
            return undefined;
        }

        const references = this.references.findReferences(
            astNode,
            {
                includeDeclaration: false
            }
        );
        return this.getIncomingCalls(astNode, references);
    }

    /**
     * Override this method to collect the incoming calls for your language
     */
    protected abstract getIncomingCalls(node: AstNode, references: Stream<ReferenceDescription>): MaybePromise<CallHierarchyIncomingCall[] | undefined>;

    async outgoingCalls(params: CallHierarchyOutgoingCallsParams): Promise<CallHierarchyOutgoingCall[] | undefined> {
        const document = await this.documents.getOrCreateDocument(URI.parse(params.item.uri));
        const rootNode = document.parseResult.value;
        const targetNode = SyntaxNodeUtils.findDeclarationSyntaxNodeAtOffset(
            rootNode.$syntaxNode,
            document.textDocument.offsetAt(params.item.range.start),
            this.grammarConfig.nameRegexp
        );
        if (!targetNode) {
            return undefined;
        }

        // Bridge to AstNode for getOutgoingCalls()
        const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(targetNode);
        if (!astNode) {
            return undefined;
        }
        return this.getOutgoingCalls(astNode);
    }

    /**
     * Override this method to collect the outgoing calls for your language
     */
    protected abstract getOutgoingCalls(node: AstNode): MaybePromise<CallHierarchyOutgoingCall[] | undefined>;
}
