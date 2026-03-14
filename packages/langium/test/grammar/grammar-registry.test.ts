/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { describe, test, expect, beforeAll } from 'vitest';
import type { LangiumCoreServices, GrammarRegistry } from 'langium';

import { createServicesForGrammar } from 'langium/grammar';

const grammar = `
    grammar Test
    entry Model: 'model' name=ID items+=Item*;
    Item: 'item' name=ID value=INT?;
    Ref: 'ref' target=[Item:ID];
    hidden terminal WS: /\\s+/;
    terminal ID: /[_a-zA-Z][\\w_]*/;
    terminal INT returns number: /[0-9]+/;
`;

describe('GrammarRegistry', () => {
    let services: LangiumCoreServices;
    let registry: GrammarRegistry;

    beforeAll(async () => {
        services = await createServicesForGrammar({ grammar });
        registry = services.grammar.GrammarRegistry;
    });

    test('registry is registered as service', () => {
        expect(registry).toBeDefined();
    });

    describe('getRuleByName', () => {
        test('returns parser rules by name', () => {
            const model = registry.getRuleByName('Model');
            expect(model).toBeDefined();
            expect(model!.name).toBe('Model');
        });

        test('returns terminal rules by name', () => {
            const id = registry.getRuleByName('ID');
            expect(id).toBeDefined();
            expect(id!.name).toBe('ID');
        });

        test('returns undefined for non-existent rule', () => {
            expect(registry.getRuleByName('NonExistent')).toBeUndefined();
        });
    });

    describe('isKeyword', () => {
        test('recognizes keywords from the grammar', () => {
            expect(registry.isKeyword('model')).toBe(true);
            expect(registry.isKeyword('item')).toBe(true);
            expect(registry.isKeyword('ref')).toBe(true);
        });

        test('returns false for non-keywords', () => {
            expect(registry.isKeyword('foo')).toBe(false);
            expect(registry.isKeyword('ID')).toBe(false);
            expect(registry.isKeyword('')).toBe(false);
        });
    });

    describe('getAlternatives', () => {
        test('returns alternatives for a parser rule', () => {
            const alternatives = registry.getAlternatives('Model');
            expect(alternatives.length).toBeGreaterThan(0);
        });

        test('returns empty array for non-existent rule', () => {
            expect(registry.getAlternatives('NonExistent')).toEqual([]);
        });
    });

    describe('getAssignmentByProperty', () => {
        test('returns assignment for known property', () => {
            const assignment = registry.getAssignmentByProperty('Model', 'name');
            expect(assignment).toBeDefined();
            expect(assignment!.feature).toBe('name');
        });

        test('returns assignment for list property', () => {
            const assignment = registry.getAssignmentByProperty('Model', 'items');
            expect(assignment).toBeDefined();
            expect(assignment!.feature).toBe('items');
            expect(assignment!.operator).toBe('+=');
        });

        test('returns undefined for non-existent property', () => {
            expect(registry.getAssignmentByProperty('Model', 'nonExistent')).toBeUndefined();
        });

        test('returns undefined for non-existent rule', () => {
            expect(registry.getAssignmentByProperty('NonExistent', 'name')).toBeUndefined();
        });
    });

    describe('getAssignments', () => {
        test('returns all assignments for a rule', () => {
            const assignments = registry.getAssignments('Model');
            expect(assignments.length).toBe(2); // name, items
            const features = assignments.map(a => a.feature);
            expect(features).toContain('name');
            expect(features).toContain('items');
        });

        test('returns all assignments for Item rule', () => {
            const assignments = registry.getAssignments('Item');
            expect(assignments.length).toBe(2); // name, value
            const features = assignments.map(a => a.feature);
            expect(features).toContain('name');
            expect(features).toContain('value');
        });

        test('returns empty array for non-existent rule', () => {
            expect(registry.getAssignments('NonExistent')).toEqual([]);
        });
    });
});
