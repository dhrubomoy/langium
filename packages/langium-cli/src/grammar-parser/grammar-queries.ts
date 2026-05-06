/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Node as SyntaxNode } from 'web-tree-sitter';

export function getImports(root: SyntaxNode): SyntaxNode[] {
    return root.namedChildren.filter((c): c is SyntaxNode => c?.type === 'grammar_import');
}

export function getImportPath(importNode: SyntaxNode): string {
    const pathNode = importNode.childForFieldName('path');
    if (!pathNode) {
        throw new Error('grammar_import node missing path field');
    }
    const text = pathNode.text;
    return text.slice(1, -1);
}
