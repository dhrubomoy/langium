/******************************************************************************
 * Copyright 2023 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { InlayHint, InlayHintParams } from 'vscode-languageserver';
import type { AstNode, MaybePromise, LangiumDocument } from 'langium-core';
import { AstUtils, Cancellation, interruptAndCheck } from 'langium-core';

export type InlayHintAcceptor = (inlayHint: InlayHint) => void;

/**
 * Provider for the inlay hint LSP type.
 */
export interface InlayHintProvider {
    /**
     * Handle the `textDocument.inlayHint` language server request.
     *
     * @throws `OperationCancelled` if cancellation is detected during execution
     * @throws `ResponseError` if an error is detected that should be sent as response to the client
     */
    getInlayHints(document: LangiumDocument, params: InlayHintParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<InlayHint[] | undefined>;
}

export abstract class AbstractInlayHintProvider implements InlayHintProvider {
    async getInlayHints(document: LangiumDocument, params: InlayHintParams, cancelToken = Cancellation.CancellationToken.None): Promise<InlayHint[] | undefined> {
        const root = document.parseResult.value;
        const inlayHints: InlayHint[] = [];
        const acceptor: InlayHintAcceptor = hint => inlayHints.push(hint);
        for (const node of AstUtils.streamAst(root, { range: params.range })) {
            await interruptAndCheck(cancelToken);
            this.computeInlayHint(node, acceptor);
        }
        return inlayHints;
    }

    abstract computeInlayHint(astNode: AstNode, acceptor: InlayHintAcceptor): void;
}
