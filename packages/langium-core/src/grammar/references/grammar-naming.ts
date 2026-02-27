/******************************************************************************
* Copyright 2022 TypeFox GmbH
* This program and the accompanying materials are made available under the
* terms of the MIT License, which is available in the project root.
******************************************************************************/

import type { SyntaxNode } from '../../parser/syntax-node.js';
import type { AstNode, CstNode } from '../../syntax-tree.js';
import { DefaultNameProvider } from '../../references/name-provider.js';
import { findNodeForProperty } from '../../utils/grammar-utils.js';
import { findNodeForPropertySN } from '../../utils/syntax-node-utils.js';
import { isAssignment } from '../../languages/generated/ast.js';

export class LangiumGrammarNameProvider extends DefaultNameProvider {

    override getName(node: AstNode): string | undefined {
        if (isAssignment(node)) {
            return node.feature;
        } else {
            return super.getName(node);
        }
    }

    override getNameNode(node: AstNode): CstNode | undefined {
        if (isAssignment(node)) {
            return findNodeForProperty(node.$cstNode, 'feature');
        } else {
            return super.getNameNode(node);
        }
    }

    override getNameSyntaxNode(node: AstNode): SyntaxNode | undefined {
        if (isAssignment(node)) {
            return findNodeForPropertySN(node.$syntaxNode, 'feature');
        } else {
            return super.getNameSyntaxNode(node);
        }
    }

}
