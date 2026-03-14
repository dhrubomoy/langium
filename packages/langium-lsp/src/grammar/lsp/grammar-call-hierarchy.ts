/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { CallHierarchyIncomingCall, CallHierarchyOutgoingCall, Range } from 'vscode-languageserver';
import type { AstNode, CstNode, Stream, ReferenceDescription } from 'langium-core';
import { SymbolKind } from 'vscode-languageserver';
import { AbstractCallHierarchyProvider } from '../../lsp/call-hierarchy-provider.js';
import { AstUtils, CstUtils, GrammarAST } from 'langium-core';

export class LangiumGrammarCallHierarchyProvider extends AbstractCallHierarchyProvider {

    protected getIncomingCalls(node: AstNode, references: Stream<ReferenceDescription>): CallHierarchyIncomingCall[] | undefined {
        if (!GrammarAST.isAbstractParserRule(node)) {
            return undefined;
        }
        // This map is used to group incoming calls to avoid duplicates.
        const uniqueRules = new Map<string, { parserRule: CstNode, nameNode: CstNode, targetNodes: CstNode[], docUri: string }>();
        references.forEach(ref => {
            const doc = this.documents.getDocument(ref.sourceUri);
            if (!doc) {
                return;
            }
            const rootNode = doc.parseResult.value;
            if (!rootNode.$cstNode) {
                return;
            }
            const targetNode = CstUtils.findLeafNodeAtOffset(rootNode.$cstNode, ref.segment.offset);
            if (!targetNode) {
                return;
            }
            const parserRule = AstUtils.getContainerOfType(targetNode.astNode, GrammarAST.isAbstractParserRule);
            if (!parserRule || !parserRule.$cstNode) {
                return;
            }
            const nameNode = this.nameProvider.getNameNode(parserRule);
            if (!nameNode) {
                return;
            }
            const refDocUri = ref.sourceUri.toString();
            const ruleId = refDocUri + '@' + nameNode.text;

            uniqueRules.has(ruleId) ?
                uniqueRules.set(ruleId, { parserRule: parserRule.$cstNode, nameNode, targetNodes: [...uniqueRules.get(ruleId)!.targetNodes, targetNode], docUri: refDocUri })
                : uniqueRules.set(ruleId, { parserRule: parserRule.$cstNode, nameNode, targetNodes: [targetNode], docUri: refDocUri });
        });
        if (uniqueRules.size === 0) {
            return undefined;
        }
        return Array.from(uniqueRules.values()).map(rule => ({
            from: {
                kind: SymbolKind.Method,
                name: rule.nameNode.text,
                range: rule.parserRule.range,
                selectionRange: rule.nameNode.range,
                uri: rule.docUri
            },
            fromRanges: rule.targetNodes.map(node => node.range)
        }));
    }

    protected getOutgoingCalls(node: AstNode): CallHierarchyOutgoingCall[] | undefined {
        if (GrammarAST.isParserRule(node)) {
            const ruleCalls = AstUtils.streamAllContents(node).filter(GrammarAST.isRuleCall).toArray();
            // This map is used to group outgoing calls to avoid duplicates.
            const uniqueRules = new Map<string, { refCstNode: CstNode, to: CstNode, from: Range[], docUri: string }>();
            ruleCalls.forEach(ruleCall => {
                const cstNode = ruleCall.$cstNode;
                if (!cstNode) {
                    return;
                }
                const refCstNode = ruleCall.rule.ref?.$cstNode;
                if (!refCstNode) {
                    return;
                }
                const refNameNode = this.nameProvider.getNameNode(refCstNode.astNode);
                if (!refNameNode) {
                    return;
                }
                const refDocUri = AstUtils.getDocument(refCstNode.astNode).uri.toString();
                const ruleId = refDocUri + '@' + refNameNode.text;

                uniqueRules.has(ruleId) ?
                    uniqueRules.set(ruleId, { refCstNode: refCstNode, to: refNameNode, from: [...uniqueRules.get(ruleId)!.from, cstNode.range], docUri: refDocUri })
                    : uniqueRules.set(ruleId, { refCstNode: refCstNode, to: refNameNode, from: [cstNode.range], docUri: refDocUri });
            });
            if (uniqueRules.size === 0) {
                return undefined;
            }
            return Array.from(uniqueRules.values()).map(rule => ({
                to: {
                    kind: SymbolKind.Method,
                    name: rule.to.text,
                    range: rule.refCstNode.range,
                    selectionRange: rule.to.range,
                    uri: rule.docUri
                },
                fromRanges: rule.from
            }));
        } else if (GrammarAST.isInfixRule(node)) {
            const ruleCall = node.call;
            const cstNode = ruleCall.$cstNode;
            if (!cstNode) {
                return undefined;
            }
            const refCstNode = ruleCall.rule.ref?.$cstNode;
            if (!refCstNode) {
                return undefined;
            }
            const refNameNode = this.nameProvider.getNameNode(refCstNode.astNode);
            if (!refNameNode) {
                return undefined;
            }
            const refDocUri = AstUtils.getDocument(refCstNode.astNode).uri.toString();
            return [{
                to: {
                    kind: SymbolKind.Method,
                    name: refNameNode.text,
                    range: refCstNode.range,
                    selectionRange: refNameNode.range,
                    uri: refDocUri
                },
                fromRanges: [cstNode.range]
            }];
        } else {
            return undefined;
        }
    }
}
