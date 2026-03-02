/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Grammar, LexError, ParseError, RootCstNode, ParseDiagnostic, AdapterParseResult, ExpectedToken, ParserAdapter, ParserAdapterConfig, CompletionParseData, CompletionBacktrackingInformation, SyntaxNode, CompletionRequest, CompletionResult } from 'langium-core';
import { wrapRootCstNode } from 'langium-core';
import type { LangiumChevrotainServices } from './chevrotain-services.js';
import { ChevrotainCompletion } from './chevrotain-completion.js';

/**
 * Parser adapter that wraps the existing Chevrotain-based LangiumParser.
 * Provides backward-compatible parsing through the new ParserAdapter interface.
 */
export class ChevrotainAdapter implements ParserAdapter {
    readonly name = 'chevrotain';
    readonly supportsIncremental = false;

    protected readonly services: LangiumChevrotainServices;
    private completion?: ChevrotainCompletion;

    constructor(services: LangiumChevrotainServices) {
        this.services = services;
    }

    getCompletionFeatures(request: CompletionRequest): CompletionResult[] {
        if (!this.completion) {
            this.completion = new ChevrotainCompletion(this.services);
        }
        return this.completion.getCompletionFeatures(request);
    }

    configure(_grammar: Grammar, _config?: ParserAdapterConfig): void {
        // No-op for Chevrotain — the parser is already configured via DI
        // (built by createLangiumParser during service initialization)
    }

    parse(text: string, entryRule?: string): AdapterParseResult {
        const parseResult = this.services.parser.LangiumParser.parse(text, { rule: entryRule });
        const rootCstNode = parseResult.value.$cstNode as RootCstNode | undefined;

        if (!rootCstNode) {
            throw new Error('Parse result has no CST root node');
        }

        const root = wrapRootCstNode(rootCstNode);
        root.setDiagnostics(toParseDiagnostics(parseResult.parserErrors, parseResult.lexerErrors));

        return { root, builtAst: parseResult };
    }

    getExpectedTokens(text: string, offset: number): ExpectedToken[] {
        // Delegate to the completion parser for content assist
        const completionResult = this.services.parser.CompletionParser.parse(text.substring(0, offset));
        const tokens = completionResult.tokens;
        const expectedTokens: ExpectedToken[] = [];

        // Extract unique token types from the completion result
        // The completion parser provides an element stack; for now, return basic token info
        for (const token of tokens) {
            if (token.tokenType) {
                expectedTokens.push({
                    name: token.tokenType.name,
                    isKeyword: token.tokenType.PATTERN !== undefined && typeof token.tokenType.PATTERN === 'string',
                    pattern: token.tokenType.PATTERN instanceof RegExp ? token.tokenType.PATTERN : undefined
                });
            }
        }

        return expectedTokens;
    }

    getCompletionData(_root: SyntaxNode, text: string, offset: number): CompletionParseData {
        const parserResult = this.services.parser.CompletionParser.parse(text.substring(0, offset));
        return {
            tokens: parserResult.tokens.map(t => ({
                image: t.image,
                tokenType: { name: t.tokenType.name }
            })),
            featureStack: parserResult.elementStack,
            tokenIndex: parserResult.tokenIndex
        };
    }

    getTokenBoundaries(_root: SyntaxNode, text: string, offset: number): CompletionBacktrackingInformation {
        const tokens = this.services.parser.Lexer.tokenize(text).tokens;
        if (tokens.length === 0) {
            return { nextTokenStart: offset, nextTokenEnd: offset };
        }
        let previousToken: { startOffset: number; endOffset?: number } | undefined;
        for (const token of tokens) {
            if (token.startOffset >= offset) {
                return {
                    nextTokenStart: offset,
                    nextTokenEnd: offset,
                    previousTokenStart: previousToken ? previousToken.startOffset : undefined,
                    previousTokenEnd: previousToken ? previousToken.endOffset! + 1 : undefined
                };
            }
            if (token.endOffset! >= offset) {
                return {
                    nextTokenStart: token.startOffset,
                    nextTokenEnd: token.endOffset! + 1,
                    previousTokenStart: previousToken ? previousToken.startOffset : undefined,
                    previousTokenEnd: previousToken ? previousToken.endOffset! + 1 : undefined
                };
            }
            previousToken = token;
        }
        return {
            nextTokenStart: offset,
            nextTokenEnd: offset,
            previousTokenStart: previousToken ? previousToken.startOffset : undefined,
            previousTokenEnd: previousToken ? previousToken.endOffset! + 1 : undefined
        };
    }
}

/**
 * Converts Chevrotain-specific parser/lexer errors to backend-agnostic ParseDiagnostics.
 */
export function toParseDiagnostics(
    parserErrors: ParseError[],
    lexerErrors: LexError[]
): ParseDiagnostic[] {
    const diagnostics: ParseDiagnostic[] = [];

    for (const err of lexerErrors) {
        diagnostics.push({
            message: err.message,
            offset: err.offset,
            length: err.length ?? 1,
            severity: 'error',
            source: 'lexer'
        });
    }

    for (const err of parserErrors) {
        const startOffset = err.token.startOffset;
        const endOffset = err.token.endOffset ?? startOffset;
        diagnostics.push({
            message: err.message,
            offset: startOffset,
            length: endOffset - startOffset + 1,
            severity: 'error',
            source: 'parser'
        });
    }

    return diagnostics;
}
