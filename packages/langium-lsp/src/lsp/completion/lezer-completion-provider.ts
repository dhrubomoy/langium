/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { CompletionItem, CompletionParams, TextEdit } from 'vscode-languageserver-protocol';
import type { MarkupContent } from 'vscode-languageserver';
import type {
    AstNode, AstNodeDescription, AstReflection, DocumentationProvider,
    GrammarConfig, LangiumDocument, MaybePromise, MultiReference, Mutable,
    NameProvider, Reference, ReferenceInfo, ScopeProvider, SyntaxNode, TextDocument
} from 'langium-core';
import type { GrammarRegistry } from 'langium-core';
import type { NodeKindProvider } from '../node-kind-provider.js';
import type { FuzzyMatcher } from '../fuzzy-matcher.js';
import type { LangiumServices } from '../lsp-services.js';
import type { CompletionProvider, CompletionProviderOptions, CompletionContext, CompletionValueItem, CompletionAcceptor } from './completion-provider.js';
import type { NextFeature } from './follow-element-computation.js';
import { CompletionItemKind, CompletionList, Position } from 'vscode-languageserver';
import { GrammarAST, AstUtils, SyntaxNodeUtils, GrammarUtils, stream } from 'langium-core';
import { findFirstFeatures, findNextFeatures } from './follow-element-computation.js';

/**
 * Completion provider for the Lezer parser backend.
 *
 * Uses the existing parse tree (SyntaxNode) to derive completion context
 * instead of Chevrotain's dedicated completion parser and lexer.
 *
 * Algorithm:
 * 1. Extract leaf tokens from the parse tree before the cursor offset
 * 2. Map leaf nodes to FollowElementToken format (keyword → text, terminal → type name)
 * 3. Feed tokens through `findNextFeatures` starting from the entry rule
 * 4. Build CompletionItems for the resulting keywords and cross-references
 */
export class LezerCompletionProvider implements CompletionProvider {

    protected readonly grammar: GrammarAST.Grammar;
    protected readonly grammarRegistry: GrammarRegistry;
    protected readonly scopeProvider: ScopeProvider;
    protected readonly nameProvider: NameProvider;
    protected readonly nodeKindProvider: NodeKindProvider;
    protected readonly fuzzyMatcher: FuzzyMatcher;
    protected readonly grammarConfig: GrammarConfig;
    protected readonly astReflection: AstReflection;
    protected readonly documentationProvider: DocumentationProvider;
    readonly completionOptions?: CompletionProviderOptions;

    constructor(services: LangiumServices) {
        this.grammar = services.Grammar;
        this.grammarRegistry = services.grammar.GrammarRegistry;
        this.scopeProvider = services.references.ScopeProvider;
        this.nameProvider = services.references.NameProvider;
        this.nodeKindProvider = services.shared.lsp.NodeKindProvider;
        this.fuzzyMatcher = services.shared.lsp.FuzzyMatcher;
        this.grammarConfig = services.parser.GrammarConfig;
        this.astReflection = services.shared.AstReflection;
        this.documentationProvider = services.documentation.DocumentationProvider;
    }

    async getCompletion(document: LangiumDocument, params: CompletionParams): Promise<CompletionList | undefined> {
        const items: CompletionItem[] = [];
        const contexts = this.buildContexts(document, params.position);

        const acceptor: CompletionAcceptor = (context, value) => {
            const completionItem = this.fillCompletionItem(context, value);
            if (completionItem) {
                items.push(completionItem);
            }
        };

        const distinctionFunction = (element: NextFeature) => {
            if (GrammarAST.isKeyword(element.feature)) {
                return element.feature.value;
            } else {
                return element.feature;
            }
        };

        const completedFeatures: NextFeature[] = [];
        for (const context of contexts) {
            await Promise.all(
                stream(context.features)
                    .distinct(distinctionFunction)
                    .exclude(completedFeatures)
                    .map(e => this.completionFor(context, e, acceptor))
            );
            completedFeatures.push(...context.features);
            if (!this.continueCompletion(items)) {
                break;
            }
        }

        return CompletionList.create(this.deduplicateItems(items), true);
    }

    // ---- Context Building ----

    protected *buildContexts(document: LangiumDocument, position: Position): IterableIterator<CompletionContext> {
        const rootSyntaxNode = document.parseResult.value.$syntaxNode;
        if (!rootSyntaxNode) {
            return;
        }
        const textDocument = document.textDocument;
        const text = textDocument.getText();
        const offset = textDocument.offsetAt(position);
        const partialContext = {
            document,
            textDocument,
            offset,
            position
        };

        // Data type rules need special handling — jump to the start of the data type rule.
        const dataTypeRuleOffsets = this.findDataTypeRuleStart(rootSyntaxNode, offset);
        if (dataTypeRuleOffsets) {
            const [ruleStart, ruleEnd] = dataTypeRuleOffsets;
            const leafBefore = SyntaxNodeUtils.findLeafSyntaxNodeBeforeOffset(rootSyntaxNode, ruleStart);
            const parentNode = leafBefore ? SyntaxNodeUtils.findAstNodeForSyntaxNode(leafBefore) : undefined;
            yield {
                ...partialContext,
                node: parentNode,
                tokenOffset: ruleStart,
                tokenEndOffset: ruleEnd,
                features: this.findFeaturesAtOffset(rootSyntaxNode, textDocument, ruleStart),
            };
        }

        // Find token boundaries at the cursor using the parse tree
        const { nextTokenStart, nextTokenEnd, previousTokenStart, previousTokenEnd } = this.findTokenBoundaries(rootSyntaxNode, offset);

        let astNodeOffset = nextTokenStart;
        if (offset <= nextTokenStart && previousTokenStart !== undefined) {
            astNodeOffset = previousTokenStart;
        }
        const leaf = SyntaxNodeUtils.findLeafSyntaxNodeBeforeOffset(rootSyntaxNode, astNodeOffset);
        const astNode = leaf ? SyntaxNodeUtils.findAstNodeForSyntaxNode(leaf) : undefined;

        let performNextCompletion = true;
        if (previousTokenStart !== undefined && previousTokenEnd !== undefined && previousTokenEnd === offset) {
            // Complete the current token
            yield {
                ...partialContext,
                node: astNode,
                tokenOffset: previousTokenStart,
                tokenEndOffset: previousTokenEnd,
                features: this.findFeaturesAtOffset(rootSyntaxNode, textDocument, previousTokenStart),
            };
            // Don't complete next token if the current one ends on a letter (still being typed)
            performNextCompletion = /\P{L}$/u.test(text.substring(previousTokenStart, previousTokenEnd));
            if (performNextCompletion) {
                yield {
                    ...partialContext,
                    node: astNode,
                    tokenOffset: previousTokenEnd,
                    tokenEndOffset: previousTokenEnd,
                    features: this.findFeaturesAtOffset(rootSyntaxNode, textDocument, previousTokenEnd),
                };
            }
        }

        if (!astNode) {
            // Empty document or no AST node — return entry rule features
            const parserRule = GrammarUtils.getEntryRule(this.grammar);
            if (!parserRule) {
                throw new Error('Missing entry parser rule');
            }
            yield {
                ...partialContext,
                tokenOffset: nextTokenStart,
                tokenEndOffset: nextTokenEnd,
                features: findFirstFeatures(parserRule.definition).map(f => f[f.length - 1]),
            };
        } else if (performNextCompletion) {
            yield {
                ...partialContext,
                node: astNode,
                tokenOffset: nextTokenStart,
                tokenEndOffset: nextTokenEnd,
                features: this.findFeaturesAtOffset(rootSyntaxNode, textDocument, nextTokenStart),
            };
        }
    }

    // ---- Token Boundary Detection (replaces Chevrotain's lexer.tokenize) ----

    /**
     * Walk parse tree leaves to find token boundaries at the cursor offset.
     * This replaces `backtrackToAnyToken` which uses Chevrotain's Lexer.
     */
    protected findTokenBoundaries(root: SyntaxNode, offset: number): {
        previousTokenStart?: number;
        previousTokenEnd?: number;
        nextTokenStart: number;
        nextTokenEnd: number;
    } {
        const leaves = this.collectLeaves(root);

        if (leaves.length === 0) {
            return { nextTokenStart: offset, nextTokenEnd: offset };
        }

        let previousLeaf: SyntaxNode | undefined;
        for (const leaf of leaves) {
            if (leaf.offset >= offset) {
                // Cursor is before this token
                return {
                    nextTokenStart: offset,
                    nextTokenEnd: offset,
                    previousTokenStart: previousLeaf?.offset,
                    previousTokenEnd: previousLeaf?.end,
                };
            }
            if (leaf.end >= offset) {
                // Cursor is within this token
                return {
                    nextTokenStart: leaf.offset,
                    nextTokenEnd: leaf.end,
                    previousTokenStart: previousLeaf?.offset,
                    previousTokenEnd: previousLeaf?.end,
                };
            }
            previousLeaf = leaf;
        }

        // Past all tokens
        return {
            nextTokenStart: offset,
            nextTokenEnd: offset,
            previousTokenStart: previousLeaf?.offset,
            previousTokenEnd: previousLeaf?.end,
        };
    }

    // ---- Feature Computation (replaces Chevrotain's CompletionParser) ----

    /**
     * Compute grammar features expected at a given offset.
     *
     * Extracts leaf tokens from the parse tree before the offset, converts them
     * to the token format expected by `findNextFeatures`, and feeds them through
     * grammar analysis starting from the entry rule.
     */
    protected findFeaturesAtOffset(root: SyntaxNode, document: TextDocument, offset: number): NextFeature[] {
        // Collect non-hidden leaf nodes before the offset
        const leaves = this.collectLeaves(root).filter(l => l.end <= offset);

        // Convert leaves to the token format expected by findNextFeatures
        const tokens = leaves.map(leaf => ({
            image: leaf.text,
            tokenType: { name: leaf.isKeyword ? leaf.text : leaf.type }
        }));

        const parserRule = GrammarUtils.getEntryRule(this.grammar);
        if (!parserRule) {
            return [];
        }

        if (tokens.length === 0) {
            // No tokens before cursor — return first features of entry rule
            const syntheticCall = this.buildSyntheticEntryRuleCall(parserRule);
            return findNextFeatures([[syntheticCall]], tokens);
        }

        const syntheticCall = this.buildSyntheticEntryRuleCall(parserRule);
        return findNextFeatures([[syntheticCall]], tokens);
    }

    /**
     * Build a synthetic entry rule call for use with findNextFeatures.
     * Creates a Group containing an empty start node followed by a RuleCall to the entry rule.
     */
    protected buildSyntheticEntryRuleCall(rule: GrammarAST.ParserRule): NextFeature {
        const start: GrammarAST.Group = {
            $type: 'Group',
            $container: undefined!,
            elements: []
        };
        const startNext: NextFeature<GrammarAST.Group> = {
            feature: start
        };
        const ruleCall: GrammarAST.RuleCall = {
            $type: 'RuleCall',
            $container: undefined!,
            rule: {
                ref: rule,
                $refText: rule.name
            },
            arguments: []
        };
        const group: GrammarAST.Group = {
            $type: 'Group',
            $container: undefined!,
            elements: [
                start,
                ruleCall
            ]
        };
        (start as Mutable<AstNode>).$container = group;
        (ruleCall as Mutable<AstNode>).$container = group;
        return startNext;
    }

    // ---- Data Type Rule Detection ----

    /**
     * Detect if the cursor is inside a data type rule by walking up the SyntaxNode
     * parent chain and checking against GrammarRegistry.
     */
    protected findDataTypeRuleStart(root: SyntaxNode, offset: number): [number, number] | undefined {
        const leaf = SyntaxNodeUtils.findLeafSyntaxNodeAtOffset(root, offset)
            ?? SyntaxNodeUtils.findLeafSyntaxNodeBeforeOffset(root, offset);
        if (!leaf) {
            return undefined;
        }
        let current: SyntaxNode | null = leaf;
        while (current) {
            if (current.type && this.grammarRegistry.isDataTypeRule(current.type)) {
                return [current.offset, current.end];
            }
            current = current.parent;
        }
        return undefined;
    }

    // ---- Leaf Node Collection ----

    /**
     * Collect all non-hidden, non-error leaf nodes from the parse tree in document order.
     */
    protected collectLeaves(root: SyntaxNode): SyntaxNode[] {
        const result: SyntaxNode[] = [];
        this.collectLeavesRecursive(root, result);
        return result;
    }

    private collectLeavesRecursive(node: SyntaxNode, result: SyntaxNode[]): void {
        if (node.isLeaf) {
            // Include leaf if it's not hidden, not an error placeholder, and has a meaningful type.
            // Lezer creates empty error leaf nodes as placeholders for missing tokens —
            // these must be excluded or they break grammar token matching in findNextFeatures.
            if (!node.isHidden && !node.isError && (node.isKeyword || node.type !== '')) {
                result.push(node);
            }
            return;
        }
        for (const child of node.children) {
            this.collectLeavesRecursive(child, result);
        }
    }

    // ---- Completion Item Building ----

    protected completionFor(context: CompletionContext, next: NextFeature, acceptor: CompletionAcceptor): MaybePromise<void> {
        if (GrammarAST.isKeyword(next.feature)) {
            return this.completionForKeyword(context, next.feature, acceptor);
        } else if (GrammarAST.isCrossReference(next.feature) && context.node) {
            return this.completionForCrossReference(context, next as NextFeature<GrammarAST.CrossReference>, acceptor);
        }
    }

    protected completionForKeyword(context: CompletionContext, keyword: GrammarAST.Keyword, acceptor: CompletionAcceptor): MaybePromise<void> {
        if (!this.filterKeyword(context, keyword)) {
            return;
        }
        acceptor(context, {
            label: keyword.value,
            kind: CompletionItemKind.Keyword,
            detail: 'Keyword',
            sortText: '1'
        });
    }

    protected filterKeyword(_context: CompletionContext, keyword: GrammarAST.Keyword): boolean {
        return /\p{L}/u.test(keyword.value);
    }

    protected completionForCrossReference(context: CompletionContext, next: NextFeature<GrammarAST.CrossReference>, acceptor: CompletionAcceptor): MaybePromise<void> {
        const assignment = AstUtils.getContainerOfType(next.feature, GrammarAST.isAssignment);
        let node = context.node;
        if (assignment && node) {
            if (next.type) {
                node = {
                    $type: next.type,
                    $container: node,
                    $containerProperty: next.property
                };
                AstUtils.assignMandatoryProperties(this.astReflection, node);
            }
            let reference: Reference | MultiReference;
            if (next.feature.isMulti) {
                reference = { $refText: '', items: [] };
            } else {
                reference = { $refText: '', ref: undefined };
            }
            const refInfo: ReferenceInfo = {
                reference,
                container: node,
                property: assignment.feature
            };
            try {
                for (const candidate of this.scopeProvider.getScope(refInfo).getAllElements()) {
                    acceptor(context, this.createReferenceCompletionItem(candidate));
                }
            } catch (err) {
                console.error(err);
            }
        }
    }

    protected createReferenceCompletionItem(nodeDescription: AstNodeDescription): CompletionValueItem {
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

    // ---- Item Formatting ----

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
                range: { start, end }
            };
        } else {
            return undefined;
        }
    }

    // ---- Utilities ----

    protected continueCompletion(items: CompletionItem[]): boolean {
        return items.length === 0;
    }

    protected deduplicateItems(items: CompletionItem[]): CompletionItem[] {
        return stream(items).distinct(item => `${item.kind}_${item.label}_${item.detail}`).toArray();
    }
}
