/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

export const NEWLINE_REGEXP = /\r?\n/gm;

/**
 * After the Chevrotain → tree-sitter migration (US-026/US-027), the
 * `@chevrotain/regexp-to-ast`-based start/end heuristic for terminal tokens
 * is no longer used. The exports remain so existing callers continue to
 * compile; they now return safe defaults.
 */
export function getTerminalParts(_regexp: RegExp | string): Array<{ start: string, end: string }> {
    return [];
}

/**
 * Heuristic check: does the regex match a newline?
 * Falls back to a literal `\n` test (no AST traversal) after the chevrotain
 * regex parser was removed.
 */
export function isMultilineComment(regexp: RegExp | string): boolean {
    try {
        const re = typeof regexp === 'string' ? new RegExp(regexp) : regexp;
        return re.test('\n');
    } catch {
        return false;
    }
}

/**
 * A set of all characters that are considered whitespace by the '\s' RegExp character class.
 * Taken from [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Character_classes).
 */
export const whitespaceCharacters = (
    '\f\n\r\t\v           ' +
    '    　﻿').split('');

export function isWhitespace(value: RegExp | string): boolean {
    const regexp = typeof value === 'string' ? new RegExp(value) : value;
    return whitespaceCharacters.some((ws) => regexp.test(ws));
}

export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Determines whether the given input has a partial match with the specified regex.
 * @param regex The regex to partially match against
 * @param input The input string
 * @returns Whether any match exists.
 */
export function partialMatches(regex: RegExp | string, input: string): boolean {
    const partial = partialRegExp(regex);
    const match = input.match(partial);
    return !!match && match[0].length > 0;
}

/**
 * Builds a partial regex from the input regex. A partial regex is able to match incomplete input strings. E.g.
 * a partial regex constructed from `/ab/` is able to match the string `a` without needing a following `b` character. However it won't match `b` alone.
 * @param regex The input regex to be converted.
 * @returns A partial regex constructed from the input regex.
 */
export function partialRegExp(regex: RegExp | string): RegExp {
    if (typeof regex === 'string') {
        regex = new RegExp(regex);
    }
    const re = regex, source = regex.source;
    let i = 0;

    function process() {
        let result = '',
            tmp;

        function appendRaw(nbChars: number) {
            result += source.substr(i, nbChars);
            i += nbChars;
        }

        function appendOptional(nbChars: number) {
            result += '(?:' + source.substr(i, nbChars) + '|$)';
            i += nbChars;
        }

        while (i < source.length) {
            switch (source[i]) {
                case '\\':
                    switch (source[i + 1]) {
                        case 'c':
                            appendOptional(3);
                            break;
                        case 'x':
                            appendOptional(4);
                            break;
                        case 'u':
                            if (re.unicode) {
                                if (source[i + 2] === '{') {
                                    appendOptional(source.indexOf('}', i) - i + 1);
                                } else {
                                    appendOptional(6);
                                }
                            } else {
                                appendOptional(2);
                            }
                            break;
                        case 'p':
                        case 'P':
                            if (re.unicode) {
                                appendOptional(source.indexOf('}', i) - i + 1);
                            } else {
                                appendOptional(2);
                            }
                            break;
                        case 'k':
                            appendOptional(source.indexOf('>', i) - i + 1);
                            break;
                        default:
                            appendOptional(2);
                            break;
                    }
                    break;

                case '[':
                    tmp = /\[(?:\\.|.)*?\]/g;
                    tmp.lastIndex = i;
                    tmp = tmp.exec(source) || [];
                    appendOptional(tmp[0].length);
                    break;

                case '|':
                case '^':
                case '$':
                case '*':
                case '+':
                case '?':
                    appendRaw(1);
                    break;
                case '{':
                    tmp = /\{\d+,?\d*\}/g;
                    tmp.lastIndex = i;
                    tmp = tmp.exec(source);
                    if (tmp) {
                        appendRaw(tmp[0].length);
                    } else {
                        appendOptional(1);
                    }
                    break;
                case '(':
                    if (source[i + 1] === '?') {
                        switch (source[i + 2]) {
                            case ':':
                                result += '(?:';
                                i += 3;
                                result += process() + '|$)';
                                break;
                            case '=':
                                result += '(?=';
                                i += 3;
                                result += process() + ')';
                                break;
                            case '!':
                                tmp = i;
                                i += 3;
                                process();
                                result += source.substr(tmp, i - tmp);
                                break;
                            case '<':
                                switch (source[i + 3]) {
                                    case '=':
                                    case '!':
                                        tmp = i;
                                        i += 4;
                                        process();
                                        result += source.substr(tmp, i - tmp);
                                        break;
                                    default:
                                        appendRaw(source.indexOf('>', i) - i + 1);
                                        result += process() + '|$)';
                                        break;
                                }
                                break;
                        }
                    } else {
                        appendRaw(1);
                        result += process() + '|$)';
                    }
                    break;
                case ')':
                    ++i;
                    return result;
                default:
                    appendOptional(1);
                    break;
            }
        }

        return result;
    }

    return new RegExp(process(), regex.flags);
}
