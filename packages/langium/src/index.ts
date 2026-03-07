/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * @module langium
 ******************************************************************************/

// Re-export everything from core and chevrotain packages
export * from 'langium-core';
export * from 'langium-chevrotain';

// Explicit named exports from default-module override the core-only versions
// from langium-core (explicit exports take precedence over export * wildcards).
// The meta-package versions include Chevrotain services for backward compatibility.
export { createDefaultCoreModule, createDefaultSharedCoreModule } from './default-module.js';
export type { DefaultCoreModuleContext, DefaultSharedCoreModuleContext } from './default-module.js';

// Override RegExpUtils to include Chevrotain-specific functions (getTerminalParts, etc.)
export { RegExpUtils } from './utils-override.js';

// Side-effect import: registers the grammar services factory
import './default-module.js';
