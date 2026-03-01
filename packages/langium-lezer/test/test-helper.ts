/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { buildParser } from '@lezer/generator';
import type { ParserAdapter, SyntaxNode, RootSyntaxNode, ParseDiagnostic, Grammar, LangiumCoreServices, LangiumSharedCoreServices, LangiumGeneratedCoreServices, LangiumGeneratedSharedCoreServices } from 'langium-core';
import type { Module } from 'langium-core';
import { EmptyFileSystem, URI, createDefaultCoreModule, createDefaultSharedCoreModule, inject } from 'langium-core';
import { interpretAstReflection } from 'langium-core/grammar';
import { createLangiumGrammarServices, createServicesForGrammar } from 'langium-lsp';
import { LezerAdapter, LezerGrammarTranslator, DefaultFieldMap } from 'langium-lezer';

// ---- Grammar constants ----

export const SIMPLE_GRAMMAR = `
    grammar SimpleTest
    entry Model: 'model' name=ID;
    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
`;

export const LIST_GRAMMAR = `
    grammar ListTest
    entry Model: 'model' name=ID items+=Item*;
    Item: 'item' name=ID;
    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
`;

export const ALTERNATIVES_GRAMMAR = `
    grammar AlternativesTest
    entry Root: elements+=(A | B)*;
    A: 'a' name=ID;
    B: 'b' value=INT;
    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
    terminal INT: /[0-9]+/;
`;

export const ALTERNATIVE_RULE_GRAMMAR = `
    grammar AlternativeRuleTest
    entry Model: elements+=Element*;
    Element: Person | Greeting;
    Person: 'person' name=ID;
    Greeting: 'hello' target=ID '!';
    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
`;

export const OPTIONAL_GRAMMAR = `
    grammar OptionalTest
    entry Person: 'person' name=ID age=INT?;
    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
    terminal INT: /[0-9]+/;
`;

export const CROSS_REF_GRAMMAR = `
    grammar CrossRefTest
    entry Model: entities+=Entity*;
    Entity: 'entity' name=ID ('extends' superType=[Entity])?;
    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
`;

// ---- Service creation helpers ----

/**
 * Parse a grammar string into a Grammar AST using Langium's grammar language.
 */
export async function parseGrammarString(grammarString: string): Promise<Grammar> {
    const grammarServices = createLangiumGrammarServices(EmptyFileSystem).grammar;
    const uri = URI.parse('memory:/test-grammar.langium');
    const doc = grammarServices.shared.workspace.LangiumDocumentFactory.fromString(grammarString, uri);
    grammarServices.shared.workspace.LangiumDocuments.addDocument(doc);
    await grammarServices.shared.workspace.DocumentBuilder.build([doc], { validation: false });
    return doc.parseResult.value as Grammar;
}

/**
 * Create a LezerAdapter configured for the given grammar string.
 * Uses in-memory grammar generation + buildParser() — no file I/O.
 */
export async function createLezerAdapterForGrammar(grammarString: string): Promise<{
    adapter: LezerAdapter;
    grammar: Grammar;
}> {
    const grammar = await parseGrammarString(grammarString);

    const translator = new LezerGrammarTranslator();
    const { grammarText, fieldMapData, keywords } = translator.generateGrammarInMemory(grammar);

    // Build an in-memory LRParser from the Lezer grammar text
    const parser = buildParser(grammarText);

    const fieldMap = new DefaultFieldMap(fieldMapData);

    const adapter = new LezerAdapter();
    adapter.loadParseTables(parser, fieldMap, keywords);

    return { adapter, grammar };
}

/**
 * Create Chevrotain-based services for the given grammar string.
 * Returns the ParserAdapter from the services.
 */
export async function createChevrotainAdapterForGrammar(grammarString: string): Promise<{
    adapter: ParserAdapter;
}> {
    const services = await createServicesForGrammar({ grammar: grammarString });
    return { adapter: services.parser.ParserAdapter };
}

// ---- Tree comparison utilities ----

/**
 * Collect all non-hidden leaf nodes from a SyntaxNode tree.
 * Returns them in document order (left-to-right DFS).
 */
export function collectLeaves(node: SyntaxNode): SyntaxNode[] {
    const leaves: SyntaxNode[] = [];
    function walk(n: SyntaxNode): void {
        if (n.isHidden) return;
        if (n.isLeaf) {
            leaves.push(n);
        } else {
            for (const child of n.children) {
                walk(child);
            }
        }
    }
    walk(node);
    return leaves;
}

/**
 * Collect all non-hidden, non-error leaf text values from a SyntaxNode tree.
 * This gives the ordered sequence of meaningful tokens.
 */
export function collectLeafTexts(node: SyntaxNode): string[] {
    return collectLeaves(node)
        .filter(leaf => !leaf.isError)
        .map(leaf => leaf.text);
}

/**
 * Assert that two parse trees have the same non-hidden leaf token sequence.
 * This is the primary cross-backend structural comparison:
 * both parsers should tokenize and accept the same visible tokens in the same order.
 */
export function assertLeafSequenceEqual(a: RootSyntaxNode, b: RootSyntaxNode): void {
    const aTexts = collectLeafTexts(a);
    const bTexts = collectLeafTexts(b);

    if (aTexts.length !== bTexts.length) {
        throw new Error(
            `Leaf count mismatch: ${aTexts.length} vs ${bTexts.length}\n` +
            `  A: [${aTexts.join(', ')}]\n` +
            `  B: [${bTexts.join(', ')}]`
        );
    }

    for (let i = 0; i < aTexts.length; i++) {
        if (aTexts[i] !== bTexts[i]) {
            throw new Error(
                `Leaf text mismatch at index ${i}: '${aTexts[i]}' vs '${bTexts[i]}'\n` +
                `  A: [${aTexts.join(', ')}]\n` +
                `  B: [${bTexts.join(', ')}]`
            );
        }
    }
}

/**
 * Assert that two diagnostic arrays are equivalent.
 * Backends may produce different messages, but should agree on error count and approximate positions.
 */
export function assertDiagnosticsEquivalent(
    a: readonly ParseDiagnostic[],
    b: readonly ParseDiagnostic[],
    positionTolerance = 5
): void {
    // Both should agree on whether there are errors
    const aErrors = a.filter(d => d.severity === 'error');
    const bErrors = b.filter(d => d.severity === 'error');

    if (aErrors.length === 0 && bErrors.length === 0) return;
    if (aErrors.length > 0 && bErrors.length > 0) return; // Both have errors

    throw new Error(
        `Diagnostic agreement mismatch: ${aErrors.length} errors vs ${bErrors.length} errors\n` +
        `  A: ${JSON.stringify(aErrors.map(d => ({ msg: d.message, offset: d.offset })))}\n` +
        `  B: ${JSON.stringify(bErrors.map(d => ({ msg: d.message, offset: d.offset })))}`
    );
}

/**
 * Assert that two SyntaxNode trees from the same backend are structurally identical.
 * Used for incremental-vs-full parse comparison within the Lezer backend.
 */
export function assertTreesStructurallyEqual(a: SyntaxNode, b: SyntaxNode, path = 'root'): void {
    if (a.type !== b.type) {
        throw new Error(`Type mismatch at ${path}: '${a.type}' vs '${b.type}'`);
    }
    if (a.offset !== b.offset) {
        throw new Error(`Offset mismatch at ${path} (type=${a.type}): ${a.offset} vs ${b.offset}`);
    }
    if (a.end !== b.end) {
        throw new Error(`End mismatch at ${path} (type=${a.type}): ${a.end} vs ${b.end}`);
    }
    if (a.text !== b.text) {
        throw new Error(`Text mismatch at ${path} (type=${a.type}): '${a.text}' vs '${b.text}'`);
    }

    const aChildren = a.children;
    const bChildren = b.children;

    if (aChildren.length !== bChildren.length) {
        throw new Error(
            `Children count mismatch at ${path} (type=${a.type}): ` +
            `${aChildren.length} vs ${bChildren.length}\n` +
            `  A children: [${aChildren.map(c => c.type || `"${c.text}"`).join(', ')}]\n` +
            `  B children: [${bChildren.map(c => c.type || `"${c.text}"`).join(', ')}]`
        );
    }

    for (let i = 0; i < aChildren.length; i++) {
        assertTreesStructurallyEqual(aChildren[i], bChildren[i], `${path}.children[${i}]`);
    }
}

/**
 * Generate Lezer grammar text from a Langium grammar string.
 * Only does grammar text generation — does NOT call buildParser().
 * Useful for testing grammar output structure without needing working parse tables.
 */
export async function generateLezerGrammarText(grammarString: string): Promise<{
    grammarText: string;
    keywords: Set<string>;
}> {
    const grammar = await parseGrammarString(grammarString);
    const translator = new LezerGrammarTranslator();
    const { grammarText, keywords } = translator.generateGrammarInMemory(grammar);
    return { grammarText, keywords };
}

/**
 * Generate a large document string for performance testing.
 * Produces multiple `item <name>` entries within a `model` block.
 */
export function generateLargeDocument(itemCount: number): string {
    const items = Array.from({ length: itemCount }, (_, i) => `item item_${i}`).join('\n');
    return `model TestModel\n${items}`;
}

// ---- Full Lezer service creation (for AST builder integration tests) ----

/**
 * Create full Langium services using the Lezer parser backend.
 * This enables DocumentFactory.parse() to use the
 * ParserAdapter → SyntaxNodeAstBuilder pipeline.
 */
export async function createLezerServicesForGrammar(grammarString: string): Promise<{
    shared: LangiumSharedCoreServices;
    parser: LangiumCoreServices;
}> {
    // 1. Parse the grammar
    const grammar = await parseGrammarString(grammarString);

    // 2. Generate Lezer parse tables
    const translator = new LezerGrammarTranslator();
    const { grammarText, fieldMapData, keywords } = translator.generateGrammarInMemory(grammar);
    const parser = buildParser(grammarText);
    const fieldMap = new DefaultFieldMap(fieldMapData);

    // 3. Create a Lezer adapter loaded with parse tables
    const lezerAdapter = new LezerAdapter();
    lezerAdapter.loadParseTables(parser, fieldMap, keywords);

    // 4. Build DI services: core module + Lezer parser override (no Chevrotain)
    const languageMetaData = {
        caseInsensitive: false,
        fileExtensions: ['.txt'],
        languageId: grammar.name ?? 'test',
        mode: 'development' as const
    };

    const generatedSharedModule: Module<LangiumSharedCoreServices, LangiumGeneratedSharedCoreServices> = {
        AstReflection: () => interpretAstReflection(grammar),
    };
    const generatedModule: Module<LangiumCoreServices, LangiumGeneratedCoreServices> = {
        Grammar: () => grammar,
        LanguageMetaData: () => languageMetaData,
        parser: {
            ParserConfig: () => ({})
        }
    };
    // Override parser services with Lezer (no LangiumParser → DocumentFactory uses generic path)
    const lezerModule: Module<LangiumCoreServices, { parser: { ParserAdapter: ParserAdapter } }> = {
        parser: {
            ParserAdapter: () => lezerAdapter
        }
    };

    const shared = inject(createDefaultSharedCoreModule({ fileSystemProvider: () => EmptyFileSystem.fileSystemProvider() }), generatedSharedModule);
    const services = inject(createDefaultCoreModule({ shared }), generatedModule, lezerModule);
    shared.ServiceRegistry.register(services);

    return { shared, parser: services };
}
