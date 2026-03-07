/******************************************************************************
 * Copyright 2023 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { WorkspaceSymbol, WorkspaceSymbolParams } from 'vscode-languageserver';
import type { IndexManager, MaybePromise, AstNodeDescription } from 'langium-core';
import { Cancellation, interruptAndCheck } from 'langium-core';
import type { LangiumSharedServices } from './lsp-services.js';
import type { NodeKindProvider } from './node-kind-provider.js';
import type { FuzzyMatcher } from './fuzzy-matcher.js';

/**
 * Shared service for handling workspace symbols requests.
 */
export interface WorkspaceSymbolProvider {
    /**
     * Handle a workspace symbols request.
     *
     * @param params workspaces symbols request parameters
     * @param cancelToken a cancellation token tha can be used to cancel the request
     * @returns a list of workspace symbols
     *
     * @throws `OperationCancelled` if cancellation is detected during execution
     * @throws `ResponseError` if an error is detected that should be sent as response to the client
     */
    getSymbols(params: WorkspaceSymbolParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<WorkspaceSymbol[]>;
    /**
     * Handle a resolve request for a workspace symbol.
     *
     * @param symbol the workspace symbol to resolve
     * @param cancelToken a cancellation token tha can be used to cancel the request
     * @returns the resolved workspace symbol
     *
     * @throws `OperationCancelled` if cancellation is detected during execution
     * @throws `ResponseError` if an error is detected that should be sent as response to the client
     */
    resolveSymbol?(symbol: WorkspaceSymbol, cancelToken?: Cancellation.CancellationToken): MaybePromise<WorkspaceSymbol>;
}

export class DefaultWorkspaceSymbolProvider implements WorkspaceSymbolProvider {

    protected readonly indexManager: IndexManager;
    protected readonly nodeKindProvider: NodeKindProvider;
    protected readonly fuzzyMatcher: FuzzyMatcher;

    constructor(services: LangiumSharedServices) {
        this.indexManager = services.workspace.IndexManager;
        this.nodeKindProvider = services.lsp.NodeKindProvider;
        this.fuzzyMatcher = services.lsp.FuzzyMatcher;
    }

    async getSymbols(params: WorkspaceSymbolParams, cancelToken = Cancellation.CancellationToken.None): Promise<WorkspaceSymbol[]> {
        const workspaceSymbols: WorkspaceSymbol[] = [];
        const query = params.query.toLowerCase();
        for (const description of this.indexManager.allElements()) {
            await interruptAndCheck(cancelToken);
            if (this.fuzzyMatcher.match(query, description.name)) {
                const symbol = this.getWorkspaceSymbol(description);
                if (symbol) {
                    workspaceSymbols.push(symbol);
                }
            }
        }
        return workspaceSymbols;
    }

    protected getWorkspaceSymbol(astDescription: AstNodeDescription): WorkspaceSymbol | undefined {
        const nameSegment = astDescription.nameSegment;
        if (nameSegment) {
            return {
                kind: this.nodeKindProvider.getSymbolKind(astDescription),
                name: astDescription.name,
                location: {
                    range: nameSegment.range,
                    uri: astDescription.documentUri.toString()
                }
            };
        } else {
            return undefined;
        }
    }
}
