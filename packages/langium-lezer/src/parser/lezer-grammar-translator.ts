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

        // Separate rules by type
        for (const rule of grammar.rules) {
            if (GrammarAST.isTerminalRule(rule) && rule.hidden) {
                hiddenTerminals.push(rule);
            } else if (GrammarAST.isTerminalRule(rule)) {
                visibleTerminals.push(rule);
            }
        }

        // Emit @top rule
        for (const rule of grammar.rules) {
            if (GrammarAST.isParserRule(rule) && rule.entry) {
                const body = this.translateParserRuleBody(rule, rule.definition, fieldMapData, keywords, wrapperRules);
                lines.push(`@top ${rule.name} { ${body} }`);
                lines.push('');
                break;
            }
        }

        // Emit @skip declaration for hidden terminals
        if (hiddenTerminals.length > 0) {
            const skipNames = hiddenTerminals.map(t => this.getLezerTerminalName(t));
            lines.push(`@skip { ${skipNames.join(' | ')} }`);
            lines.push('');
        }

        // Emit infix rules as @precedence declarations + flat rules
        for (const rule of grammar.rules) {
            if (GrammarAST.isInfixRule(rule)) {
                const infixLines = this.translateInfixRule(rule, keywords);
                lines.push(...infixLines);
                lines.push('');
            }
        }

        // Emit parser rules (non-entry, non-infix)
        for (const rule of grammar.rules) {
            if (GrammarAST.isParserRule(rule) && !rule.entry && !rule.fragment) {
                const body = this.translateParserRuleBody(rule, rule.definition, fieldMapData, keywords, wrapperRules);
                lines.push(`${rule.name} { ${body} }`);
                lines.push('');
            }
        }

        // Emit fragment rules (lowercase name = hidden in Lezer)
        for (const rule of grammar.rules) {
            if (GrammarAST.isParserRule(rule) && rule.fragment) {
                const name = this.toLowerCamel(rule.name);
                const body = this.translateParserRuleBody(rule, rule.definition, fieldMapData, keywords, wrapperRules);
                lines.push(`${name} { ${body} }`);
                lines.push('');
            }
        }

        // Emit wrapper rules for field access
        if (wrapperRules.length > 0) {
            lines.push('// Wrapper rules for field access');
            lines.push(...wrapperRules);
            lines.push('');
        }

        // Emit keyword template
        if (keywords.size > 0) {
            lines.push(`kw<term> { @specialize[@name={term}]<Identifier, term> }`);
            lines.push('');
        }

        // Emit @tokens block
        lines.push('@tokens {');
        for (const terminal of visibleTerminals) {
            const tokenBody = this.translateTerminalBody(terminal);
            const name = this.getLezerTerminalName(terminal);
            lines.push(`  ${name} { ${tokenBody} }`);
        }
        for (const terminal of hiddenTerminals) {
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

    private translateElement(
        parentRuleName: string,
        element: GrammarAST.AbstractElement,
        fieldMapData: FieldMapData,
        keywords: Set<string>,
        wrapperRules: string[]
    ): string {
        let result = this.translateElementCore(parentRuleName, element, fieldMapData, keywords, wrapperRules);

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
        // Use inline keyword syntax
        return `"${this.escapeLezerString(kw.value)}"`;
    }

    private translateRuleCall(ruleCall: GrammarAST.RuleCall): string {
        const ref = ruleCall.rule.ref;
        if (!ref) return '/* unresolved rule */';
        if (GrammarAST.isParserRule(ref) && ref.fragment) {
            return this.toLowerCamel(ref.name);
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

        // Emit wrapper rule
        wrapperRules.push(`${wrapperName} { ${inner} }`);

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
        const precNames: string[] = [];
        const ruleAlternatives: string[] = [];

        // Each precedence level in the operators
        for (let i = 0; i < rule.operators.precedences.length; i++) {
            const precLevel = rule.operators.precedences[i];
            const precName = `prec_${rule.name}_${i}`;
            precNames.push(precName);

            const assoc = precLevel.associativity ?? 'left';
            const ops = precLevel.operators.map(op => {
                keywords.add(op.value);
                return `"${this.escapeLezerString(op.value)}"`;
            });

            // Each operator at this precedence level becomes an alternative
            for (const op of ops) {
                const operandRef = rule.call.rule.ref?.name ?? 'expr';
                ruleAlternatives.push(`${operandRef} !${precName} ${op} ${operandRef}`);
            }

            lines.push(`// precedence ${i}: ${precLevel.operators.map(o => o.value).join(', ')} (${assoc})`);
        }

        // Emit @precedence declaration
        const precDecls = precNames.map((name, i) => {
            const assoc = rule.operators.precedences[i].associativity ?? 'left';
            return `${name} @${assoc}`;
        });
        lines.unshift(`@precedence { ${precDecls.join(', ')} }`);

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
        const conversion = convertRegexToLezer(token.regex);
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
                const error = validateRegexForLezer(element.regex);
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
