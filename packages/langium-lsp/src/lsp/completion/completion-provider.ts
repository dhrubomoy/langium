/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { CompletionItem, CompletionParams, TextEdit } from 'vscode-languageserver-protocol';
import type { NameProvider, ScopeProvider, AstNode, AstNodeDescription, AstReflection, MultiReference, Reference, ReferenceInfo, MaybePromise, LangiumDocument, TextDocument, DocumentationProvider, Stream, Cancellation, ParserAdapter, GrammarRegistry, CompletionFeature } from 'langium-core';
import type { NodeKindProvider } from '../node-kind-provider.js';
import type { FuzzyMatcher } from '../fuzzy-matcher.js';
import type { LangiumServices } from '../lsp-services.js';
import type { MarkupContent , Position } from 'vscode-languageserver';
import { CompletionItemKind, CompletionList } from 'vscode-languageserver';
import { GrammarAST, AstUtils, stream } from 'langium-core';

export type CompletionAcceptor = (context: CompletionContext, value: CompletionValueItem) => void

export type CompletionValueItem = ({
    label?: string
} | {
    node: AstNode
} | {
    nodeDescription: AstNodeDescription
}) & Partial<CompletionItem>;

export interface CompletionContext {
    node?: AstNode
    document: LangiumDocument
    textDocument: TextDocument
    features: CompletionFeature[]
    /**
     * Index at the start of the token related to this context.
     * If the context performs completion for a token that doesn't exist yet, it is equal to the `offset`.
     */
    tokenOffset: number
    /**
     * Index at the end of the token related to this context, even if it is behind the cursor position.
     * Points at the first character after the last token.
     * If the context performs completion for a token that doesn't exist yet, it is equal to the `offset`.
     */
    tokenEndOffset: number
    /**
     * Index of the requested completed position.
     */
    offset: number
    position: Position
}

export interface CompletionProviderOptions {
    /**
     * Most tools trigger completion request automatically without explicitly requesting
     * it using a keyboard shortcut (e.g. Ctrl+Space). Typically they do so when the user
     * starts to type an identifier. For example if the user types `c` in a JavaScript file
     * code complete will automatically pop up present `console` besides others as a
     * completion item. Characters that make up identifiers don't need to be listed here.
     *
     * If code complete should automatically be trigger on characters not being valid inside
     * an identifier (for example `.` in JavaScript) list them in `triggerCharacters`.
     */
    triggerCharacters?: string[];
    /**
     * The list of all possible characters that commit a completion. This field can be used
     * if clients don't support individual commit characters per completion item.
     *
     * If a server provides both `allCommitCharacters` and commit characters on an individual
     * completion item the ones on the completion item win.
     */
    allCommitCharacters?: string[];
}

export function mergeCompletionProviderOptions(options: Array<CompletionProviderOptions | undefined>): CompletionProviderOptions {
    const triggerCharacters = Array.from(new Set(options.flatMap(option => option?.triggerCharacters ?? [])));
    const allCommitCharacters = Array.from(new Set(options.flatMap(option => option?.allCommitCharacters ?? [])));
    return {
        triggerCharacters: triggerCharacters.length > 0 ? triggerCharacters : undefined,
        allCommitCharacters: allCommitCharacters.length > 0 ? allCommitCharacters : undefined
    };
}

/**
 * Language-specific service for handling completion requests.
 */
export interface CompletionProvider {
    /**
     * Handle a completion request.
     *
     * @param document - the document for which the completion request was triggered
     * @param params - the completion parameters
     * @param cancelToken - a token that can be used to cancel the request
     *
     * @throws `OperationCancelled` if cancellation is detected during execution
     * @throws `ResponseError` if an error is detected that should be sent as response to the client
     */
    getCompletion(document: LangiumDocument, params: CompletionParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<CompletionList | undefined>
    /**
     * Contains the completion options for this completion provider.
     *
     * If multiple languages return different options, they are merged before being sent to the language client.
     */
    readonly completionOptions?: CompletionProviderOptions;
}

/**
 * Default completion provider that delegates completion feature computation
 * to the `ParserAdapter`. Each backend (Chevrotain, Lezer, etc.) implements
 * its own completion logic via `ParserAdapter.getCompletionFeatures()`.
 *
 * This class handles the shared presentation layer: converting backend-agnostic
 * `CompletionFeature` objects into LSP `CompletionItem` objects, including
 * keyword filtering, cross-reference scope resolution, text edit computation,
 * fuzzy matching, and deduplication.
 */
export class DefaultCompletionProvider implements CompletionProvider {

    protected readonly parserAdapter: ParserAdapter;
    protected readonly grammarRegistry: GrammarRegistry;
    protected readonly documentationProvider: DocumentationProvider;
    protected readonly scopeProvider: ScopeProvider;
    protected readonly grammar: GrammarAST.Grammar;
    protected readonly nameProvider: NameProvider;
    protected readonly nodeKindProvider: NodeKindProvider;
    protected readonly fuzzyMatcher: FuzzyMatcher;
    protected readonly astReflection: AstReflection;
    readonly completionOptions?: CompletionProviderOptions;

    constructor(services: LangiumServices) {
        this.parserAdapter = services.parser.ParserAdapter;
        this.grammarRegistry = services.grammar.GrammarRegistry;
        this.scopeProvider = services.references.ScopeProvider;
        this.grammar = services.Grammar;
        this.nameProvider = services.references.NameProvider;
        this.nodeKindProvider = services.shared.lsp.NodeKindProvider;
        this.fuzzyMatcher = services.shared.lsp.FuzzyMatcher;
        this.astReflection = services.shared.AstReflection;
        this.documentationProvider = services.documentation.DocumentationProvider;
    }

    async getCompletion(document: LangiumDocument, params: CompletionParams, _cancelToken?: Cancellation.CancellationToken): Promise<CompletionList | undefined> {
        const rootSyntaxNode = document.parseResult.value.$syntaxNode;
        if (!rootSyntaxNode) {
            return undefined;
        }

        const textDocument = document.textDocument;
        const text = textDocument.getText();
        const offset = textDocument.offsetAt(params.position);

        // Delegate to the parser backend to compute completion features
        const results = this.parserAdapter.getCompletionFeatures({
            rootSyntaxNode,
            text,
            offset,
            grammar: this.grammar,
            grammarRegistry: this.grammarRegistry
        });

        const items: CompletionItem[] = [];
        const acceptor: CompletionAcceptor = (context, value) => {
            const completionItem = this.fillCompletionItem(context, value);
            if (completionItem) {
                items.push(completionItem);
            }
        };

        const distinctionFunction = (element: CompletionFeature) => {
            if (element.kind === 'keyword') {
                return element.value;
            } else {
                return element.grammarElement;
            }
        };

        const completedFeatures: CompletionFeature[] = [];
        for (const result of results) {
            const context: CompletionContext = {
                node: result.contextNode,
                document,
                textDocument,
                features: result.features,
                tokenOffset: result.tokenOffset,
                tokenEndOffset: result.tokenEndOffset,
                offset: result.offset,
                position: params.position
            };

            await Promise.all(
                stream(context.features)
                    .distinct(distinctionFunction)
                    .exclude(completedFeatures)
                    .map(e => this.completionFor(context, e, acceptor))
            );
            // Do not try to complete the same feature multiple times
            completedFeatures.push(...context.features);
            // We might want to stop computing completion results
            if (!this.continueCompletion(items)) {
                break;
            }
        }

        return CompletionList.create(this.deduplicateItems(items), true);
    }

    /**
     * The completion algorithm could yield the same reference/keyword multiple times.
     *
     * This methods deduplicates these items afterwards before returning to the client.
     * Unique items are identified as a combination of `kind`, `label` and `detail`.
     */
    protected deduplicateItems(items: CompletionItem[]): CompletionItem[] {
        return stream(items).distinct(item => `${item.kind}_${item.label}_${item.detail}`).toArray();
    }

    /**
     * Indicates whether the completion should continue to process the next completion context.
     *
     * The default implementation continues the completion only if there are currently no proposed completion items.
     */
    protected continueCompletion(items: CompletionItem[]): boolean {
        return items.length === 0;
    }

    protected completionFor(context: CompletionContext, feature: CompletionFeature, acceptor: CompletionAcceptor): MaybePromise<void> {
        if (feature.kind === 'keyword' && GrammarAST.isKeyword(feature.grammarElement)) {
            return this.completionForKeyword(context, feature.grammarElement, acceptor);
        } else if (feature.kind === 'crossReference' && GrammarAST.isCrossReference(feature.grammarElement) && context.node) {
            return this.completionForCrossReference(context, feature, acceptor);
        }
    }

    protected completionForCrossReference(context: CompletionContext, feature: CompletionFeature, acceptor: CompletionAcceptor): MaybePromise<void> {
        const assignment = feature.assignment;
        let node = context.node;
        if (assignment && node) {
            if (feature.type) {
                // When `type` is set, it indicates that we have just entered a new parser rule.
                // The cross reference that we're trying to complete is on a new element that doesn't exist yet.
                // So we create a new synthetic element with the correct type information.
                node = {
                    $type: feature.type,
                    $container: node,
                    $containerProperty: feature.property
                };
                AstUtils.assignMandatoryProperties(this.astReflection, node);
            }
            const crossRef = feature.grammarElement as GrammarAST.CrossReference;
            let reference: Reference | MultiReference;
            if (crossRef.isMulti) {
                reference = {
                    $refText: '',
                    items: []
                };
            } else {
                reference = {
                    $refText: '',
                    ref: undefined
                };
            }
            const refInfo: ReferenceInfo = {
                reference,
                container: node,
                property: assignment.feature
            };
            try {
                for (const candidate of this.getReferenceCandidates(refInfo, context)) {
                    acceptor(context, this.createReferenceCompletionItem(candidate, refInfo, context));
                }
            } catch (err) {
                console.error(err);
            }
        }
    }

    /**
     * Override this method to change how the stream of candidates is determined for a reference.
     * This way completion-specific modifications and refinements can be added to the proposals computation
     *  beyond the rules being implemented in the scope provider, e.g. filtering.
     *
     * @param refInfo Information about the reference for which the candidates are requested.
     * @param _context Information about the completion request including document, cursor position, token under cursor, etc.
     * @returns A stream of all elements being valid for the given reference.
     */
    protected getReferenceCandidates(refInfo: ReferenceInfo, _context: CompletionContext): Stream<AstNodeDescription> {
        return this.scopeProvider.getScope(refInfo).getAllElements();
    }

    /**
     * Override this method to change how reference completion items are created.
     *
     * To change the `kind` of a completion item, override the `NodeKindProvider` service instead.
     * To change the `documentation`, override the `DocumentationProvider` service instead.
     *
     * @param nodeDescription The description of a reference candidate
     * @param _refInfo Information about the reference for which the candidate is proposed
     * @param _context The completion context
     * @returns A partial completion item
     */
    protected createReferenceCompletionItem(nodeDescription: AstNodeDescription, _refInfo: ReferenceInfo, _context: CompletionContext): CompletionValueItem {
        const kind = this.nodeKindProvider.getCompletionItemKind(nodeDescription);
        const documentation = this.getReferenceDocumentation(nodeDescription);
        return {
            nodeDescription,
            kind,
            documentation,
            detail: nodeDescription.type,
            sortText: '0'
        };
    }

    protected getReferenceDocumentation(nodeDescription: AstNodeDescription): MarkupContent | string | undefined {
        if (!nodeDescription.node) {
            return undefined;
        }
        const documentationText = this.documentationProvider.getDocumentation(nodeDescription.node);
        if (!documentationText) {
            return undefined;
        }
        return { kind: 'markdown', value: documentationText };
    }

    protected completionForKeyword(context: CompletionContext, keyword: GrammarAST.Keyword, acceptor: CompletionAcceptor): MaybePromise<void> {
        if (!this.filterKeyword(context, keyword)) {
            return;
        }
        acceptor(context, {
            label: keyword.value,
            kind: this.getKeywordCompletionItemKind(keyword),
            detail: 'Keyword',
            sortText: '1'
        });
    }

    protected getKeywordCompletionItemKind(_keyword: GrammarAST.Keyword): CompletionItemKind {
        return CompletionItemKind.Keyword;
    }

    protected filterKeyword(_context: CompletionContext, keyword: GrammarAST.Keyword): boolean {
        // Filter out keywords that do not contain any word character
        return /\p{L}/u.test(keyword.value);
    }

    protected fillCompletionItem(context: CompletionContext, item: CompletionValueItem): CompletionItem | undefined {
        let label: string;
        if (typeof item.label === 'string') {
            label = item.label;
        } else if ('node' in item) {
            const name = this.nameProvider.getName(item.node);
            if (!name) {
                return undefined;
            }
            label = name;
        } else if ('nodeDescription' in item) {
            label = item.nodeDescription.name;
        } else {
            return undefined;
        }
        let insertText: string;
        if (typeof item.textEdit?.newText === 'string') {
            insertText = item.textEdit.newText;
        } else if (typeof item.insertText === 'string') {
            insertText = item.insertText;
        } else {
            insertText = label;
        }
        const textEdit = item.textEdit ?? this.buildCompletionTextEdit(context, label, insertText);
        if (!textEdit) {
            return undefined;
        }
        // Copy all valid properties of `CompletionItem`
        const completionItem: CompletionItem = {
            additionalTextEdits: item.additionalTextEdits,
            command: item.command,
            commitCharacters: item.commitCharacters,
            data: item.data,
            detail: item.detail,
            documentation: item.documentation,
            filterText: item.filterText,
            insertText: item.insertText,
            insertTextFormat: item.insertTextFormat,
            insertTextMode: item.insertTextMode,
            kind: item.kind,
            labelDetails: item.labelDetails,
            preselect: item.preselect,
            sortText: item.sortText,
            tags: item.tags,
            textEditText: item.textEditText,
            textEdit,
            label
        };
        return completionItem;
    }

    protected buildCompletionTextEdit(context: CompletionContext, label: string, newText: string): TextEdit | undefined {
        const content = context.textDocument.getText();
        const identifier = content.substring(context.tokenOffset, context.offset);
        if (this.fuzzyMatcher.match(identifier, label)) {
            const start = context.textDocument.positionAt(context.tokenOffset);
            const end = context.position;
            return {
                newText,
                range: {
                    start,
                    end
                }
            };
        } else {
            return undefined;
        }
    }
}

/**
 * @deprecated Use `DefaultCompletionProvider` directly — it now works with any parser backend.
 */
export const AbstractCompletionProvider = DefaultCompletionProvider;
