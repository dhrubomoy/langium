/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { DefinitionParams } from 'vscode-languageserver';
import type { SyntaxNode, AstNode, Properties, MaybePromise, LangiumDocuments, Grammar } from 'langium-core';
import type { LangiumServices } from '../../lsp/lsp-services.js';
import { LocationLink, Range } from 'vscode-languageserver';
import { DefaultDefinitionProvider } from '../../lsp/definition-provider.js';
import { AstUtils, GrammarAST, SyntaxNodeUtils } from 'langium-core';
import { resolveImport } from 'langium-core/grammar';

export class LangiumGrammarDefinitionProvider extends DefaultDefinitionProvider {

    protected documents: LangiumDocuments;

    constructor(services: LangiumServices) {
        super(services);
        this.documents = services.shared.workspace.LangiumDocuments;
    }

    protected override collectLocationLinks(sourceSyntaxNode: SyntaxNode, _params: DefinitionParams): MaybePromise<LocationLink[] | undefined> {
        const pathFeature: Properties<GrammarAST.GrammarImport> = 'path';
        // Bridge: get the AST node from the SyntaxNode for grammar-specific checks
        const sourceAstNode = SyntaxNodeUtils.findAstNodeForSyntaxNode(sourceSyntaxNode);
        if (sourceAstNode && GrammarAST.isGrammarImport(sourceAstNode) && SyntaxNodeUtils.findAssignmentSN(sourceSyntaxNode)?.feature === pathFeature) {
            const importedGrammar = resolveImport(this.documents, sourceAstNode);
            if (importedGrammar?.$document) {
                const targetObject = this.findTargetObject(importedGrammar) ?? importedGrammar;
                const selectionRange = this.nameProvider.getNameNode(targetObject)?.range ?? Range.create(0, 0, 0, 0);
                const previewRange = targetObject.$syntaxNode?.range ?? targetObject.$cstNode?.range ?? Range.create(0, 0, 0, 0);
                return [
                    LocationLink.create(
                        importedGrammar.$document.uri.toString(),
                        previewRange,
                        selectionRange,
                        sourceSyntaxNode.range
                    )
                ];
            }
            return undefined;
        }
        return super.collectLocationLinks(sourceSyntaxNode, _params);
    }

    protected findTargetObject(importedGrammar: Grammar): AstNode | undefined {
        // Jump to grammar name or the first element
        if (importedGrammar.isDeclared) {
            return importedGrammar;
        }
        return AstUtils.streamContents(importedGrammar).head();
    }
}
