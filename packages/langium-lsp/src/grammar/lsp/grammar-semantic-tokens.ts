/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { AstNode } from 'langium-core';
import type { SemanticTokenAcceptor } from '../../lsp/semantic-token-provider.js';
import { SemanticTokenTypes } from 'vscode-languageserver';
import { AbstractSemanticTokenProvider } from '../../lsp/semantic-token-provider.js';
import { GrammarAST } from 'langium-core';

export class LangiumGrammarSemanticTokenProvider extends AbstractSemanticTokenProvider {

    protected highlightElement(node: AstNode, acceptor: SemanticTokenAcceptor): void {
        if (GrammarAST.isAssignment(node)) {
            acceptor({
                node,
                property: 'feature',
                type: SemanticTokenTypes.property
            });
        } else if (GrammarAST.isAction(node)) {
            if (node.feature) {
                acceptor({
                    node,
                    property: 'feature',
                    type: SemanticTokenTypes.property
                });
            }
        } else if (GrammarAST.isReturnType(node)) {
            acceptor({
                node,
                property: 'name',
                type: SemanticTokenTypes.type
            });
        } else if (GrammarAST.isSimpleType(node)) {
            if (node.primitiveType || node.typeRef) {
                acceptor({
                    node,
                    property: node.primitiveType ? 'primitiveType' : 'typeRef',
                    type: SemanticTokenTypes.type
                });
            }
        } else if (GrammarAST.isParameter(node)) {
            acceptor({
                node,
                property: 'name',
                type: SemanticTokenTypes.parameter
            });
        } else if (GrammarAST.isParameterReference(node)) {
            acceptor({
                node,
                property: 'parameter',
                type: SemanticTokenTypes.parameter
            });
        } else if (GrammarAST.isRuleCall(node)) {
            if (!GrammarAST.isInfixRule(node.rule.ref) && node.rule.ref?.fragment) {
                acceptor({
                    node,
                    property: 'rule',
                    type: SemanticTokenTypes.type
                });
            }
        } else if (GrammarAST.isTypeAttribute(node)) {
            acceptor({
                node,
                property: 'name',
                type: SemanticTokenTypes.property
            });
        }
    }

}
