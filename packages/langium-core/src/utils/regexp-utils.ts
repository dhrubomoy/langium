/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

export const NEWLINE_REGEXP = /\r?\n/gm;

/**
 * A set of all characters that are considered whitespace by the '\s' RegExp character class.
 * Taken from [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Character_classes).
 */
export const whitespaceCharacters = (
    '\f\n\r\t\v\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007' +
    '\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff').split('');

export function isWhitespace(value: RegExp | string): boolean {
    const regexp = typeof value === 'string' ? new RegExp(value) : value;
    return whitespaceCharacters.some((ws) => regexp.test(ws));
}

export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Determines whether the given regex pattern can match across multiple lines,
 * i.e., whether any part of the pattern can match a newline character.
 *
 * This is a core-safe implementation that analyzes the regex source string
 * without depending on Chevrotain's regexp-to-ast parser.
 */
export function isMultilineComment(regexp: RegExp | string): boolean {
    try {
        if (typeof regexp === 'string') {
            regexp = new RegExp(regexp);
        }
        const source = regexp.source;
        const flags = regexp.flags;

        let i = 0;
        while (i < source.length) {
            const ch = source[i];
            if (ch === '[') {
                // Character class — find the closing bracket
                let j = i + 1;
                if (j < source.length && source[j] === '^') j++;
                // Handle ] as first char in class (not closing)
                if (j < source.length && source[j] === ']') j++;
                while (j < source.length && source[j] !== ']') {
                    if (source[j] === '\\') j++; // skip escaped char
                    j++;
                }
                const classStr = source.substring(i, j + 1);
                try {
                    if (new RegExp(classStr).test('\n')) {
                        return true;
                    }
                } catch { /* ignore malformed class */ }
                i = j + 1;
            } else if (ch === '\\') {
                // Escape sequence outside a character class
                const next = source[i + 1];
                if (next === 'n' || next === 's') {
                    // \n matches newline; \s matches whitespace including newline
                    return true;
                }
                i += 2;
            } else if (ch === '.' && flags.includes('s')) {
                // dotAll flag: . matches newline
                return true;
            } else if (ch.charCodeAt(0) === 0x0A) {
                // Literal newline character in pattern source
                return true;
            } else {
                i++;
            }
        }
        return false;
    } catch {
        return false;
    }
}
