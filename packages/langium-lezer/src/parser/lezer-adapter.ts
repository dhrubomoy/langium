/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Tree } from '@lezer/common';
import { TreeFragment } from '@lezer/common';
import type { LRParser } from '@lezer/lr';
import type {
    Grammar,
    ParseDiagnostic,
    AdapterParseResult,
    ExpectedToken,
    ParserAdapter,
    ParserAdapterConfig,
    TextChange,
    IncrementalParseState
} from 'langium-core';
import type { FieldMap } from './field-map.js';
import { EMPTY_FIELD_MAP } from './field-map.js';
import { LezerRootSyntaxNode } from './lezer-syntax-node.js';
import { getLezerExpectedTokens } from './lezer-completion.js';

/**
 * Opaque incremental state stored between parses.
 * Contains the Lezer Tree and TreeFragment array for subtree reuse.
 */
interface LezerIncrementalState {
    readonly tree: Tree;
    readonly fragments: readonly TreeFragment[];
}

/**
 * Parser adapter that wraps a Lezer LR parser.
 * Supports both full and incremental parsing via Lezer's fragment reuse mechanism.
 *
 * The parser must be pre-compiled at build time by `LezerGrammarTranslator`.
 * At runtime, `loadParseTables()` loads the compiled parse tables.
 */
export class LezerAdapter implements ParserAdapter {
    readonly name = 'lezer';
    readonly supportsIncremental = true;

    private parser!: LRParser;
    private fieldMap: FieldMap = EMPTY_FIELD_MAP;
    private keywordSet: Set<string> = new Set();

    configure(_grammar: Grammar, _config?: ParserAdapterConfig): void {
        // Parse tables are loaded via loadParseTables(), not from grammar.
        // This method is called by the framework but for Lezer the parser
        // is pre-compiled at build time and loaded as a module.
    }

    /**
     * Load pre-compiled Lezer parse tables and field map.
     * Called during service initialization with the generated parser module.
     */
    loadParseTables(parser: LRParser, fieldMap: FieldMap, keywords?: ReadonlySet<string>): void {
        this.parser = parser;
        this.fieldMap = fieldMap;
        if (keywords) {
            this.keywordSet = new Set(keywords);
        }
    }

    parse(text: string, _entryRule?: string): AdapterParseResult {
        this.ensureConfigured();
        const tree = this.parser.parse(text);
        const root = new LezerRootSyntaxNode(tree.topNode, text, this.fieldMap, this.keywordSet);
        root.setDiagnostics(this.extractDiagnostics(tree, text));

        return {
            root,
            incrementalState: {
                tree,
                fragments: TreeFragment.addTree(tree)
            } satisfies LezerIncrementalState as IncrementalParseState
        };
    }

    parseIncremental(
        text: string,
        previousState: IncrementalParseState,
        changes: readonly TextChange[]
    ): AdapterParseResult {
        this.ensureConfigured();
        const prev = previousState as LezerIncrementalState;

        // Convert TextChange[] to Lezer's change format
        const lezerChanges = changes.map(c => ({
            fromA: c.rangeOffset,
            toA: c.rangeOffset + c.rangeLength,
            fromB: c.rangeOffset,
            toB: c.rangeOffset + c.text.length
        }));

        // Apply changes to fragments for tree reuse
        const fragments = TreeFragment.applyChanges(prev.fragments, lezerChanges);

        // Parse with fragment reuse — Lezer reuses unchanged subtrees
        const tree = this.parser.parse(text, fragments);
        const root = new LezerRootSyntaxNode(tree.topNode, text, this.fieldMap, this.keywordSet);
        root.setDiagnostics(this.extractDiagnostics(tree, text));

        return {
            root,
            incrementalState: {
                tree,
                fragments: TreeFragment.addTree(tree)
            } satisfies LezerIncrementalState as IncrementalParseState
        };
    }

    getExpectedTokens(text: string, offset: number): ExpectedToken[] {
        this.ensureConfigured();
        return getLezerExpectedTokens(this.parser, text, offset);
    }

    dispose(): void {
        // No resources to release for pure-JS Lezer parser
    }

    /**
     * Walk the parse tree for error nodes (type.isError === true) and
     * convert them to ParseDiagnostics.
     */
    private extractDiagnostics(tree: Tree, text: string): ParseDiagnostic[] {
        const diagnostics: ParseDiagnostic[] = [];
        tree.iterate({
            enter(node) {
                if (node.type.isError) {
                    const from = node.from;
                    const to = node.to;
                    const length = to - from;

                    // Try to provide a more specific message based on content
                    const errorText = text.slice(from, to);
                    const message = length > 0
                        ? `Unexpected input: '${errorText.length > 20 ? errorText.slice(0, 20) + '...' : errorText}'`
                        : 'Unexpected input';

                    diagnostics.push({
                        message,
                        offset: from,
                        length: Math.max(length, 1),
                        severity: 'error',
                        source: 'parser'
                    });
                }
            }
        });
        return diagnostics;
    }

    private ensureConfigured(): void {
        if (!this.parser) {
            throw new Error('LezerAdapter: parser not configured. Call loadParseTables() first.');
        }
    }
}
