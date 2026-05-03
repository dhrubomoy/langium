/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * @module langium
 */

export * from './default-module.js';
export * from './dependency-injection.js';
export * from './service-registry.js';
export * from './services.js';
export * from './syntax-tree.js';
export * from './documentation/index.js';
export * from './languages/index.js';
export * from './parser/index.js';
export * from './references/index.js';
export * from './serializer/index.js';
export * from './utils/index.js';
export * from './validation/index.js';
export * from './workspace/index.js';

// Disambiguate the `ReferenceInfo` name. Two distinct types share it:
//   - `./syntax-tree.js`  → the linker/scope-provider context (legacy CST/AST path).
//   - `./workspace/document-index.js` → the new tree-sitter `DocumentIndex` reference
//     entry. `DocumentIndex` itself references this type, so it must be the public one.
// Internal Langium consumers that still need the legacy type import it via the
// relative `../syntax-tree.js` path.
export type {
    DeclarationInfo,
    DocumentIndex,
    DocumentIndexMap,
    ReferenceInfo
} from './workspace/document-index.js';

// Export the Langium Grammar AST definitions in the `GrammarAST` namespace
import * as GrammarAST from './languages/generated/ast.js';
import type { Grammar } from './languages/generated/ast.js';
export type { Grammar };
export { GrammarAST };
