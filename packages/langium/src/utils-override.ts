/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

// Merge the core RegExpUtils namespace with Chevrotain-specific functions
// so that downstream code can use RegExpUtils.getTerminalParts() etc.
import { RegExpUtils as CoreRegExpUtils } from 'langium-core';
import { getTerminalParts, partialMatches, partialRegExp } from 'langium-chevrotain';

export const RegExpUtils = {
    ...CoreRegExpUtils,
    getTerminalParts,
    partialMatches,
    partialRegExp
};
