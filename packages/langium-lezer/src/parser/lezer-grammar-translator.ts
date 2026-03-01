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
import { convertRegexToLezer, validateRegexForLezer } from './regex-to-lezer.js';
import type { FieldMapData } from './field-map.js';

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Translates a Langium Grammar AST into a Lezer grammar file and generates
 * parse tables using `@lezer/generator`.
 *
 * Called at build time by `langium-cli` when `--backend=lezer` is specified.
 *
 * Translation pipeline:
 *   Langium Grammar AST → .grammar file (Lezer grammar syntax)
 *                        → @lezer/generator buildParserFile()
 *                        → .parser.ts (parse tables as JS/TS module)
 *                        → .field-map.json (field name mapping)
 */
export class LezerGrammarTranslator implements GrammarTranslator {
    readonly backend = 'lezer';

    validate(grammar: Grammar): TranslationDiagnostic[] {
        const diagnostics: TranslationDiagnostic[] = [];

        for (const rule of grammar.rules) {
            if (GrammarAST.isTerminalRule(rule)) {
                this.validateTerminalRule(rule, diagnostics);
            }
            if (GrammarAST.isParserRule(rule)) {
                this.validateParserRule(rule, diagnostics);
            }
        }

        // Phase 3 validations
        this.validatePrecedence(grammar, diagnostics);
        this.validateExternalContext(grammar, diagnostics);
        this.validateSpecializeExtend(grammar, diagnostics);

        return diagnostics;
    }

    async translate(grammar: Grammar, outputDir: string): Promise<TranslationResult> {
        const diagnostics: TranslationDiagnostic[] = [];
        const outputFiles: string[] = [];

        // Validate first
        const validationDiags = this.validate(grammar);
        diagnostics.push(...validationDiags);
        if (validationDiags.some(d => d.severity === 'error')) {
            return { outputFiles, diagnostics };
        }

        const languageId = grammar.name ?? 'language';

        // Step 1: Generate the Lezer grammar text
        const { grammarText, fieldMapData, keywords } = this.generateLezerGrammar(grammar);

        // Step 2: Write the .grammar file
        const grammarPath = path.join(outputDir, `${languageId}.grammar`);
        await fs.promises.mkdir(outputDir, { recursive: true });
        await fs.promises.writeFile(grammarPath, grammarText, 'utf-8');
        outputFiles.push(grammarPath);

        // Step 3: Write the field map JSON
        const fieldMapPath = path.join(outputDir, `${languageId}.field-map.json`);
        await fs.promises.writeFile(fieldMapPath, JSON.stringify(fieldMapData, null, 2), 'utf-8');
        outputFiles.push(fieldMapPath);

        // Step 4: Write the keyword set JSON
        const keywordsPath = path.join(outputDir, `${languageId}.keywords.json`);
        await fs.promises.writeFile(keywordsPath, JSON.stringify([...keywords]), 'utf-8');
        outputFiles.push(keywordsPath);

        // Step 5: Generate parse tables using @lezer/generator
        try {
            const { buildParserFile } = await import('@lezer/generator');
            const { parser: parserCode, terms: termsCode } = buildParserFile(grammarText, {
                moduleStyle: 'es',
            });
            const parserPath = path.join(outputDir, `${languageId}.parser.ts`);
            await fs.promises.writeFile(parserPath, parserCode, 'utf-8');
            outputFiles.push(parserPath);

            // Write terms file
            const termsPath = path.join(outputDir, `${languageId}.terms.ts`);
            await fs.promises.writeFile(termsPath, termsCode, 'utf-8');
            outputFiles.push(termsPath);
        } catch (e) {
            diagnostics.push({
                message: `Failed to generate Lezer parse tables: ${e instanceof Error ? e.message : String(e)}`,
                severity: 'error',
                source: '@lezer/generator'
            });
        }

        return { outputFiles, diagnostics };
    }

    /**
     * Generate Lezer grammar text, field map, and keywords in memory (no file I/O).
     * Used by tests and tooling that need parse tables without writing to disk.
     */
    generateGrammarInMemory(grammar: Grammar): {
        grammarText: string;
        fieldMapData: FieldMapData;
        keywords: Set<string>;
    } {
        return this.generateLezerGrammar(grammar);
    }

    // ---- Grammar generation ----

    private generateLezerGrammar(grammar: Grammar): {
        grammarText: string;
        fieldMapData: FieldMapData;
        keywords: Set<string>;
    } {
        const lines: string[] = [];
        const fieldMapData: FieldMapData = {};
        const keywords = new Set<string>();
        const hiddenTerminals: GrammarAST.TerminalRule[] = [];
        const visibleTerminals: GrammarAST.TerminalRule[] = [];
        const wrapperRules: string[] = [];

        // Collect names of externally-provided and locally-scoped tokens
        // so they are excluded from the main @tokens block
        const excludedTokenNames = new Set<string>();
        for (const block of grammar.externalTokenBlocks ?? []) {
            for (const tok of block.tokens) {
                excludedTokenNames.add(tok.name);
            }
        }
        for (const block of grammar.localTokenBlocks ?? []) {
            for (const terminal of block.terminals) {
                excludedTokenNames.add(terminal.name);
            }
        }

        // Separate rules by type
        for (const rule of grammar.rules) {
            if (GrammarAST.isTerminalRule(rule) && rule.hidden) {
                hiddenTerminals.push(rule);
            } else if (GrammarAST.isTerminalRule(rule)) {
                visibleTerminals.push(rule);
            }
        }

        // Build conflict marker map for rule body injection
        const conflictMarkers = this.buildConflictMarkerMap(grammar);

        // ---- Top-level declarations (order matters for Lezer) ----

        // 1. Emit unified @precedence declaration (merging PrecedenceBlocks + InfixRule levels)
        const precLevels = this.collectPrecedenceLevels(grammar);
        if (precLevels.length > 0) {
            const decls = precLevels.map(l => `${l.name} @${l.associativity}`);
            lines.push(`@precedence { ${decls.join(', ')} }`);
            lines.push('');
        }

        // 2. Emit @external tokens declarations
        for (const block of grammar.externalTokenBlocks ?? []) {
            lines.push(this.translateExternalTokenBlock(block));
        }
        if ((grammar.externalTokenBlocks ?? []).length > 0) {
            lines.push('');
        }

        // 3. Emit @context declaration (at most one)
        for (const ctx of grammar.externalContexts ?? []) {
            lines.push(this.translateExternalContext(ctx));
        }
        if ((grammar.externalContexts ?? []).length > 0) {
            lines.push('');
        }

        // 4. Emit @top rule
        for (const rule of grammar.rules) {
            if (GrammarAST.isParserRule(rule) && rule.entry) {
                const { body, dynamicPrec } = this.translateParserRuleBodyWithMeta(
                    rule, rule.definition, fieldMapData, keywords, wrapperRules, conflictMarkers
                );
                const annotation = dynamicPrec !== undefined ? `[@dynamicPrecedence=${dynamicPrec}]` : '';
                lines.push(`@top ${rule.name}${annotation} { ${body} }`);
                lines.push('');
                break;
            }
        }

        // 5. Emit @skip declaration for hidden terminals
        if (hiddenTerminals.length > 0) {
            const skipNames = hiddenTerminals.map(t => this.getLezerTerminalName(t));
            lines.push(`@skip { ${skipNames.join(' | ')} }`);
            lines.push('');
        }

        // 6. Emit infix rules (no longer emit per-rule @precedence — it's merged above)
        for (const rule of grammar.rules) {
            if (GrammarAST.isInfixRule(rule)) {
                const infixLines = this.translateInfixRule(rule, keywords);
                lines.push(...infixLines);
                lines.push('');
            }
        }

        // 7. Emit parser rules (non-entry, non-infix) with @dynamicPrecedence and ~conflict markers
        for (const rule of grammar.rules) {
            if (GrammarAST.isParserRule(rule) && !rule.entry && !rule.fragment) {
                const { body, dynamicPrec } = this.translateParserRuleBodyWithMeta(
                    rule, rule.definition, fieldMapData, keywords, wrapperRules, conflictMarkers
                );
                const annotation = dynamicPrec !== undefined ? `[@dynamicPrecedence=${dynamicPrec}]` : '';
                lines.push(`${rule.name}${annotation} { ${body} }`);
                lines.push('');
            }
        }

        // 8. Emit fragment rules (lowercase name = hidden in Lezer)
        for (const rule of grammar.rules) {
            if (GrammarAST.isParserRule(rule) && rule.fragment) {
                const name = this.toLowerCamel(rule.name);
                const body = this.translateParserRuleBody(rule, rule.definition, fieldMapData, keywords, wrapperRules);
                lines.push(`${name} { ${body} }`);
                lines.push('');
            }
        }

        // 9. Emit wrapper rules for field access
        if (wrapperRules.length > 0) {
            lines.push('// Wrapper rules for field access');
            lines.push(...wrapperRules);
            lines.push('');
        }

        // 10. Emit keyword template
        if (keywords.size > 0) {
            lines.push(`kw<term> { @specialize[@name={term}]<Identifier, term> }`);
            lines.push('');
        }

        // 11. Emit specialize/extend rules from explicit blocks
        for (const block of grammar.specializeBlocks ?? []) {
            const specRules = this.translateSpecializeBlock(block, keywords);
            lines.push(...specRules);
        }
        for (const block of grammar.extendBlocks ?? []) {
            const extRules = this.translateExtendBlock(block, keywords);
            lines.push(...extRules);
        }
        if ((grammar.specializeBlocks ?? []).length + (grammar.extendBlocks ?? []).length > 0) {
            lines.push('');
        }

        // 12. Emit @local tokens blocks
        for (const block of grammar.localTokenBlocks ?? []) {
            lines.push(...this.translateLocalTokenBlock(block));
            lines.push('');
        }

        // 13. Emit @tokens block (excluding external and local token names)
        lines.push('@tokens {');

        // Emit @precedence inside @tokens if token precedence blocks are present
        const tokenPrecEntries = this.collectTokenPrecedenceEntries(grammar);
        if (tokenPrecEntries.length > 0) {
            lines.push(`  @precedence { ${tokenPrecEntries.join(', ')} }`);
        }

        for (const terminal of visibleTerminals) {
            if (excludedTokenNames.has(terminal.name)) continue;
            const tokenBody = this.translateTerminalBody(terminal);
            const name = this.getLezerTerminalName(terminal);
            lines.push(`  ${name} { ${tokenBody} }`);
        }
        for (const terminal of hiddenTerminals) {
            if (excludedTokenNames.has(terminal.name)) continue;
            const tokenBody = this.translateTerminalBody(terminal);
            const name = this.getLezerTerminalName(terminal);
            lines.push(`  ${name} { ${tokenBody} }`);
        }
        lines.push('}');

        return {
            grammarText: lines.join('\n'),
            fieldMapData,
            keywords
        };
    }

    // ---- Phase 3: Precedence collection ----

    private collectPrecedenceLevels(grammar: Grammar): Array<{ name: string; associativity: string }> {
        const levels: Array<{ name: string; associativity: string }> = [];

        // From explicit PrecedenceBlock declarations
        for (const block of grammar.precedenceBlocks ?? []) {
            for (const level of block.levels) {
                levels.push({
                    name: level.name,
                    associativity: level.associativity ?? 'left'
                });
            }
        }

        // From infix rules (generated precedence names)
        for (const rule of grammar.rules) {
            if (GrammarAST.isInfixRule(rule)) {
                for (let i = 0; i < rule.operators.precedences.length; i++) {
                    const precLevel = rule.operators.precedences[i];
                    levels.push({
                        name: `prec_${rule.name}_${i}`,
                        associativity: precLevel.associativity ?? 'left'
                    });
                }
            }
        }

        return levels;
    }

    // ---- Phase 3: Token precedence ----

    private collectTokenPrecedenceEntries(grammar: Grammar): string[] {
        const entries: string[] = [];
        for (const block of grammar.tokenPrecedenceBlocks ?? []) {
            for (const entry of block.entries) {
                if (entry.terminal?.ref) {
                    entries.push(this.getLezerTerminalName(entry.terminal.ref));
                } else if (entry.literal) {
                    entries.push(`"${this.escapeLezerString(entry.literal)}"`);
                }
            }
        }
        return entries;
    }

    // ---- Phase 3: External tokens + context ----

    private translateExternalTokenBlock(block: GrammarAST.ExternalTokenBlock): string {
        const tokenizerName = this.pathToIdentifier(block.path);
        const tokenNames = block.tokens.map(t => t.name).join(', ');
        return `@external tokens ${tokenizerName} from "${block.path}" { ${tokenNames} }`;
    }

    private translateExternalContext(ctx: GrammarAST.ExternalContext): string {
        return `@context ${ctx.name} from "${ctx.path}"`;
    }

    private pathToIdentifier(modulePath: string): string {
        const basename = modulePath.split('/').pop() ?? modulePath;
        // Remove leading dot, convert dashes to camelCase
        return basename
            .replace(/^\./, '')
            .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
            .replace(/\.[^.]*$/, ''); // Remove file extension if present
    }

    // ---- Phase 3: Specialize / Extend blocks ----

    private translateSpecializeBlock(
        block: GrammarAST.SpecializeBlock,
        keywords: Set<string>
    ): string[] {
        const terminalRef = block.terminal.ref;
        if (!terminalRef) return [];
        const lezerTermName = this.getLezerTerminalName(terminalRef);

        return block.mappings.map(mapping => {
            keywords.add(mapping.source);
            const source = this.escapeLezerString(mapping.source);
            return `${mapping.target} { @specialize[@name={${mapping.target}}]<${lezerTermName}, "${source}"> }`;
        });
    }

    private translateExtendBlock(
        block: GrammarAST.ExtendBlock,
        keywords: Set<string>
    ): string[] {
        const terminalRef = block.terminal.ref;
        if (!terminalRef) return [];
        const lezerTermName = this.getLezerTerminalName(terminalRef);

        return block.mappings.map(mapping => {
            keywords.add(mapping.source);
            const source = this.escapeLezerString(mapping.source);
            return `${mapping.target} { @extend[@name={${mapping.target}}]<${lezerTermName}, "${source}"> }`;
        });
    }

    // ---- Phase 3: Conflict markers ----

    /**
     * Build a map of rule name → conflict markers to inject into rule bodies.
     * Best-effort: detects shared first element between conflicting rules.
     */
    private buildConflictMarkerMap(grammar: Grammar): Map<string, string[]> {
        const markers = new Map<string, string[]>();

        for (const block of grammar.conflictBlocks ?? []) {
            for (const set of block.sets) {
                const ruleNames = set.rules
                    .map(r => r.ref?.name)
                    .filter((n): n is string => n !== undefined);
                if (ruleNames.length < 2) continue;

                const markerName = `conflict_${ruleNames.join('_')}`;

                // Add marker to each rule in the conflict set
                for (const ruleName of ruleNames) {
                    const existing = markers.get(ruleName) ?? [];
                    existing.push(markerName);
                    markers.set(ruleName, existing);
                }
            }
        }

        return markers;
    }

    // ---- Phase 3: Local token blocks ----

    private translateLocalTokenBlock(block: GrammarAST.LocalTokenBlock): string[] {
        const lines: string[] = [];
        const ruleName = block.rule.ref?.name ?? 'Unknown';

        lines.push('@local tokens {');
        for (const terminal of block.terminals) {
            const tokenBody = this.translateTerminalBody(terminal);
            lines.push(`  ${terminal.name} { ${tokenBody} }`);
        }
        lines.push(`  @else ${ruleName}Content`);
        lines.push('}');

        return lines;
    }

    // ---- Parser rule translation ----

    private translateParserRuleBody(
        rule: GrammarAST.ParserRule,
        element: GrammarAST.AbstractElement,
        fieldMapData: FieldMapData,
        keywords: Set<string>,
        wrapperRules: string[]
    ): string {
        return this.translateElement(rule.name, element, fieldMapData, keywords, wrapperRules);
    }

    /**
     * Translate a parser rule body and extract @dynamicPrecedence if present.
     * Also injects ~conflict markers based on the conflict marker map.
     */
    private translateParserRuleBodyWithMeta(
        rule: GrammarAST.ParserRule,
        element: GrammarAST.AbstractElement,
        fieldMapData: FieldMapData,
        keywords: Set<string>,
        wrapperRules: string[],
        conflictMarkers: Map<string, string[]>
    ): { body: string; dynamicPrec?: number } {
        let body = this.translateElement(rule.name, element, fieldMapData, keywords, wrapperRules);

        // Inject conflict markers at the start of the rule body
        const markers = conflictMarkers.get(rule.name);
        if (markers && markers.length > 0) {
            const markerStr = markers.map(m => `~${m}`).join(' ');
            body = `${markerStr} ${body}`;
        }

        // Detect @dynamicPrecedence on the top-level definition element
        const dynPrec = this.findDynamicPrecedence(element);

        return { body, dynamicPrec: dynPrec };
    }

    private findDynamicPrecedence(element: GrammarAST.AbstractElement): number | undefined {
        // Check the element itself
        if (element.dynamicPrecedence !== undefined) {
            return element.dynamicPrecedence;
        }
        // Check immediate children (e.g., first element in a Group)
        if (GrammarAST.isGroup(element)) {
            for (const child of element.elements) {
                if (child.dynamicPrecedence !== undefined) {
                    return child.dynamicPrecedence;
                }
            }
        }
        return undefined;
    }

    private translateElement(
        parentRuleName: string,
        element: GrammarAST.AbstractElement,
        fieldMapData: FieldMapData,
        keywords: Set<string>,
        wrapperRules: string[]
    ): string {
        let result = this.translateElementCore(parentRuleName, element, fieldMapData, keywords, wrapperRules);

        // Apply @precMarker — Lezer !tag syntax before the element
        if (element.precMarker) {
            result = `!${element.precMarker} ${result}`;
        }

        // Apply cardinality
        if (element.cardinality) {
            if (element.cardinality === '?' || element.cardinality === '*' || element.cardinality === '+') {
                // If result has spaces (is a complex expression), wrap in parens
                if (result.includes(' ') && !result.startsWith('(')) {
                    result = `(${result})`;
                }
                result += element.cardinality;
            }
        }

        return result;
    }

    private translateElementCore(
        parentRuleName: string,
        element: GrammarAST.AbstractElement,
        fieldMapData: FieldMapData,
        keywords: Set<string>,
        wrapperRules: string[]
    ): string {
        if (GrammarAST.isKeyword(element)) {
            return this.translateKeyword(element, keywords);
        }

        if (GrammarAST.isRuleCall(element)) {
            return this.translateRuleCall(element);
        }

        if (GrammarAST.isAssignment(element)) {
            return this.translateAssignment(
                parentRuleName,
                element,
                fieldMapData,
                keywords,
                wrapperRules
            );
        }

        if (GrammarAST.isAlternatives(element)) {
            return this.translateAlternatives(
                parentRuleName,
                element,
                fieldMapData,
                keywords,
                wrapperRules
            );
        }

        if (GrammarAST.isGroup(element)) {
            return this.translateGroup(
                parentRuleName,
                element,
                fieldMapData,
                keywords,
                wrapperRules
            );
        }

        if (GrammarAST.isCrossReference(element)) {
            return this.translateCrossReference(element);
        }

        if (GrammarAST.isAction(element)) {
            return this.translateAction(element);
        }

        if (GrammarAST.isUnorderedGroup(element)) {
            return this.translateUnorderedGroup(
                parentRuleName,
                element,
                fieldMapData,
                keywords,
                wrapperRules
            );
        }

        // Fallback for unknown element types
        return `/* unknown: ${element.$type} */`;
    }

    private translateKeyword(kw: GrammarAST.Keyword, keywords: Set<string>): string {
        keywords.add(kw.value);
        // Use kw<> template for identifier-like keywords to make them named nodes in the tree.
        // @specialize creates a named specialization of Identifier, so the keyword appears
        // as a visible node (Lezer skips anonymous inline string tokens from the tree).
        if (/^[_a-zA-Z]\w*$/.test(kw.value)) {
            return `kw<"${this.escapeLezerString(kw.value)}">`;
        }
        // Non-identifier keywords (operators, punctuation) use inline syntax
        return `"${this.escapeLezerString(kw.value)}"`;
    }

    private translateRuleCall(ruleCall: GrammarAST.RuleCall): string {
        const ref = ruleCall.rule.ref;
        if (!ref) return '/* unresolved rule */';
        if (GrammarAST.isParserRule(ref) && ref.fragment) {
            return this.toLowerCamel(ref.name);
        }
        if (GrammarAST.isTerminalRule(ref)) {
            return this.getLezerTerminalName(ref);
        }
        return ref.name;
    }

    private translateAssignment(
        parentRuleName: string,
        assignment: GrammarAST.Assignment,
        fieldMapData: FieldMapData,
        keywords: Set<string>,
        wrapperRules: string[]
    ): string {
        const fieldName = assignment.feature;
        // Generate a wrapper nonterminal name: ParentField
        const wrapperName = `${parentRuleName}${this.capitalize(fieldName)}`;

        // Translate the assigned terminal/rule
        const inner = this.translateElement(parentRuleName, assignment.terminal, fieldMapData, keywords, wrapperRules);

        // Register in field map
        if (!fieldMapData[parentRuleName]) {
            (fieldMapData as Record<string, Record<string, string[]>>)[parentRuleName] = {};
        }
        const parentFields = fieldMapData[parentRuleName] as Record<string, string[]>;
        if (!parentFields[fieldName]) {
            parentFields[fieldName] = [];
        }
        if (!parentFields[fieldName].includes(wrapperName)) {
            parentFields[fieldName].push(wrapperName);
        }

        // Emit wrapper rule (deduplicate — same field name may appear multiple times,
        // e.g. `params+=Param (',' params+=Param)*`)
        const wrapperDef = `${wrapperName} { ${inner} }`;
        if (!wrapperRules.includes(wrapperDef)) {
            wrapperRules.push(wrapperDef);
        }

        return wrapperName;
    }

    private translateAlternatives(
        parentRuleName: string,
        alternatives: GrammarAST.Alternatives,
        fieldMapData: FieldMapData,
        keywords: Set<string>,
        wrapperRules: string[]
    ): string {
        const parts = alternatives.elements.map(el =>
            this.translateElement(parentRuleName, el, fieldMapData, keywords, wrapperRules)
        );
        return parts.join(' | ');
    }

    private translateGroup(
        parentRuleName: string,
        group: GrammarAST.Group,
        fieldMapData: FieldMapData,
        keywords: Set<string>,
        wrapperRules: string[]
    ): string {
        const parts = group.elements.map(el =>
            this.translateElement(parentRuleName, el, fieldMapData, keywords, wrapperRules)
        );
        return parts.join(' ');
    }

    private translateCrossReference(crossRef: GrammarAST.CrossReference): string {
        // Cross-references resolve to the terminal used to identify them
        if (crossRef.terminal) {
            if (GrammarAST.isRuleCall(crossRef.terminal)) {
                const ref = (crossRef.terminal as GrammarAST.RuleCall).rule.ref;
                if (ref && GrammarAST.isTerminalRule(ref)) {
                    return this.getLezerTerminalName(ref);
                }
                return ref?.name ?? 'Identifier';
            }
        }
        // Default to Identifier token
        return 'Identifier';
    }

    private translateAction(_action: GrammarAST.Action): string {
        // Actions don't produce Lezer syntax directly.
        // The AST builder handles action types using $type resolution.
        return '';
    }

    private translateUnorderedGroup(
        parentRuleName: string,
        group: GrammarAST.UnorderedGroup,
        fieldMapData: FieldMapData,
        keywords: Set<string>,
        wrapperRules: string[]
    ): string {
        // Unordered groups: expand into all permutations
        // For small groups, enumerate. For large groups, warn.
        const elements = group.elements;
        if (elements.length > 4) {
            // Too many permutations — emit a warning and use sequential order
            return elements.map(el =>
                this.translateElement(parentRuleName, el, fieldMapData, keywords, wrapperRules)
            ).join(' ');
        }

        const translated = elements.map(el =>
            this.translateElement(parentRuleName, el, fieldMapData, keywords, wrapperRules)
        );

        // Generate all permutations
        const perms = this.permutations(translated);
        return perms.map(p => p.join(' ')).join(' | ');
    }

    // ---- Infix rule translation ----

    private translateInfixRule(rule: GrammarAST.InfixRule, keywords: Set<string>): string[] {
        const lines: string[] = [];
        const ruleAlternatives: string[] = [];

        // Each precedence level in the operators
        for (let i = 0; i < rule.operators.precedences.length; i++) {
            const precLevel = rule.operators.precedences[i];
            const precName = `prec_${rule.name}_${i}`;

            const assoc = precLevel.associativity ?? 'left';
            const ops = precLevel.operators.map(op => {
                keywords.add(op.value);
                // Use kw<> template for identifier-like operators (e.g. "and", "or")
                // to avoid Lezer token conflicts with the Identifier terminal.
                if (/^[_a-zA-Z]\w*$/.test(op.value)) {
                    return `kw<"${this.escapeLezerString(op.value)}">`;
                }
                return `"${this.escapeLezerString(op.value)}"`;
            });

            // Each operator at this precedence level becomes an alternative.
            // Use the rule's own name (self-reference) for left-recursive Lezer expressions.
            // Lezer (LR) requires `BinExpr !prec op BinExpr | AtomicExpr` to parse chained
            // binary operators like `1 + 2 * 3`. The `on <Operand>` rule is only the fallback.
            for (const op of ops) {
                ruleAlternatives.push(`${rule.name} !${precName} ${op} ${rule.name}`);
            }

            lines.push(`// precedence ${i}: ${precLevel.operators.map(o => o.value).join(', ')} (${assoc})`);
        }

        // No per-rule @precedence — it's in the merged declaration at the top

        // Emit the rule
        const operandRef = rule.call.rule.ref?.name ?? 'expr';
        ruleAlternatives.push(operandRef);
        lines.push(`${rule.name} { ${ruleAlternatives.join(' | ')} }`);

        return lines;
    }

    // ---- Terminal rule translation ----

    private translateTerminalBody(terminal: GrammarAST.TerminalRule): string {
        return this.translateTerminalElement(terminal.definition);
    }

    private translateTerminalElement(element: GrammarAST.AbstractElement): string {
        if (GrammarAST.isRegexToken(element)) {
            return this.translateRegexToken(element);
        }

        if (GrammarAST.isKeyword(element)) {
            return `"${this.escapeLezerString(element.value)}"`;
        }

        if (GrammarAST.isTerminalAlternatives(element)) {
            const parts = element.elements.map(e =>
                this.translateTerminalElement(e)
            );
            let result = parts.join(' | ');
            if (element.cardinality) {
                result = `(${result})${element.cardinality}`;
            }
            return result;
        }

        if (GrammarAST.isTerminalGroup(element)) {
            const parts = element.elements.map(e =>
                this.translateTerminalElement(e)
            );
            let result = parts.join(' ');
            if (element.cardinality) {
                result = `(${result})${element.cardinality}`;
            }
            return result;
        }

        // Fallback
        return `/* terminal: ${element.$type} */`;
    }

    private translateRegexToken(token: GrammarAST.RegexToken): string {
        // Strip regex delimiters (Langium stores the pattern with /.../ delimiters)
        let pattern = token.regex;
        if (pattern.startsWith('/') && pattern.endsWith('/')) {
            pattern = pattern.slice(1, -1);
        }
        const conversion = convertRegexToLezer(pattern);
        if (conversion.lezerSyntax) {
            let result = conversion.lezerSyntax;
            if (token.cardinality) {
                result = `(${result})${token.cardinality}`;
            }
            return result;
        }
        // If conversion failed, emit as a comment
        return `/* regex: ${token.regex} */`;
    }

    // ---- Validation ----

    private validateTerminalRule(rule: GrammarAST.TerminalRule, diagnostics: TranslationDiagnostic[]): void {
        this.walkTerminalElements(rule.definition, element => {
            if (GrammarAST.isRegexToken(element)) {
                let pattern = element.regex;
                if (pattern.startsWith('/') && pattern.endsWith('/')) {
                    pattern = pattern.slice(1, -1);
                }
                const error = validateRegexForLezer(pattern);
                if (error) {
                    diagnostics.push({
                        message: `Terminal '${rule.name}' ${error}. Rewrite using string body syntax.`,
                        severity: 'error',
                        source: rule.name,
                        suggestion: `terminal ${rule.name}: 'lezer_token_syntax';`
                    });
                }
            }
        });
    }

    private validateParserRule(rule: GrammarAST.ParserRule, diagnostics: TranslationDiagnostic[]): void {
        this.walkElements(rule.definition, element => {
            if (GrammarAST.isUnorderedGroup(element)) {
                if (element.elements.length > 4) {
                    const n = element.elements.length;
                    diagnostics.push({
                        message: `Unordered group in '${rule.name}' expands to ${this.factorial(n)} permutations; consider restructuring.`,
                        severity: 'warning',
                        source: rule.name
                    });
                }
            }
        });
    }

    // ---- Phase 3 validations ----

    private validatePrecedence(grammar: Grammar, diagnostics: TranslationDiagnostic[]): void {
        // Collect all defined precedence level names
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

    private validateExternalContext(grammar: Grammar, diagnostics: TranslationDiagnostic[]): void {
        if ((grammar.externalContexts ?? []).length > 1) {
            diagnostics.push({
                message: 'Only one external context tracker is allowed per grammar.',
                severity: 'error',
                source: 'external context'
            });
        }
    }

    private validateSpecializeExtend(grammar: Grammar, diagnostics: TranslationDiagnostic[]): void {
        // Check for duplicate source strings within the same terminal
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

    // ---- Utility methods ----

    private getLezerTerminalName(terminal: GrammarAST.TerminalRule): string {
        // Map common Langium terminal names to Lezer conventions
        switch (terminal.name) {
            case 'WS': return 'whitespace';
            case 'ML_COMMENT': return 'BlockComment';
            case 'SL_COMMENT': return 'LineComment';
            case 'ID': return 'Identifier';
            case 'INT': case 'NUMBER': return 'Number';
            case 'STRING': return 'String';
            default: return terminal.name;
        }
    }

    private escapeLezerString(value: string): string {
        return value
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }

    private capitalize(s: string): string {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    private toLowerCamel(s: string): string {
        return s.charAt(0).toLowerCase() + s.slice(1);
    }

    private factorial(n: number): number {
        let result = 1;
        for (let i = 2; i <= n; i++) result *= i;
        return result;
    }

    private permutations<T>(arr: T[]): T[][] {
        if (arr.length <= 1) return [arr];
        const result: T[][] = [];
        for (let i = 0; i < arr.length; i++) {
            const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
            for (const perm of this.permutations(rest)) {
                result.push([arr[i], ...perm]);
            }
        }
        return result;
    }

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

    private walkTerminalElements(element: GrammarAST.AbstractElement, visitor: (el: GrammarAST.AbstractElement) => void): void {
        visitor(element);
        if (GrammarAST.isTerminalAlternatives(element) || GrammarAST.isTerminalGroup(element)) {
            for (const child of (element as GrammarAST.TerminalAlternatives | GrammarAST.TerminalGroup).elements) {
                this.walkTerminalElements(child, visitor);
            }
        }
    }
}
