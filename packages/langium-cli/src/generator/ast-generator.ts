/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { expandToNode, joinToNode, toString } from 'langium/generate';
import type { ParsedGrammarSet } from '../grammar-parser/grammar-parser.js';
import {
    collectTypes, collectFields, getTypeHierarchy, getTerminals,
    getRuleName, isHiddenTerminal, getTerminalPattern,
    getRuleReturnType, resolveRuleRef,
    type TypeInfo,
} from '../grammar-parser/grammar-queries.js';
import type { LangiumConfig } from '../package-types.js';
import { generatedHeader } from './node-util.js';

export function generateAst(set: ParsedGrammarSet, config: LangiumConfig): string {
    const types = collectTypes(set);
    const hierarchy = getTypeHierarchy(set);
    const typeNames = types.map(t => t.name).sort();

    const node = expandToNode`
        ${generatedHeader}

        /* eslint-disable */
        import type * as langium from 'langium';

        ${generateTerminals(set)}

        ${joinToNode(types.filter(t => t.isInterface), t => {
            const fields = collectFields(t.name, set);
            const supers = (hierarchy.get(t.name) ?? []).join(', ');
            return expandToNode`
                export interface ${t.name}${supers ? ` extends ${supers}` : ''} {
                    readonly $type: '${t.name}';
                    ${joinToNode(fields, f => {
                        const ftype = mapFieldType(f.type, f.isRef, set);
                        const arr = f.operator === '+=' ? '[]' : '';
                        const opt = f.operator === '?=' ? '?' : '';
                        return `${f.name}${opt}: ${ftype}${arr};`;
                    }, { appendNewLineIfNotEmpty: true })}
                }
            `.appendNewLine();
        })}

        ${joinToNode(types.filter(t => !t.isInterface), t => {
            const fields = collectFields(t.name, set);
            if (fields.length === 0) return expandToNode`export type ${t.name} = langium.AstNode & { readonly $type: '${t.name}' };`.appendNewLine();
            return expandToNode`
                export interface ${t.name} extends langium.AstNode {
                    readonly $type: '${t.name}';
                    ${joinToNode(fields, f => {
                        const ftype = mapFieldType(f.type, f.isRef, set);
                        const arr = f.operator === '+=' ? '[]' : '';
                        const opt = f.operator === '?=' ? '?' : '';
                        return `${f.name}${opt}: ${ftype}${arr};`;
                    }, { appendNewLineIfNotEmpty: true })}
                }
            `.appendNewLine();
        })}

        export type ${config.projectName}AstType = ${typeNames.map(n => `'${n}'`).join(' | ')};

        export class ${config.projectName}AstReflection extends langium.AbstractAstReflection {
            getAllTypes(): string[] {
                return [${typeNames.map(n => `'${n}'`).join(', ')}];
            }
            protected override computeIsSubtype(subtype: string, supertype: string): boolean {
                ${generateSubtypeChecks(types, hierarchy)}
                return false;
            }
        }
    `.appendNewLine();

    return toString(node);
}

function generateTerminals(set: ParsedGrammarSet): string {
    const lines: string[] = [];
    for (const root of set.values()) {
        for (const t of getTerminals(root)) {
            if (isHiddenTerminal(t)) continue;
            const name = getRuleName(t);
            const pattern = getTerminalPattern(t) ?? '/.*/';
            lines.push(`export const ${name}Terminal = ${pattern};`);
        }
    }
    return lines.join('\n');
}

function mapFieldType(typeText: string, isRef: boolean, set: ParsedGrammarSet): string {
    if (isRef) return `langium.Reference<${typeText}>`;
    const primitives: Record<string, string> = {
        string: 'string', number: 'number', boolean: 'boolean', Date: 'Date', bigint: 'bigint',
    };
    if (typeText in primitives) return primitives[typeText];
    const ruleNode = resolveRuleRef(typeText, set);
    if (ruleNode) {
        if (ruleNode.type === 'terminal_rule') {
            const ret = getRuleReturnType(ruleNode);
            return ret && ret in primitives ? primitives[ret] : 'string';
        }
        const ret = getRuleReturnType(ruleNode);
        if (ret && ret in primitives) return primitives[ret];
    }
    return typeText;
}

function generateSubtypeChecks(types: TypeInfo[], hierarchy: Map<string, string[]>): string {
    const lines: string[] = [];
    for (const t of types) {
        const supers = hierarchy.get(t.name) ?? [];
        if (supers.length > 0) {
            lines.push(
                `if (subtype === '${t.name}') return ${supers.map(s => `supertype === '${s}'`).join(' || ')};`
            );
        }
    }
    return lines.join('\n            ');
}
