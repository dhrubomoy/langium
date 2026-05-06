/******************************************************************************
 * Copyright 2021-2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
******************************************************************************/
import type { ParsedGrammarSet, SyntaxNode } from '../../grammar-parser/grammar-parser.js';
import {
    getRules, getTerminals, getRuleName, getTerminalPattern,
    isHiddenTerminal,
} from '../../grammar-parser/grammar-queries.js';
import { collectKeywords } from '../langium-util.js';
import type { LangiumLanguageConfig } from '../../package-types.js';

/* eslint-disable dot-notation */

interface TextMateGrammar {
    repository: Repository;
    readonly scopeName: string;
    readonly patterns: Pattern[];
    readonly injections?: { [expression: string]: Pattern };
    readonly injectionSelector?: string;
    readonly fileTypes?: string[];
    readonly name?: string;
    readonly firstLineMatch?: string;
}

interface Repository {
    [name: string]: Pattern;
}

interface Pattern {
    id?: number;
    readonly include?: string;
    readonly name?: string;
    readonly contentName?: string;
    readonly match?: string;
    readonly captures?: Captures;
    readonly begin?: string;
    readonly beginCaptures?: Captures;
    readonly end?: string;
    readonly endCaptures?: Captures;
    readonly while?: string;
    readonly whileCaptures?: Captures;
    readonly patterns?: Pattern[];
    readonly repository?: Repository;
    readonly applyEndPatternLast?: boolean;
}

interface Captures {
    [captureId: string]: Pattern;
}

export function generateTextMate(set: ParsedGrammarSet, config: LangiumLanguageConfig): string {
    const json: TextMateGrammar = {
        name: config.id,
        scopeName: `source.${config.id}`,
        fileTypes: config.fileExtensions ?? [],
        patterns: getPatterns(set, config),
        repository: getRepository(set, config)
    };

    return JSON.stringify(json, null, 2) + '\n';
}

function getPatterns(set: ParsedGrammarSet, config: LangiumLanguageConfig): Pattern[] {
    const patterns: Pattern[] = [];
    patterns.push({
        include: '#comments'
    });
    patterns.push(getControlKeywords(set, config));
    patterns.push(...getStringPatterns(set, config));
    return patterns;
}

function getRepository(set: ParsedGrammarSet, config: LangiumLanguageConfig): Repository {
    const repository: Repository = {};
    const commentPatterns: Pattern[] = [];
    let stringEscapePattern: Pattern | undefined;
    for (const root of set.values()) {
        for (const rule of [...getRules(root), ...getTerminals(root)]) {
            if (rule.type !== 'terminal_rule') continue;
            if (isCommentTerminal(rule)) {
                const parts = getTerminalParts(terminalRegex(rule));
                for (const part of parts) {
                    if (part.end) {
                        commentPatterns.push({
                            'name': `comment.block.${config.id}`,
                            'begin': part.start,
                            'beginCaptures': {
                                '0': {
                                    'name': `punctuation.definition.comment.${config.id}`
                                }
                            },
                            'end': part.end,
                            'endCaptures': {
                                '0': {
                                    'name': `punctuation.definition.comment.${config.id}`
                                }
                            }
                        });
                    } else {
                        commentPatterns.push({
                            'begin': part.start,
                            'beginCaptures': {
                                '1': {
                                    'name': `punctuation.whitespace.comment.leading.${config.id}`
                                }
                            },
                            'end': '(?=$)',
                            'name': `comment.line.${config.id}`
                        });
                    }
                }
            } else if (getRuleName(rule).toLowerCase() === 'string') {
                stringEscapePattern = {
                    'name': `constant.character.escape.${config.id}`,
                    'match': '\\\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|u\\{[0-9A-Fa-f]+\\}|[0-2][0-7]{0,2}|3[0-6][0-7]?|37[0-7]?|[4-7][0-7]?|.|$)'
                };
            }
        }
    }

    if (commentPatterns.length > 0) {
        repository['comments'] = {
            'patterns': commentPatterns
        };
    }
    if (stringEscapePattern) {
        repository['string-character-escape'] = stringEscapePattern;
    }
    return repository;
}

function getControlKeywords(set: ParsedGrammarSet, pack: LangiumLanguageConfig): Pattern {
    const regex = /[A-Za-z]/;
    const controlKeywords = collectKeywords(set).filter(kw => regex.test(kw));
    const groups = groupKeywords(controlKeywords);
    return {
        'name': `keyword.control.${pack.id}`,
        'match': `${pack.caseInsensitive ? '(?i)' : ''}${groups.join('|')}`
    };
}

function groupKeywords(keywords: string[]): string[] {
    const groups: {
        letter: string[],
        leftSpecial: string[],
        rightSpecial: string[],
        special: string[];
    } = { letter: [], leftSpecial: [], rightSpecial: [], special: [] };

    keywords.forEach(keyword => {
        const keywordPattern = escapeRegExp(keyword);
        if (/\w/.test(keyword[0])) {
            if (/\w/.test(keyword[keyword.length - 1])) {
                groups.letter.push(keywordPattern);
            } else {
                groups.rightSpecial.push(keywordPattern);
            }
        } else {
            if ((/\w/).test(keyword[keyword.length - 1])) {
                groups.leftSpecial.push(keywordPattern);
            } else {
                groups.special.push(keywordPattern);
            }
        }
    });

    const res = [];
    if (groups.letter.length) res.push(`\\b(${groups.letter.join('|')})\\b`);
    if (groups.leftSpecial.length) res.push(`\\B(${groups.leftSpecial.join('|')})\\b`);
    if (groups.rightSpecial.length) res.push(`\\b(${groups.rightSpecial.join('|')})\\B`);
    if (groups.special.length) res.push(`\\B(${groups.special.join('|')})\\B`);
    return res;
}

function getStringPatterns(set: ParsedGrammarSet, pack: LangiumLanguageConfig): Pattern[] {
    let stringTerminal: SyntaxNode | undefined;
    for (const root of set.values()) {
        for (const t of [...getRules(root), ...getTerminals(root)]) {
            if (t.type !== 'terminal_rule') continue;
            if (getRuleName(t).toLowerCase() === 'string') {
                stringTerminal = t;
                break;
            }
        }
        if (stringTerminal) break;
    }
    const stringPatterns: Pattern[] = [];
    if (stringTerminal) {
        const parts = getTerminalParts(terminalRegex(stringTerminal));
        for (const part of parts) {
            if (part.end) {
                stringPatterns.push({
                    'name': `string.quoted.${delimiterName(part.start)}.${pack.id}`,
                    'begin': part.start,
                    'end': part.end,
                    'patterns': [
                        {
                            'include': '#string-character-escape'
                        }
                    ]
                });
            }
        }
    }
    return stringPatterns;
}

function delimiterName(delimiter: string): string {
    if (delimiter === "'") {
        return 'single';
    } else if (delimiter === '"') {
        return 'double';
    } else if (delimiter === '`') {
        return 'backtick';
    } else {
        return 'delimiter';
    }
}

// ─── Local RegExp / terminal helpers (replacements for langium's RegExpUtils + GrammarUtils) ──

function terminalRegex(rule: SyntaxNode): RegExp {
    const pattern = getTerminalPattern(rule);
    if (!pattern) return new RegExp('');
    const inner = pattern.replace(/^\/|\/[a-z]*$/g, '');
    try {
        return new RegExp(inner);
    } catch {
        return new RegExp('');
    }
}

function isCommentTerminal(rule: SyntaxNode): boolean {
    if (!isHiddenTerminal(rule)) return false;
    return !isWhitespace(terminalRegex(rule));
}

const whitespaceCharacters = (
    '\f\n\r\t\v\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007' +
    '\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff').split('');

function isWhitespace(value: RegExp | string): boolean {
    const regexp = typeof value === 'string' ? safeRegExp(value) : value;
    if (!regexp) return false;
    return whitespaceCharacters.some(ws => regexp.test(ws));
}

function safeRegExp(src: string): RegExp | null {
    try { return new RegExp(src); } catch { return null; }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTerminalParts(regexp: RegExp | string): Array<{ start: string, end: string }> {
    const src = typeof regexp === 'string' ? regexp : regexp.source;
    const startMatch = src.match(/^(?:\\.)+/);
    if (!startMatch) return [];
    const endMatch = src.match(/(?:\\.)+$/);
    if (endMatch && startMatch.index !== endMatch.index) {
        return [{ start: startMatch[0], end: endMatch[0] }];
    }
    return [{ start: startMatch[0], end: '' }];
}
