/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

/**
 * Best-effort conversion of simple JavaScript regex patterns to Lezer token syntax.
 *
 * Only handles a subset of common patterns used in Langium grammars.
 * Complex features (backreferences, lookahead/lookbehind) are rejected with
 * diagnostics suggesting the user rewrite using string body syntax.
 */

export interface RegexConversionResult {
    /** The converted Lezer token syntax, or undefined if conversion failed. */
    lezerSyntax?: string;
    /** Error message if conversion was not possible. */
    error?: string;
}

/**
 * Checks if a regex pattern uses features unsupported by Lezer.
 */
export function validateRegexForLezer(pattern: string): string | undefined {
    // Check for backreferences
    if (/\\[1-9]/.test(pattern)) {
        return 'uses backreferences unsupported by Lezer';
    }
    // Check for lookahead/lookbehind
    if (/\(\?[=!<]/.test(pattern)) {
        return 'uses lookahead/lookbehind unsupported by Lezer';
    }
    // Check for named groups
    if (/\(\?<[a-zA-Z]/.test(pattern)) {
        return 'uses named groups unsupported by Lezer';
    }
    // Check for atomic groups
    if (/\(\?>/.test(pattern)) {
        return 'uses atomic groups unsupported by Lezer';
    }
    return undefined;
}

/**
 * Convert a simple JavaScript regex pattern to Lezer token syntax.
 *
 * Handles:
 * - `\s` → `@whitespace`
 * - `\d` → `@digit`
 * - `\w` → `$[a-zA-Z0-9_]`
 * - `.` → `_` (Lezer wildcard)
 * - Character classes `[...]` → `$[...]`
 * - Negated character classes `[^...]` → `![...]`
 * - Quantifiers `*`, `+`, `?`
 * - Groups `(...)`
 * - Alternation `|`
 * - Simple escapes `\\`, `\/`
 * - Literal strings
 */
export function convertRegexToLezer(pattern: string): RegexConversionResult {
    const validationError = validateRegexForLezer(pattern);
    if (validationError) {
        return { error: validationError };
    }

    try {
        const lezerSyntax = translatePattern(pattern, 0).result;
        return { lezerSyntax };
    } catch (e) {
        return { error: `Failed to convert regex: ${e instanceof Error ? e.message : String(e)}` };
    }
}

interface TranslateResult {
    result: string;
    consumed: number;
}

function translatePattern(pattern: string, start: number): TranslateResult {
    const parts: string[] = [];
    let i = start;

    while (i < pattern.length) {
        const ch = pattern[i];

        if (ch === ')') {
            // End of group — return to caller
            break;
        }

        if (ch === '|') {
            // Alternation
            parts.push(' | ');
            i++;
            continue;
        }

        if (ch === '(') {
            // Non-capturing group (?:...) or plain group
            let groupStart = i + 1;
            if (pattern[i + 1] === '?' && pattern[i + 2] === ':') {
                groupStart = i + 3;
            }
            const inner = translatePattern(pattern, groupStart);
            let groupContent = `(${inner.result})`;
            i = groupStart + inner.consumed;
            if (pattern[i] === ')') i++; // skip closing paren

            // Check for quantifier
            if (i < pattern.length && isQuantifier(pattern[i])) {
                groupContent += pattern[i];
                i++;
            }
            parts.push(groupContent);
            continue;
        }

        if (ch === '[') {
            // Character class
            const classResult = translateCharClass(pattern, i);
            let classContent = classResult.result;
            i = i + classResult.consumed;

            // Check for quantifier
            if (i < pattern.length && isQuantifier(pattern[i])) {
                classContent += pattern[i];
                i++;
            }
            parts.push(classContent);
            continue;
        }

        if (ch === '\\') {
            // Escape sequence
            const escResult = translateEscape(pattern, i);
            let escContent = escResult.result;
            i = i + escResult.consumed;

            // Check for quantifier
            if (i < pattern.length && isQuantifier(pattern[i])) {
                escContent += pattern[i];
                i++;
            }
            parts.push(escContent);
            continue;
        }

        if (ch === '.') {
            // Wildcard
            let wildcardContent = '_';
            i++;
            if (i < pattern.length && isQuantifier(pattern[i])) {
                wildcardContent += pattern[i];
                i++;
            }
            parts.push(wildcardContent);
            continue;
        }

        if (ch === '^' || ch === '$') {
            // Anchors — skip (Lezer tokens are implicitly anchored)
            i++;
            continue;
        }

        // Literal character
        let literal = escapeLiteralForLezer(ch);
        i++;
        if (i < pattern.length && isQuantifier(pattern[i])) {
            literal += pattern[i];
            i++;
        }
        parts.push(literal);
    }

    return { result: parts.join(' '), consumed: i - start };
}

function translateCharClass(pattern: string, start: number): TranslateResult {
    // pattern[start] === '['
    let i = start + 1;
    const negated = pattern[i] === '^';
    if (negated) i++;

    let content = '';
    while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') {
            // Handle escape within character class
            const esc = translateCharClassEscape(pattern, i);
            content += esc.result;
            i += esc.consumed;
        } else {
            content += pattern[i];
            i++;
        }
    }
    if (pattern[i] === ']') i++; // skip closing bracket

    // Deduplicate the character class content to avoid overlapping ranges
    // Parse ranges (x-y) and individual chars, then reassemble without duplicates
    content = deduplicateCharClassContent(content);

    // Lezer: $[...] for positive class, ![...] for negated class
    const prefix = negated ? '!' : '$';
    return { result: `${prefix}[${content}]`, consumed: i - start };
}

/**
 * Deduplicate character class content to avoid Lezer's "Overlapping character range" error.
 * Parses ranges (a-z) and individual characters, removes duplicates, and reassembles.
 */
function deduplicateCharClassContent(content: string): string {
    const chars = new Set<number>();
    let i = 0;
    while (i < content.length) {
        if (content[i] === '\\' && i + 1 < content.length) {
            // Escape sequence in class (e.g., \n, \t)
            const ch = content[i + 1];
            switch (ch) {
                case 'n': chars.add(10); break;
                case 'r': chars.add(13); break;
                case 't': chars.add(9); break;
                default: chars.add(ch.charCodeAt(0));
            }
            i += 2;
        } else if (i + 2 < content.length && content[i + 1] === '-') {
            // Range a-z
            const from = content.charCodeAt(i);
            const to = content.charCodeAt(i + 2);
            for (let c = from; c <= to; c++) {
                chars.add(c);
            }
            i += 3;
        } else {
            chars.add(content.charCodeAt(i));
            i++;
        }
    }

    // Reassemble into compact ranges
    const sorted = Array.from(chars).sort((a, b) => a - b);
    if (sorted.length === 0) return content;

    const parts: string[] = [];
    let rangeStart = sorted[0];
    let rangeEnd = sorted[0];

    for (let j = 1; j < sorted.length; j++) {
        if (sorted[j] === rangeEnd + 1) {
            rangeEnd = sorted[j];
        } else {
            parts.push(formatRange(rangeStart, rangeEnd));
            rangeStart = sorted[j];
            rangeEnd = sorted[j];
        }
    }
    parts.push(formatRange(rangeStart, rangeEnd));

    return parts.join('');
}

function formatRange(from: number, to: number): string {
    const fromCh = escapeCharClassChar(from);
    if (from === to) return fromCh;
    const toCh = escapeCharClassChar(to);
    if (to === from + 1) return fromCh + toCh;
    return `${fromCh}-${toCh}`;
}

function translateEscape(pattern: string, start: number): TranslateResult {
    const next = pattern[start + 1];
    switch (next) {
        case 's': return { result: '@whitespace', consumed: 2 };
        case 'S': return { result: '![ \\t\\n\\r]', consumed: 2 };
        case 'd': return { result: '@digit', consumed: 2 };
        case 'D': return { result: '![0-9]', consumed: 2 };
        case 'w': return { result: '$[a-zA-Z0-9_]', consumed: 2 };
        case 'W': return { result: '![a-zA-Z0-9_]', consumed: 2 };
        case 'n': return { result: '"\\n"', consumed: 2 };
        case 'r': return { result: '"\\r"', consumed: 2 };
        case 't': return { result: '"\\t"', consumed: 2 };
        case '\\': return { result: '"\\\\"', consumed: 2 };
        case '/': return { result: '"/"', consumed: 2 };
        default:
            // Literal escape — pass through as quoted
            return { result: `"${next}"`, consumed: 2 };
    }
}

function translateCharClassEscape(pattern: string, start: number): TranslateResult {
    const next = pattern[start + 1];
    switch (next) {
        case 'w': return { result: 'a-zA-Z0-9_', consumed: 2 };
        case 'W': return { result: '\\x00-\\x2F\\x3A-\\x40\\x5B-\\x60\\x7B-\\x7F', consumed: 2 };
        case 'd': return { result: '0-9', consumed: 2 };
        case 'D': return { result: '\\x00-\\x2F\\x3A-\\x7F', consumed: 2 };
        case 's': return { result: ' \\t\\n\\r', consumed: 2 };
        case 'S': return { result: '!-~', consumed: 2 };
        case 'n': return { result: '\\n', consumed: 2 };
        case 'r': return { result: '\\r', consumed: 2 };
        case 't': return { result: '\\t', consumed: 2 };
        case '\\': return { result: '\\\\', consumed: 2 };
        case ']': return { result: '\\]', consumed: 2 };
        default: return { result: next, consumed: 2 };
    }
}

function isQuantifier(ch: string): boolean {
    return ch === '*' || ch === '+' || ch === '?';
}

function escapeLiteralForLezer(ch: string): string {
    // Characters that need quoting in Lezer grammar
    if (/[a-zA-Z0-9_]/.test(ch)) {
        return `"${ch}"`;
    }
    return `"${ch}"`;
}

function escapeCharClassChar(code: number): string {
    switch (code) {
        case 9: return '\\t';
        case 10: return '\\n';
        case 13: return '\\r';
        case 92: return '\\\\';
        case 93: return '\\]';
        case 45: return '\\-';
        default: {
            const ch = String.fromCharCode(code);
            if (code >= 32 && code <= 126) return ch;
            return `\\x${code.toString(16).padStart(2, '0')}`;
        }
    }
}
