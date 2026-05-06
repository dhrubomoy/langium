/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { type Generated, expandToNode, joinToNode, toString } from 'langium/generate';
import type { ParsedGrammarSet, SyntaxNode } from '../../grammar-parser/grammar-parser.js';
import {
    getRules, getTerminals, getRuleName, getTerminalPattern,
    isHiddenTerminal,
} from '../../grammar-parser/grammar-queries.js';
import { collectKeywords } from '../langium-util.js';
import type { LangiumLanguageConfig } from '../../package-types.js';

/**
 * Monarch Language Definition, describes aspects & token categories of target language
 */
interface LanguageDefinition {
    readonly name: string;
    readonly keywords: string[];
    readonly operators: string[];
    readonly symbols: string[];
    readonly tokenPostfix: string;
}

/**
 * Monarch Tokenizer, consists of an object that defines states.
 */
interface Tokenizer {
    states: State[]
}

type StateName = string;

interface State {
    name: StateName
    rules: Array<Rule | State>
}

interface Rule {
    regex: RegExp | string;
    action: Action | Case[];
}

interface Case {
    guard: string;
    action: Action;
}

function isRule(obj: State | Rule): obj is Rule {
    return (obj as Rule).regex !== undefined && (obj as Rule).action !== undefined;
}

type Token = string;
type TokenClass = string;
type NextState = StateName | '@pop' | '@push';

interface Action {
    token?: Token
    tokenClass?: TokenClass
    next?: NextState
}

interface MonarchGrammar {
    readonly languageDefinition: LanguageDefinition;
    readonly tokenizer: Tokenizer;
}

/**
 * Generates a Monarch highlighting grammar file's contents from a parsed Langium grammar set
 */
export function generateMonarch(set: ParsedGrammarSet, config: LangiumLanguageConfig): string {
    const symbols = getSymbols(set);
    const bracketRegex = /[{}[\]()]/;
    const operators = symbols.filter(s => !bracketRegex.test(s));

    const monarchGrammar: MonarchGrammar = {
        languageDefinition: {
            name: config.id,
            keywords: getKeywords(set),
            operators,
            symbols,
            tokenPostfix: '.' + config.id,
        },
        tokenizer: {
            states: getTokenizerStates(set)
        }
    };

    return prettyPrint(monarchGrammar);
}

function getTokenizerStates(set: ParsedGrammarSet): State[] {
    const initialState: State = {
        name: 'initial',
        rules: getTerminalRules(set)
    };

    const whitespaceState: State = {
        name: 'whitespace',
        rules: getWhitespaceRules(set)
    };

    const commentState: State = {
        name: 'comment',
        rules: getCommentRules(set)
    };

    initialState.rules.push(whitespaceState);

    initialState.rules.push({
        regex: '@symbols',
        action: [
            {
                guard: '@operators',
                action: { token: 'operator' }
            },
            {
                guard: '@default',
                action: { token: '' }
            }
        ]
    });

    return [initialState, whitespaceState, commentState];
}

function prettyPrint(monarchGrammar: MonarchGrammar): string {
    const name = monarchGrammar.languageDefinition.name;
    const node = expandToNode`
        // Monarch syntax highlighting for the ${name} language.
        export default {
            ${prettyPrintLangDef(monarchGrammar.languageDefinition)}

            ${prettyPrintTokenizer(monarchGrammar.tokenizer)}
        };
    `.appendNewLine();

    return toString(node);
}

function genLanguageDefEntry(name: string, values: string[]): Generated {
    return expandToNode`
        ${name}: [
            ${ values.map(v => `'${v}'`).join(',') }
        ],
    `;
}

function prettyPrintLangDef(languageDef: LanguageDefinition): Generated {
    return expandToNode`
        ${genLanguageDefEntry('keywords', languageDef.keywords)}
        ${genLanguageDefEntry('operators', languageDef.operators)}
        ${/* special case, identify symbols via singular regex*/ undefined}
        symbols: ${new RegExp(languageDef.symbols.map(escapeRegExp).join('|')).toString()},
    `;
}

function prettyPrintTokenizer(tokenizer: Tokenizer): Generated {
    return expandToNode`
        tokenizer: {
            ${joinToNode(tokenizer.states, prettyPrintState, { appendNewLineIfNotEmpty: true})}
        }
    `;
}

function prettyPrintState(state: State): Generated {
    return expandToNode`
        ${state.name}: [
            ${joinToNode(state.rules, prettyPrintRule, { appendNewLineIfNotEmpty: true })}
        ],
    `;
}

function prettyPrintRule(ruleOrState: Rule | State): Generated {
    if (isRule(ruleOrState)) {
        const rulePatt = ruleOrState.regex instanceof RegExp ? ruleOrState.regex : new RegExp(ruleOrState.regex);
        return expandToNode`{ regex: ${rulePatt.toString()}, action: ${prettyPrintAction(ruleOrState.action)} },`;
    } else {
        return expandToNode`{ include: '@${ruleOrState.name}' },`;
    }
}

function prettyPrintAction(action: Action | Case[]): string {
    if (!Array.isArray(action)) {
        return JSON.stringify(action);
    } else {
        const prettyCases: string = action.map(c => `'${c.guard}': ` + prettyPrintAction(c.action)).join(', ');
        return '{ cases: { ' + prettyCases + ' }}';
    }
}

/**
 * Extracts a Monarch token name from a Langium terminal rule, using either name or `returns` type.
 */
function getMonarchTokenName(rule: SyntaxNode): string {
    const name = getRuleName(rule);
    if (name.toLowerCase() === 'string') {
        return 'string';
    }
    const ret = rule.childForFieldName('return_type')?.text;
    if (ret) return ret;
    return name;
}

function getWhitespaceRules(set: ParsedGrammarSet): Rule[] {
    const rules: Rule[] = [];
    for (const root of set.values()) {
        for (const t of [...getRules(root), ...getTerminals(root)]) {
            if (t.type !== 'terminal_rule') continue;
            const regex = terminalRegex(t);
            const isComment = isCommentTerminal(t);

            if (!isComment && !isWhitespace(regex)) {
                continue;
            }

            const tokenName = isComment ? 'comment' : 'white';
            const part = getTerminalParts(regex)[0];

            if (part && part.start !== '' && part.end !== '' && isComment) {
                rules.push({
                    regex: part.start,
                    action: { token: tokenName, next: '@' + tokenName }
                });
            } else {
                rules.push({
                    regex,
                    action: { token: tokenName }
                });
            }
        }
    }
    return rules;
}

function getCommentRules(set: ParsedGrammarSet): Rule[] {
    const rules: Rule[] = [];
    for (const root of set.values()) {
        for (const t of [...getRules(root), ...getTerminals(root)]) {
            if (t.type !== 'terminal_rule') continue;
            if (!isCommentTerminal(t)) continue;

            const tokenName = 'comment';
            const part = getTerminalParts(terminalRegex(t))[0];
            if (part && part.start !== '' && part.end !== '') {
                const start = part.start;
                const end = part.end;

                rules.push({
                    regex: `[^${start}]+`,
                    action: { token: tokenName }
                });

                rules.push({
                    regex: end,
                    action: { token: tokenName, next: '@pop' }
                });

                rules.push({
                    regex: `[${start}]`,
                    action: { token: tokenName }
                });
            }
        }
    }
    return rules;
}

function getTerminalRules(set: ParsedGrammarSet): Rule[] {
    const rules: Rule[] = [];
    const keywords = getKeywords(set);
    for (const root of set.values()) {
        for (const t of [...getRules(root), ...getTerminals(root)]) {
            if (t.type !== 'terminal_rule') continue;
            if (isCommentTerminal(t)) continue;
            const regex = terminalRegex(t);

            if (isWhitespace(regex)) {
                continue;
            }

            const tokenName = getMonarchTokenName(t);
            let action: Action | Case[] = { token: tokenName };

            if (keywords.some(keyword => regex.test(keyword))) {
                action = [
                    {
                        guard: '@keywords',
                        action: { token: 'keyword' }
                    },
                    {
                        guard: '@default',
                        action
                    }
                ];
            }

            rules.push({
                regex,
                action
            });
        }
    }
    return rules;
}

const KeywordRegex = /[A-Za-z]/;

function getKeywords(set: ParsedGrammarSet): string[] {
    return collectKeywords(set).filter(kw => KeywordRegex.test(kw));
}

function getSymbols(set: ParsedGrammarSet): string[] {
    return collectKeywords(set).filter(kw => !KeywordRegex.test(kw));
}

// ─── Local RegExp / terminal helpers (replacements for langium's RegExpUtils + GrammarUtils) ──

/** Compile the pattern of a terminal_rule SyntaxNode into a RegExp, stripping the `/.../flags` wrapper. */
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

/** A hidden terminal whose pattern is not whitespace is treated as a comment. */
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

/**
 * Extracts the leading and trailing literal-character sequences of a regex source.
 * Used to recognise multi-line comment delimiters such as `/\/\*...\*\//` → `{start:'/*', end:'*\/'}`.
 * Returns a single-element array when both ends contain literal escapes; otherwise an empty array.
 * Simpler than langium's chevrotain-based parser, but covers the cases monarch needs.
 */
function getTerminalParts(regexp: RegExp | string): Array<{ start: string, end: string }> {
    const src = typeof regexp === 'string' ? regexp : regexp.source;
    const startMatch = src.match(/^(?:\\.)+/);
    const endMatch = src.match(/(?:\\.)+$/);
    if (startMatch && endMatch && startMatch.index !== endMatch.index) {
        const decode = (s: string) => s.replace(/\\(.)/g, '$1');
        return [{ start: decode(startMatch[0]), end: decode(endMatch[0]) }];
    }
    return [];
}
