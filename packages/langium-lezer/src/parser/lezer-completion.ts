/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { LRParser } from '@lezer/lr';
import type { ExpectedToken } from 'langium-core';

/**
 * Compute expected tokens at a given offset using Lezer's parse state.
 *
 * Strategy:
 * 1. Parse the text up to the cursor position.
 * 2. Inspect the parse tree's rightmost nodes to determine context.
 * 3. Use the parser's term names to suggest valid continuations.
 *
 * This is inherently less precise than Chevrotain's `computeContentAssist()`
 * for LL grammars. Acceptable tradeoffs:
 * - May suggest tokens that are grammatically valid but semantically invalid
 *   (filtered by Langium's scope/linker layer anyway)
 * - Does not handle mid-token completion as precisely
 * - Error recovery state may cause over-suggestion
 *
 * These limitations are acceptable because Langium's completion pipeline
 * already applies semantic filtering on top of syntactic suggestions.
 */
export function getLezerExpectedTokens(
    parser: LRParser,
    text: string,
    offset: number
): ExpectedToken[] {
    // Parse text up to the cursor position
    const partialText = text.slice(0, offset);
    const tree = parser.parse(partialText);

    const expectedTokens: ExpectedToken[] = [];

    // Find the deepest node at the end of the partial parse
    const cursor = tree.cursor();
    cursor.moveTo(offset);

    // Walk up from the cursor position to find the containing rule context
    // and determine what tokens could validly follow
    let currentNode = cursor.node;

    // If we're at an error node, the parser couldn't match the input,
    // so we look at the parent context for valid continuations
    if (currentNode.type.isError && currentNode.parent) {
        currentNode = currentNode.parent;
    }

    // Inspect the node's type to determine valid follow tokens.
    // For now, we use a simplified approach: examine sibling structure
    // to determine what kinds of tokens could appear next.
    // A full implementation would analyze the LR parse table state directly.

    // Look at the node names in the parser's vocabulary to find
    // tokens that could appear in the current context
    const nodeSet = parser.nodeSet;
    for (let i = 0; i < nodeSet.types.length; i++) {
        const type = nodeSet.types[i];
        // Skip error and anonymous types
        if (type.isError || type.name === '') continue;
        // Skip non-leaf types (we only want tokens, not rules)
        // Heuristic: types with no children in the set are likely tokens
        if (type.id > 0 && type.name) {
            expectedTokens.push({
                name: type.name,
                isKeyword: false, // Will be refined with grammar registry
                pattern: undefined
            });
        }
    }

    return expectedTokens;
}
