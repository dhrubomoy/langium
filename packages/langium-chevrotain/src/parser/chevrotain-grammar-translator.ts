/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type {
    Grammar,
    GrammarTranslator,
    TranslationDiagnostic,
    TranslationResult
} from 'langium-core';
import { GrammarAST } from 'langium-core';

/**
 * Grammar translator for the Chevrotain backend.
 *
 * Chevrotain does not need build-time grammar compilation (it interprets grammar
 * at runtime), so `translate()` is a no-op. The primary purpose of this class is
 * to validate that the grammar does not use Phase 3 features that are unsupported
 * or only partially supported by Chevrotain, and to report appropriate diagnostics.
 *
 * Feature support:
 * - `external context`      → error  (requires Lezer backend)
 * - `conflicts`             → error  (requires GLR / Lezer backend)
 * - `@dynamicPrecedence`    → error  (requires Lezer backend)
 * - `@precMarker`           → warning (desugared to rule ordering; complex cases may not work)
 * - `extend` blocks         → warning (limited support)
 * - `external tokens`       → warning (mapped to custom matcher interface)
 * - `specialize` blocks     → ok     (mapped to keyword config / LONGER_ALT)
 * - `local tokens`          → warning (mapped to lexer modes)
 * - Precedence blocks       → ok     (informational only; Chevrotain uses different model)
 */
export class ChevrotainGrammarTranslator implements GrammarTranslator {
    readonly backend = 'chevrotain';

    validate(grammar: Grammar): TranslationDiagnostic[] {
        const diagnostics: TranslationDiagnostic[] = [];

        this.validateExternalContext(grammar, diagnostics);
        this.validateConflicts(grammar, diagnostics);
        this.validateDynamicPrecedence(grammar, diagnostics);
        this.validatePrecMarker(grammar, diagnostics);
        this.validateExtendBlocks(grammar, diagnostics);
        this.validateExternalTokens(grammar, diagnostics);
        this.validateLocalTokens(grammar, diagnostics);

        // Also run the shared validations (same as Lezer)
        this.validatePrecedenceLevels(grammar, diagnostics);
        this.validateExternalContextCount(grammar, diagnostics);
        this.validateSpecializeExtend(grammar, diagnostics);

        return diagnostics;
    }

    async translate(_grammar: Grammar, _outputDir: string): Promise<TranslationResult> {
        // Chevrotain interprets grammar at runtime — no build-time output needed.
        return { outputFiles: [], diagnostics: [] };
    }

    // ---- Unsupported features (errors) ----

    private validateExternalContext(grammar: Grammar, diagnostics: TranslationDiagnostic[]): void {
        for (const ctx of grammar.externalContexts ?? []) {
            diagnostics.push({
                message: `External context trackers require the Lezer backend. '${ctx.name}' cannot be used with Chevrotain.`,
                severity: 'error',
                source: 'external context',
                suggestion: 'Use --backend=lezer or remove the external context declaration.'
            });
        }
    }

    private validateConflicts(grammar: Grammar, diagnostics: TranslationDiagnostic[]): void {
        for (const block of grammar.conflictBlocks ?? []) {
            for (const set of block.sets) {
                const ruleNames = set.rules
                    .map(r => r.ref?.name)
                    .filter((n): n is string => n !== undefined);
                diagnostics.push({
                    message: `Conflict declarations require the Lezer backend (GLR parsing). Conflict set [${ruleNames.join(', ')}] cannot be used with Chevrotain.`,
                    severity: 'error',
                    source: 'conflicts',
                    suggestion: 'Use --backend=lezer or remove the conflicts block.'
                });
            }
        }
    }

    private validateDynamicPrecedence(grammar: Grammar, diagnostics: TranslationDiagnostic[]): void {
        for (const rule of grammar.rules) {
            if (GrammarAST.isParserRule(rule)) {
                this.walkElements(rule.definition, element => {
                    if (element.dynamicPrecedence !== undefined) {
                        diagnostics.push({
                            message: `Dynamic precedence requires the Lezer backend. @dynamicPrecedence(${element.dynamicPrecedence}) in rule '${rule.name}' cannot be used with Chevrotain.`,
                            severity: 'error',
                            source: rule.name,
                            suggestion: 'Use --backend=lezer or remove the @dynamicPrecedence annotation.'
                        });
                    }
                });
            }
        }
    }

    // ---- Partially supported features (warnings) ----

    private validatePrecMarker(grammar: Grammar, diagnostics: TranslationDiagnostic[]): void {
        let hasPrecMarker = false;
        for (const rule of grammar.rules) {
            if (GrammarAST.isParserRule(rule)) {
                this.walkElements(rule.definition, element => {
                    if (element.precMarker) {
                        hasPrecMarker = true;
                    }
                });
            }
        }
        if (hasPrecMarker) {
            diagnostics.push({
                message: 'Precedence markers are desugared for Chevrotain; complex cases may not work correctly.',
                severity: 'warning',
                source: 'precedence'
            });
        }
    }

    private validateExtendBlocks(grammar: Grammar, diagnostics: TranslationDiagnostic[]): void {
        if ((grammar.extendBlocks ?? []).length > 0) {
            diagnostics.push({
                message: 'Token extension has limited support with Chevrotain.',
                severity: 'warning',
                source: 'extend'
            });
        }
    }

    private validateExternalTokens(grammar: Grammar, diagnostics: TranslationDiagnostic[]): void {
        if ((grammar.externalTokenBlocks ?? []).length > 0) {
            diagnostics.push({
                message: 'External tokens are mapped to custom matcher interface with Chevrotain. Ensure your tokenizer modules implement the Chevrotain custom token pattern API.',
                severity: 'warning',
                source: 'external tokens'
            });
        }
    }

    private validateLocalTokens(grammar: Grammar, diagnostics: TranslationDiagnostic[]): void {
        if ((grammar.localTokenBlocks ?? []).length > 0) {
            diagnostics.push({
                message: 'Local token groups are mapped to Chevrotain lexer modes. Verify that your lexer mode configuration is correct.',
                severity: 'warning',
                source: 'local tokens'
            });
        }
    }

    // ---- Shared validations (same as Lezer) ----

    private validatePrecedenceLevels(grammar: Grammar, diagnostics: TranslationDiagnostic[]): void {
        const definedNames = new Set<string>();
        for (const block of grammar.precedenceBlocks ?? []) {
            for (const level of block.levels) {
                if (definedNames.has(level.name)) {
                    diagnostics.push({
                        message: `Duplicate precedence level '${level.name}'.`,
                        severity: 'error',
                        source: 'precedence'
                    });
                }
                definedNames.add(level.name);
            }
        }

        // Validate @precMarker references
        if (definedNames.size > 0) {
            for (const rule of grammar.rules) {
                if (GrammarAST.isParserRule(rule)) {
                    this.walkElements(rule.definition, element => {
                        if (element.precMarker && !definedNames.has(element.precMarker)) {
                            diagnostics.push({
                                message: `Precedence tag '${element.precMarker}' is not defined in any precedence block.`,
                                severity: 'error',
                                source: rule.name
                            });
                        }
                    });
                }
            }
        }
    }

    private validateExternalContextCount(grammar: Grammar, diagnostics: TranslationDiagnostic[]): void {
        if ((grammar.externalContexts ?? []).length > 1) {
            diagnostics.push({
                message: 'Only one external context tracker is allowed per grammar.',
                severity: 'error',
                source: 'external context'
            });
        }
    }

    private validateSpecializeExtend(grammar: Grammar, diagnostics: TranslationDiagnostic[]): void {
        for (const block of grammar.specializeBlocks ?? []) {
            const seen = new Set<string>();
            for (const mapping of block.mappings) {
                if (seen.has(mapping.source)) {
                    diagnostics.push({
                        message: `Duplicate specialize mapping for '${mapping.source}'.`,
                        severity: 'warning',
                        source: 'specialize'
                    });
                }
                seen.add(mapping.source);
            }
        }
        for (const block of grammar.extendBlocks ?? []) {
            const seen = new Set<string>();
            for (const mapping of block.mappings) {
                if (seen.has(mapping.source)) {
                    diagnostics.push({
                        message: `Duplicate extend mapping for '${mapping.source}'.`,
                        severity: 'warning',
                        source: 'extend'
                    });
                }
                seen.add(mapping.source);
            }
        }
    }

    // ---- Utilities ----

    private walkElements(element: GrammarAST.AbstractElement, visitor: (el: GrammarAST.AbstractElement) => void): void {
        visitor(element);
        if (GrammarAST.isGroup(element) || GrammarAST.isAlternatives(element) || GrammarAST.isUnorderedGroup(element)) {
            for (const child of (element as GrammarAST.Group | GrammarAST.Alternatives | GrammarAST.UnorderedGroup).elements) {
                this.walkElements(child, visitor);
            }
        }
        if (GrammarAST.isAssignment(element)) {
            this.walkElements(element.terminal, visitor);
        }
    }
}
