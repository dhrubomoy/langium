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

    // Lezer: $[...] for positive class, ![...] for negated class
    const prefix = negated ? '!' : '$';
    return { result: `${prefix}[${content}]`, consumed: i - start };
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
