/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { ParseResult } from '../parser/parse-result.js';
import type { AstNode, CstNode } from '../syntax-tree.js';

/**
 * The hydrator service is responsible for allowing AST parse results to be sent across worker threads.
 */
export interface Hydrator {
    /**
     * Converts a parse result to a plain object. The resulting object can be sent across worker threads.
     */
    dehydrate(result: ParseResult<AstNode>): ParseResult<object>;
    /**
     * Converts a plain object to a parse result. The included AST node can then be used in the main thread.
     * Calling this method on objects that have not been dehydrated first will result in undefined behavior.
     */
    hydrate<T extends AstNode = AstNode>(result: ParseResult<object>): ParseResult<T>;
}

export interface DehydrateContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    astNodes: Map<AstNode, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cstNodes: Map<CstNode, any>;
}

export interface HydrateContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    astNodes: Map<any, AstNode>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cstNodes: Map<any, CstNode>;
}
