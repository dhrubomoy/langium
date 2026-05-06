/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { ParsedGrammarSet } from '../grammar-parser/grammar-parser.js';
import { collectFields, collectTypes } from '../grammar-parser/grammar-queries.js';

export function generateTypesFile(set: ParsedGrammarSet): string {
    const types = collectTypes(set);

    const blocks = types.map(t => {
        const fields = collectFields(t.name, set);
        if (t.isInterface || fields.length > 0) {
            const fieldStr = fields.map(f => {
                const opt = f.operator === '?=' ? '?' : '';
                const arr = f.operator === '+=' ? '[]' : '';
                return `    ${f.name}${opt}: ${f.type}${arr};`;
            }).join('\n');
            return `export interface ${t.name} {\n${fieldStr}\n}`;
        }
        const union = fields.map(f => f.type).join(' | ') || 'never';
        return `export type ${t.name} = ${union};`;
    });

    return blocks.join('\n\n') + '\n';
}
