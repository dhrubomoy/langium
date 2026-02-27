/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { SignatureHelp, SignatureHelpOptions, SignatureHelpParams } from 'vscode-languageserver';
import type { AstNode, MaybePromise, LangiumDocument } from 'langium-core';
import { Cancellation, SyntaxNodeUtils } from 'langium-core';

/**
 * Language-specific service for handling signature help requests.
 */
export interface SignatureHelpProvider {
    /**
     * Handles a signature help request
     */
    provideSignatureHelp(document: LangiumDocument, params: SignatureHelpParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<SignatureHelp | undefined>;
    /**
     * Options that determine the server capabilities for a signature help request. It contains the list of triggering characters.
     */
    get signatureHelpOptions(): SignatureHelpOptions;
}

export abstract class AbstractSignatureHelpProvider implements SignatureHelpProvider {
    provideSignatureHelp(document: LangiumDocument, params: SignatureHelpParams, cancelToken = Cancellation.CancellationToken.None): MaybePromise<SignatureHelp | undefined> {
        const rootNode = document.parseResult.value;
        const rootSyntaxNode = rootNode.$syntaxNode;
        if (rootSyntaxNode) {
            const sourceSyntaxNode = SyntaxNodeUtils.findLeafSyntaxNodeAtOffset(rootSyntaxNode, document.textDocument.offsetAt(params.position));
            if (sourceSyntaxNode) {
                const astNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(sourceSyntaxNode);
                if (astNode) {
                    return this.getSignatureFromElement(astNode, cancelToken);
                }
            }
        }
        return undefined;
    }

    /**
     * Override this method to return the desired SignatureHelp
     */
    protected abstract getSignatureFromElement(element: AstNode, cancelToken: Cancellation.CancellationToken): MaybePromise<SignatureHelp | undefined>;

    /**
     * Override this getter to return the list of triggering characters for your language. To deactivate the signature help, return an empty object.
     */
    get signatureHelpOptions(): SignatureHelpOptions {
        return {
            triggerCharacters: ['('],
            retriggerCharacters: [',']
        };
    }
}

/**
 * Merges the SignatureHelpOptions of all languages
 */
export function mergeSignatureHelpOptions(options: Array<SignatureHelpOptions | undefined>): SignatureHelpOptions | undefined {
    const triggerCharacters: string[] = [];
    const retriggerCharacters: string[] = [];

    options.forEach(option => {
        if (option?.triggerCharacters) {
            triggerCharacters.push(...option.triggerCharacters);
        }
        if (option?.retriggerCharacters) {
            retriggerCharacters.push(...option.retriggerCharacters);
        }
    });

    const mergedOptions: SignatureHelpOptions = {
        triggerCharacters: triggerCharacters.length > 0 ? Array.from(new Set(triggerCharacters)).sort() : undefined,
        retriggerCharacters: retriggerCharacters.length > 0 ? Array.from(new Set(retriggerCharacters)).sort() : undefined
    };

    return mergedOptions.triggerCharacters ? mergedOptions : undefined;
}
