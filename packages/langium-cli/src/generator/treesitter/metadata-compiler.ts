/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { expandToNode, joinToNode, toString } from 'langium/generate';
import type { ParsedGrammarSet } from '../../grammar-parser/grammar-parser.js';
import { collectFields, collectTypes } from '../../grammar-parser/grammar-queries.js';
import { generatedHeader } from '../node-util.js';

export function compileMetadata(set: ParsedGrammarSet): string {
    const types = collectTypes(set).filter(t => !t.isInterface);

    const node = expandToNode`
        ${generatedHeader}

        import type { GrammarMetadata } from 'langium/generate';

        export const GRAMMAR_METADATA: GrammarMetadata = {
            version: '1.0',
            nodes: {
                ${joinToNode(types, t => {
                    const fields = collectFields(t.name, set);
                    return expandToNode`
                        '${t.name}': {
                            nodeType: '${t.name}',
                            fields: [
                                ${joinToNode(fields, f => `{ name: '${f.name}', operator: '${f.operator}', isRef: ${f.isRef} },`, { appendNewLineIfNotEmpty: true })}
                            ],
                        },
                    `.appendNewLine();
                })}
            },
            extras: [],
        };
    `.appendNewLine();

    return toString(node);
}
