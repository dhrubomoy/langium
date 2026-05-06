/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { SyntaxNode } from './grammar-parser.js';

// ─── Result record types (no $cstNode, no lazy refs) ────────────────────────

export interface AssignmentInfo {
    feature: string;
    operator: '=' | '+=' | '?=';
    isRef: boolean;
    /** Raw text of the RHS (rule call name, keyword text, etc.) */
    typeText: string;
}

export interface TypeInfo {
    name: string;
    superTypes: string[];
    /** true when declared with 'interface' keyword */
    isInterface: boolean;
}

export interface FieldInfo {
    name: string;
    operator: '=' | '+=' | '?=';
    /** Resolved type name or primitive */
    type: string;
    isRef: boolean;
    isOptional: boolean;
}

// ─── Structural queries ───────────────────────────────────────────────────────

export function getGrammarName(root: SyntaxNode): string | null {
    return root.childForFieldName('name')?.text ?? null;
}

export function getImports(root: SyntaxNode): SyntaxNode[] {
    return root.namedChildren.filter((c): c is SyntaxNode => c?.type === 'grammar_import');
}

export function getImportPath(importNode: SyntaxNode): string {
    const raw = importNode.childForFieldName('path')?.text ?? '';
    return raw.replace(/^['"]|['"]$/g, '');
}

export function getRules(root: SyntaxNode): SyntaxNode[] {
    return root.namedChildren.filter(
        (c): c is SyntaxNode => c?.type === 'parser_rule' || c?.type === 'infix_rule'
    );
}

export function getTerminals(root: SyntaxNode): SyntaxNode[] {
    return root.namedChildren.filter((c): c is SyntaxNode => c?.type === 'terminal_rule');
}

export function getInterfaces(root: SyntaxNode): SyntaxNode[] {
    return root.namedChildren.filter((c): c is SyntaxNode => c?.type === 'interface_decl');
}

export function getTypeDecls(root: SyntaxNode): SyntaxNode[] {
    return root.namedChildren.filter((c): c is SyntaxNode => c?.type === 'type_decl');
}

/** Name from rule_name_and_params.name field */
export function getRuleName(rule: SyntaxNode): string {
    if (rule.type === 'parser_rule' || rule.type === 'infix_rule') {
        const rnp = rule.namedChildren.find((c): c is SyntaxNode => c?.type === 'rule_name_and_params');
        return rnp?.childForFieldName('name')?.text ?? '';
    }
    if (rule.type === 'terminal_rule') {
        return rule.childForFieldName('name')?.text ?? '';
    }
    return rule.childForFieldName('name')?.text ?? '';
}

export function isEntryRule(rule: SyntaxNode): boolean {
    return rule.childForFieldName('modifier')?.text === 'entry';
}

export function isFragment(rule: SyntaxNode): boolean {
    return rule.childForFieldName('modifier')?.text === 'fragment';
}

export function isHiddenTerminal(rule: SyntaxNode): boolean {
    return rule.type === 'terminal_rule' && rule.childForFieldName('hidden') !== null;
}

/** Returns the return type name, or null if absent or inferred */
export function getRuleReturnType(rule: SyntaxNode): string | null {
    return rule.childForFieldName('return_type')?.text ?? null;
}

/** Returns the inferred type name from `infers Foo` or `infer Foo` */
export function getInferredTypeName(rule: SyntaxNode): string | null {
    const it = rule.childForFieldName('inferred_type');
    return it?.childForFieldName('name')?.text ?? null;
}

/** Returns the regex pattern text (including slashes) for a terminal_rule */
export function getTerminalPattern(terminal: SyntaxNode): string | null {
    const def = terminal.childForFieldName('definition');
    if (!def) return null;
    return extractTerminalPatternText(def);
}

function extractTerminalPatternText(node: SyntaxNode): string | null {
    if (node.type === 'regex_token') return node.text;
    for (const child of node.namedChildren) {
        if (!child) continue;
        const found = extractTerminalPatternText(child);
        if (found) return found;
    }
    return null;
}

// ─── Assignment collection ────────────────────────────────────────────────────

/** Collect all assignments anywhere in a rule's definition subtree */
export function getAssignments(rule: SyntaxNode): AssignmentInfo[] {
    const def = rule.childForFieldName('definition');
    if (!def) return [];
    const results: AssignmentInfo[] = [];
    collectAssignments(def, results);
    return results;
}

function collectAssignments(node: SyntaxNode, out: AssignmentInfo[]): void {
    if (node.type === 'assignment') {
        const feature = node.childForFieldName('feature')?.text ?? '';
        const operator = node.childForFieldName('operator')?.text as '=' | '+=' | '?=';
        const terminal = node.childForFieldName('terminal');
        const isRef = terminal !== null && terminalContainsCrossRef(terminal);
        const typeText = extractTypeText(terminal);
        out.push({ feature, operator, isRef, typeText });
        return;
    }
    for (const child of node.namedChildren) {
        if (!child) continue;
        collectAssignments(child, out);
    }
}

function terminalContainsCrossRef(node: SyntaxNode): boolean {
    if (node.type === 'cross_reference') return true;
    return node.namedChildren.some(c => c !== null && terminalContainsCrossRef(c));
}

function extractTypeText(node: SyntaxNode | null): string {
    if (!node) return '';
    if (node.type === 'rule_call') return node.childForFieldName('rule')?.text ?? '';
    if (node.type === 'cross_reference') return node.childForFieldName('type')?.text ?? '';
    if (node.type === 'keyword') return node.childForFieldName('value')?.text ?? node.text;
    if (node.namedChildren.length > 0) {
        const first = node.namedChildren[0];
        if (first) return extractTypeText(first);
    }
    return node.text;
}
