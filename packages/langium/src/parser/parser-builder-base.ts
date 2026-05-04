/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { TokenTypeDictionary } from './_chevrotain-types.js';
import type { Grammar } from '../languages/generated/ast.js';
import type { BaseParser } from './langium-parser.js';

/**
 * After the Chevrotain → tree-sitter migration (US-026/US-027) the
 * Chevrotain-based rule builder is a no-op stub. Consumers should not
 * call this any more — it is kept only so existing imports continue to
 * type-check until they migrate.
 */
export function createParser<T extends BaseParser>(_grammar: Grammar, parser: T, _tokens: TokenTypeDictionary): T {
    return parser;
}
