/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AbstractElement, Action, InfixRule, ParserRule } from '../languages/generated/ast.js';
import type { DSLMethodOpts, ILexingError, IOrAlt, IParserErrorMessageProvider, IRecognitionException, IToken, TokenType } from './_chevrotain-types.js';
import type { LangiumCoreServices } from '../services.js';
import type { AstNode } from '../syntax-tree.js';
import type { Lexer } from './lexer.js';
import type { LexingReport } from './token-builder.js';

/**
 * After the Chevrotain → tree-sitter migration (US-026/US-027), the legacy
 * Chevrotain-backed Langium parser is no longer the runtime parser. The
 * class hierarchy and exports below are preserved as stubs so that existing
 * imports continue to type-check and so that custom modules that override
 * specific services don't cascade-break compile errors. All runtime methods
 * throw — consumers should migrate to the tree-sitter pipeline
 * (`WasmLoader`, `IndexBuilder`, the `lsp/tree-sitter-*-provider.ts` LSP
 * providers).
 */

const REMOVED_MESSAGE = 'Chevrotain-based parser has been removed; use the tree-sitter pipeline (WasmLoader, IndexBuilder).';

export type ParseResult<T = AstNode> = {
    value: T,
    parserErrors: IRecognitionException[],
    lexerErrors: ILexingError[],
    lexerReport?: LexingReport
}

export const DatatypeSymbol = Symbol('Datatype');

type RuleResult = (args: Args) => any;
type Args = Record<string, boolean>;
type RuleImpl = (args: Args) => any;

/**
 * Base interface for all parsers. Mainly used by the `parser-builder-base.ts` to perform work on different kinds of parsers.
 */
export interface BaseParser {
    rule(rule: ParserRule | InfixRule, impl: RuleImpl): RuleResult;
    getRule(name: string): RuleResult | undefined;
    alternatives(idx: number, choices: Array<IOrAlt<any>>): void;
    optional(idx: number, callback: DSLMethodOpts<unknown>): void;
    many(idx: number, callback: DSLMethodOpts<unknown>): void;
    atLeastOne(idx: number, callback: DSLMethodOpts<unknown>): void;
    consume(idx: number, tokenType: TokenType, feature: AbstractElement): void;
    subrule(idx: number, rule: RuleResult, fragment: boolean, feature: AbstractElement, args: Args): void;
    action($type: string, action: Action): void;
    isRecording(): boolean;
    finalize(): void;
}

export abstract class AbstractLangiumParser implements BaseParser {

    protected readonly lexer: Lexer;
    protected _unorderedGroups: Map<string, boolean[]> = new Map<string, boolean[]>();
    protected allRules = new Map<string, RuleResult>();
    protected mainRule!: RuleResult;

    constructor(services: LangiumCoreServices, _incomplete: boolean) {
        this.lexer = services.parser.Lexer;
    }

    alternatives(_idx: number, _choices: Array<IOrAlt<any>>): void {
        throw new Error(REMOVED_MESSAGE);
    }

    optional(_idx: number, _callback: DSLMethodOpts<unknown>): void {
        throw new Error(REMOVED_MESSAGE);
    }

    many(_idx: number, _callback: DSLMethodOpts<unknown>): void {
        throw new Error(REMOVED_MESSAGE);
    }

    atLeastOne(_idx: number, _callback: DSLMethodOpts<unknown>): void {
        throw new Error(REMOVED_MESSAGE);
    }

    abstract rule(rule: ParserRule | InfixRule, impl: RuleImpl): RuleResult;
    abstract consume(idx: number, tokenType: TokenType, feature: AbstractElement): void;
    abstract subrule(idx: number, rule: RuleResult, fragment: boolean, feature: AbstractElement, args: Args): void;
    abstract action($type: string, action: Action): void;

    getRule(name: string): RuleResult | undefined {
        return this.allRules.get(name);
    }

    isRecording(): boolean {
        return false;
    }

    get unorderedGroups(): Map<string, boolean[]> {
        return this._unorderedGroups;
    }

    getRuleStack(): number[] {
        return [];
    }

    finalize(): void {
        // No-op for stub.
    }
}

export interface ParserOptions {
    rule?: string
}

export class LangiumParser extends AbstractLangiumParser {

    constructor(services: LangiumCoreServices) {
        super(services, false);
    }

    rule(_rule: ParserRule | InfixRule, _impl: RuleImpl): RuleResult {
        throw new Error(REMOVED_MESSAGE);
    }

    parse<T extends AstNode = AstNode>(_input: string, _options: ParserOptions = {}): ParseResult<T> {
        throw new Error(REMOVED_MESSAGE);
    }

    consume(_idx: number, _tokenType: TokenType, _feature: AbstractElement): void {
        throw new Error(REMOVED_MESSAGE);
    }

    subrule(_idx: number, _rule: RuleResult, _fragment: boolean, _feature: AbstractElement, _args: Args): void {
        throw new Error(REMOVED_MESSAGE);
    }

    action(_$type: string, _action: Action): void {
        throw new Error(REMOVED_MESSAGE);
    }

    get definitionErrors(): IParserDefinitionError[] {
        return [];
    }
}

export interface IParserDefinitionError {
    message: string
    type: number
    ruleName?: string
}

export abstract class AbstractParserErrorMessageProvider implements IParserErrorMessageProvider {

    buildMismatchTokenMessage(_options: {
        expected: TokenType
        actual: IToken
        previous: IToken
        ruleName: string
    }): string {
        return 'Mismatched token';
    }

    buildNotAllInputParsedMessage(_options: {
        firstRedundant: IToken
        ruleName: string
    }): string {
        return 'Not all input parsed';
    }

    buildNoViableAltMessage(_options: {
        expectedPathsPerAlt: TokenType[][][]
        actual: IToken[]
        previous: IToken
        customUserDescription: string
        ruleName: string
    }): string {
        return 'No viable alternative';
    }

    buildEarlyExitMessage(_options: {
        expectedIterationPaths: TokenType[][]
        actual: IToken[]
        previous: IToken
        customUserDescription: string
        ruleName: string
    }): string {
        return 'Early exit';
    }
}

export class LangiumParserErrorMessageProvider extends AbstractParserErrorMessageProvider {

    override buildMismatchTokenMessage({ expected, actual }: {
        expected: TokenType
        actual: IToken
        previous: IToken
        ruleName: string
    }): string {
        const expectedMsg = expected.name.endsWith(':KW')
            ? `keyword '${expected.name.substring(0, expected.name.length - 3)}'`
            : `token of type '${expected.name}'`;
        return `Expecting ${expectedMsg} but found \`${actual.image}\`.`;
    }

    override buildNotAllInputParsedMessage({ firstRedundant }: {
        firstRedundant: IToken
        ruleName: string
    }): string {
        return `Expecting end of file but found \`${firstRedundant.image}\`.`;
    }
}

export interface CompletionParserResult {
    tokens: IToken[]
    elementStack: AbstractElement[]
    tokenIndex: number
}

export class LangiumCompletionParser extends AbstractLangiumParser {

    constructor(services: LangiumCoreServices) {
        super(services, true);
    }

    rule(_rule: ParserRule | InfixRule, _impl: RuleImpl): RuleResult {
        throw new Error(REMOVED_MESSAGE);
    }

    consume(_idx: number, _tokenType: TokenType, _feature: AbstractElement): void {
        throw new Error(REMOVED_MESSAGE);
    }

    subrule(_idx: number, _rule: RuleResult, _fragment: boolean, _feature: AbstractElement, _args: Args): void {
        throw new Error(REMOVED_MESSAGE);
    }

    action(_$type: string, _action: Action): void {
        // NOOP
    }

    construct(): unknown {
        return undefined;
    }

    parse(_input: string): CompletionParserResult {
        throw new Error(REMOVED_MESSAGE);
    }
}
