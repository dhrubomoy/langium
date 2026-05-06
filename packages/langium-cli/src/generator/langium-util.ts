/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import chalk from 'chalk';
import type { SyntaxNode, ParsedGrammarSet } from '../grammar-parser/grammar-parser.js';
import { getRules, getTerminals, getRuleName, getTerminalPattern } from '../grammar-parser/grammar-queries.js';

//eslint-disable-next-line @typescript-eslint/no-explicit-any
export function log(level: 'log' | 'warn' | 'error', options: { watch?: boolean }, message: string, ...args: any[]): void {
    if (options.watch) {
        console[level](getTime() + message, ...args);
    } else {
        console[level](message, ...args);
    }
}

export function getTime(): string {
    const date = new Date();
    return `[${chalk.gray(`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`)}] `;
}

function pad(i: number): string { return i.toString().padStart(2, '0'); }

/** Collect all keyword string values (quoted literals) reachable from parser rules */
export function collectKeywords(set: ParsedGrammarSet): string[] {
    const keywords = new Set<string>();
    for (const root of set.values()) {
        for (const rule of getRules(root)) {
            const def = rule.childForFieldName('definition');
            if (def) walkKeywords(def, keywords);
        }
    }
    return Array.from(keywords).sort();
}

function walkKeywords(node: SyntaxNode, out: Set<string>): void {
    if (node.type === 'keyword') {
        const val = node.childForFieldName('value')?.text;
        if (val) out.add(val.replace(/^['"]|['"]$/g, ''));
        return;
    }
    for (const child of node.namedChildren) {
        if (!child) continue;
        walkKeywords(child, out);
    }
}

/** Collect terminal name → RegExp for all non-hidden terminals */
export function collectTerminalRegexps(set: ParsedGrammarSet): Record<string, RegExp> {
    const result: Record<string, RegExp> = {};
    for (const root of set.values()) {
        for (const t of getTerminals(root)) {
            const name = getRuleName(t);
            const pattern = getTerminalPattern(t);
            if (pattern) {
                try {
                    const inner = pattern.replace(/^\/|\/[a-z]*$/g, '');
                    result[name] = new RegExp(inner);
                } catch { /* skip invalid patterns */ }
            }
        }
    }
    return result;
}
