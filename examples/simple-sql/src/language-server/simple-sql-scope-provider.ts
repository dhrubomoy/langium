/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { AstNode, AstNodeDescription, ReferenceInfo, Scope, ScopeOptions } from 'langium';
import { MapScope } from 'langium';
import { DefaultScopeProvider } from 'langium';

/**
 * Cached scope provider that uses MapScope (O(1) lookups) and caches scope chains
 * per (container, referenceType) so sibling references share a single scope instance.
 */
export class SimpleSQLScopeProvider extends DefaultScopeProvider {

    private readonly scopeCache = new WeakMap<AstNode, Map<string, Scope>>();

    override getScope(context: ReferenceInfo): Scope {
        const referenceType = this.reflection.getReferenceType(context);
        const container = context.container;

        let typeMap = this.scopeCache.get(container);
        if (typeMap?.has(referenceType)) {
            return typeMap.get(referenceType)!;
        }

        // Walk to the root to find the document's localSymbols
        let root: AstNode = container;
        while (root.$container) {
            root = root.$container;
        }
        const localSymbols = root.$document?.localSymbols;

        // Build the scope chain using MapScope for O(1) lookups
        const scopes: Array<AstNodeDescription[]> = [];
        if (localSymbols) {
            let currentNode: AstNode | undefined = container;
            do {
                if (localSymbols.has(currentNode)) {
                    const filtered = localSymbols.getStream(currentNode)
                        .filter(desc => this.reflection.isSubtype(desc.type, referenceType))
                        .toArray();
                    if (filtered.length > 0) {
                        scopes.push(filtered);
                    }
                }
                currentNode = currentNode.$container;
            } while (currentNode);
        }

        let result: Scope = this.getGlobalScope(referenceType, context);
        for (let i = scopes.length - 1; i >= 0; i--) {
            result = new MapScope(scopes[i], result);
        }

        // Cache for sibling references
        if (!typeMap) {
            typeMap = new Map();
            this.scopeCache.set(container, typeMap);
        }
        typeMap.set(referenceType, result);
        return result;
    }

    protected override createScope(elements: Iterable<AstNodeDescription>, outerScope?: Scope, options?: ScopeOptions): Scope {
        return new MapScope(elements, outerScope, options);
    }
}
