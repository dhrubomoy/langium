/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { AstUtils, GrammarAST, type Grammar } from 'langium';
import type { FieldMetadata, GrammarMetadata, NodeMetadata } from 'langium/generate';

/**
 * Schema version of the emitted {@link GrammarMetadata}. Bumped when the
 * compiler starts emitting fields that older runtime consumers cannot read.
 */
const METADATA_VERSION = '1.0.0';

/**
 * Compile a Langium {@link Grammar} to its {@link GrammarMetadata} description.
 *
 * The emitted metadata mirrors what the runtime index builder needs to walk a
 * tree-sitter parse tree: for every parser rule it captures the field
 * assignments (name + operator + cross-reference flag); for actions it records
 * the inferred AST type; for hidden terminals it lists the named entries that
 * appear in the tree-sitter `extras` array (single-regex hidden terminals are
 * inlined as anonymous regex by {@link compileExtras} and so do not surface as
 * named tree-sitter nodes — they are excluded here for symmetry); and for the
 * `@word` terminal it records the rule name.
 *
 * Fragment parser rules are inlined by tree-sitter (the underscore-prefixed
 * convention) and therefore have no addressable node type — they are skipped.
 */
export function compileMetadata(grammar: Grammar): GrammarMetadata {
    const nodes: Record<string, NodeMetadata> = {};

    for (const rule of grammar.rules) {
        if (GrammarAST.isInfixRule(rule)) {
            nodes[rule.name] = buildInfixNode(rule);
            continue;
        }
        if (!GrammarAST.isParserRule(rule)) {
            continue;
        }
        if (rule.fragment) {
            continue;
        }

        nodes[rule.name] = buildRuleNode(rule);

        for (const action of streamActions(rule.definition)) {
            const actionType = actionTypeName(action);
            if (actionType && !(actionType in nodes)) {
                nodes[actionType] = {
                    nodeType: actionType,
                    fields: [],
                    isAction: true,
                    actionType
                };
            }
        }
    }

    const word = collectWord(grammar);
    return {
        version: METADATA_VERSION,
        nodes,
        extras: collectExtras(grammar),
        ...(word ? { word } : {})
    };
}

function buildInfixNode(rule: GrammarAST.InfixRule): NodeMetadata {
    return {
        nodeType: rule.name,
        fields: [
            { name: 'left', operator: '=' },
            { name: 'operator', operator: '=' },
            { name: 'right', operator: '=' }
        ]
    };
}

function buildRuleNode(rule: GrammarAST.ParserRule): NodeMetadata {
    const node: NodeMetadata = {
        nodeType: rule.name,
        fields: collectFields(rule.definition)
    };
    const action = firstAction(rule.definition);
    const inferredName = action ? actionTypeName(action) : rule.inferredType?.name;
    if (inferredName) {
        node.isAction = true;
        node.actionType = inferredName;
    }
    return node;
}

function collectFields(element: GrammarAST.AbstractElement): FieldMetadata[] {
    const fields: FieldMetadata[] = [];
    const seen = new Set<string>();
    for (const node of AstUtils.streamAst(element)) {
        if (!GrammarAST.isAssignment(node)) {
            continue;
        }
        const key = `${node.feature}@${node.operator}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const field: FieldMetadata = {
            name: node.feature,
            operator: node.operator
        };
        if (GrammarAST.isCrossReference(node.terminal)) {
            field.isRef = true;
        }
        fields.push(field);
    }
    return fields;
}

function streamActions(element: GrammarAST.AbstractElement): GrammarAST.Action[] {
    const actions: GrammarAST.Action[] = [];
    for (const node of AstUtils.streamAst(element)) {
        if (GrammarAST.isAction(node)) {
            actions.push(node);
        }
    }
    return actions;
}

function firstAction(element: GrammarAST.AbstractElement): GrammarAST.Action | undefined {
    for (const node of AstUtils.streamAst(element)) {
        if (GrammarAST.isAction(node)) {
            return node;
        }
    }
    return undefined;
}

function actionTypeName(action: GrammarAST.Action): string | undefined {
    if (action.inferredType) {
        return action.inferredType.name;
    }
    if (action.type?.ref) {
        return action.type.ref.name;
    }
    if (action.type?.$refText) {
        return action.type.$refText;
    }
    return undefined;
}

function collectExtras(grammar: Grammar): string[] {
    return grammar.rules
        .filter(GrammarAST.isTerminalRule)
        .filter(rule => rule.hidden)
        .filter(rule => !isInlineableRegex(rule))
        .map(rule => rule.name);
}

function isInlineableRegex(rule: GrammarAST.TerminalRule): boolean {
    const def = rule.definition;
    return GrammarAST.isRegexToken(def) && def.cardinality === undefined;
}

function collectWord(grammar: Grammar): string | undefined {
    const wordTerminal = grammar.rules
        .filter(GrammarAST.isTerminalRule)
        .find(rule => rule.isWord);
    return wordTerminal?.name;
}
