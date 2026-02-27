/******************************************************************************
 * Grammar Extensions Test (Phase 3 Step 1)
 *
 * Validates that the Langium meta-grammar parser correctly handles all new
 * Phase 3 grammar constructs and produces the expected AST structures.
 ******************************************************************************/

import type { Grammar } from 'langium';
import { beforeEach, describe, expect, test } from 'vitest';
import { EmptyFileSystem, GrammarAST } from 'langium';
import { createLangiumGrammarServices } from 'langium/grammar';
import { clearDocuments, parseHelper } from 'langium/test';

const services = createLangiumGrammarServices(EmptyFileSystem);
const parse = parseHelper<Grammar>(services.grammar);

beforeEach(() => clearDocuments(services.shared));

describe('Phase 3 Grammar Extensions', () => {

    // ── Precedence Blocks ──────────────────────────────────────────────

    describe('PrecedenceBlock', () => {

        test('should parse a precedence block with multiple levels', async () => {
            const doc = await parse(`
                grammar Test
                entry A: name=ID;
                terminal ID: /[a-z]+/;

                precedence {
                    Add left assoc;
                    Mul left assoc;
                    Unary;
                }
            `);
            const grammar = doc.parseResult.value;
            expect(doc.parseResult.parserErrors).toHaveLength(0);
            expect(grammar.precedenceBlocks).toHaveLength(1);

            const block = grammar.precedenceBlocks[0];
            expect(GrammarAST.isPrecedenceBlock(block)).toBe(true);
            expect(block.levels).toHaveLength(3);

            expect(block.levels[0].name).toBe('Add');
            expect(block.levels[0].associativity).toBe('left');
            expect(block.levels[1].name).toBe('Mul');
            expect(block.levels[1].associativity).toBe('left');
            expect(block.levels[2].name).toBe('Unary');
            expect(block.levels[2].associativity).toBeUndefined();
        });

        test('should parse right-associative precedence levels', async () => {
            const doc = await parse(`
                grammar Test
                entry A: name=ID;
                terminal ID: /[a-z]+/;

                precedence {
                    Assign right assoc;
                    Add left assoc;
                }
            `);
            const grammar = doc.parseResult.value;
            expect(doc.parseResult.parserErrors).toHaveLength(0);
            expect(grammar.precedenceBlocks[0].levels[0].associativity).toBe('right');
            expect(grammar.precedenceBlocks[0].levels[1].associativity).toBe('left');
        });
    });

    // ── External Token Blocks ──────────────────────────────────────────

    describe('ExternalTokenBlock', () => {

        test('should parse an external token block', async () => {
            const doc = await parse(`
                grammar Test
                entry A: name=ID;
                terminal ID: /[a-z]+/;

                external tokens from "./my-tokens" {
                    INDENT, DEDENT, NEWLINE
                }
            `);
            const grammar = doc.parseResult.value;
            expect(doc.parseResult.parserErrors).toHaveLength(0);
            expect(grammar.externalTokenBlocks).toHaveLength(1);

            const block = grammar.externalTokenBlocks[0];
            expect(GrammarAST.isExternalTokenBlock(block)).toBe(true);
            expect(block.path).toBe('./my-tokens');
            expect(block.tokens).toHaveLength(3);
            expect(block.tokens.map(t => t.name)).toEqual(['INDENT', 'DEDENT', 'NEWLINE']);
        });

        test('should handle trailing comma in external tokens', async () => {
            const doc = await parse(`
                grammar Test
                entry A: name=ID;
                terminal ID: /[a-z]+/;

                external tokens from "./tokens" {
                    FOO,
                    BAR,
                }
            `);
            const grammar = doc.parseResult.value;
            expect(doc.parseResult.parserErrors).toHaveLength(0);
            expect(grammar.externalTokenBlocks[0].tokens).toHaveLength(2);
        });
    });

    // ── External Context ───────────────────────────────────────────────

    describe('ExternalContext', () => {

        test('should parse an external context declaration', async () => {
            const doc = await parse(`
                grammar Test
                entry A: name=ID;
                terminal ID: /[a-z]+/;

                external context myDialect from "./context-module";
            `);
            const grammar = doc.parseResult.value;
            expect(doc.parseResult.parserErrors).toHaveLength(0);
            expect(grammar.externalContexts).toHaveLength(1);

            const ctx = grammar.externalContexts[0];
            expect(GrammarAST.isExternalContext(ctx)).toBe(true);
            expect(ctx.name).toBe('myDialect');
            expect(ctx.path).toBe('./context-module');
        });
    });

    // ── Specialize Blocks ──────────────────────────────────────────────

    describe('SpecializeBlock', () => {

        test('should parse a specialize block with mappings', async () => {
            const doc = await parse(`
                grammar Test
                entry A: name=ID;
                terminal ID: /[a-z]+/;

                specialize ID {
                    "if" => If;
                    "else" => Else;
                    "while" => While;
                }
            `);
            const grammar = doc.parseResult.value;
            expect(doc.parseResult.parserErrors).toHaveLength(0);
            expect(grammar.specializeBlocks).toHaveLength(1);

            const block = grammar.specializeBlocks[0];
            expect(GrammarAST.isSpecializeBlock(block)).toBe(true);
            expect(block.terminal.ref?.name).toBe('ID');
            expect(block.mappings).toHaveLength(3);
            expect(block.mappings[0].source).toBe('if');
            expect(block.mappings[0].target).toBe('If');
            expect(block.mappings[1].source).toBe('else');
            expect(block.mappings[1].target).toBe('Else');
            expect(block.mappings[2].source).toBe('while');
            expect(block.mappings[2].target).toBe('While');
        });
    });

    // ── Extend Blocks ──────────────────────────────────────────────────

    describe('ExtendBlock', () => {

        test('should parse an extend block with mappings', async () => {
            const doc = await parse(`
                grammar Test
                entry A: name=ID;
                terminal ID: /[a-z]+/;

                extend ID {
                    "true" => BoolTrue;
                    "false" => BoolFalse;
                }
            `);
            const grammar = doc.parseResult.value;
            expect(doc.parseResult.parserErrors).toHaveLength(0);
            expect(grammar.extendBlocks).toHaveLength(1);

            const block = grammar.extendBlocks[0];
            expect(GrammarAST.isExtendBlock(block)).toBe(true);
            expect(block.terminal.ref?.name).toBe('ID');
            expect(block.mappings).toHaveLength(2);
            expect(block.mappings[0].source).toBe('true');
            expect(block.mappings[0].target).toBe('BoolTrue');
        });
    });

    // ── Conflict Blocks ────────────────────────────────────────────────

    describe('ConflictBlock', () => {

        test('should parse a conflict block with multiple sets', async () => {
            const doc = await parse(`
                grammar Test
                entry A: name=ID;
                B: val=ID;
                C: val=ID;
                terminal ID: /[a-z]+/;

                conflicts {
                    [A, B];
                    [A, B, C];
                }
            `);
            const grammar = doc.parseResult.value;
            expect(doc.parseResult.parserErrors).toHaveLength(0);
            expect(grammar.conflictBlocks).toHaveLength(1);

            const block = grammar.conflictBlocks[0];
            expect(GrammarAST.isConflictBlock(block)).toBe(true);
            expect(block.sets).toHaveLength(2);
            expect(block.sets[0].rules).toHaveLength(2);
            expect(block.sets[0].rules.map(r => r.ref?.name)).toEqual(['A', 'B']);
            expect(block.sets[1].rules).toHaveLength(3);
            expect(block.sets[1].rules.map(r => r.ref?.name)).toEqual(['A', 'B', 'C']);
        });
    });

    // ── Local Token Blocks ─────────────────────────────────────────────

    describe('LocalTokenBlock', () => {

        test('should parse a local token block', async () => {
            const doc = await parse(`
                grammar Test
                entry A: name=ID;
                terminal ID: /[a-z]+/;

                local tokens in A {
                    terminal LOCAL_INT: /[0-9]+/;
                    terminal LOCAL_OP: /[+\\-*/]/;
                }
            `);
            const grammar = doc.parseResult.value;
            expect(doc.parseResult.parserErrors).toHaveLength(0);
            expect(grammar.localTokenBlocks).toHaveLength(1);

            const block = grammar.localTokenBlocks[0];
            expect(GrammarAST.isLocalTokenBlock(block)).toBe(true);
            expect(block.rule.ref?.name).toBe('A');
            expect(block.terminals).toHaveLength(2);
            expect(block.terminals[0].name).toBe('LOCAL_INT');
            expect(block.terminals[1].name).toBe('LOCAL_OP');
        });
    });

    // ── @precMarker and @dynamicPrecedence annotations ─────────────────

    describe('Element annotations', () => {

        test('should parse @precMarker annotation on an element', async () => {
            // Annotations go after the element (like cardinality)
            const doc = await parse(`
                grammar Test
                entry Expr: name=ID @precMarker=Add;
                terminal ID: /[a-z]+/;
            `);
            const grammar = doc.parseResult.value;
            expect(doc.parseResult.parserErrors).toHaveLength(0);

            const rule = grammar.rules[0] as GrammarAST.ParserRule;
            // Single assignment — definition IS the Assignment directly
            const assignment = rule.definition as GrammarAST.Assignment;
            expect(assignment.precMarker).toBe('Add');
        });

        test('should parse @dynamicPrecedence annotation', async () => {
            const doc = await parse(`
                grammar Test
                entry Expr: name=ID @dynamicPrecedence(5);
                terminal ID: /[a-z]+/;
            `);
            const grammar = doc.parseResult.value;
            expect(doc.parseResult.parserErrors).toHaveLength(0);

            const rule = grammar.rules[0] as GrammarAST.ParserRule;
            const assignment = rule.definition as GrammarAST.Assignment;
            expect(assignment.dynamicPrecedence).toBe(5);
        });

        test('should parse both @precMarker and @dynamicPrecedence together', async () => {
            const doc = await parse(`
                grammar Test
                entry Expr: name=ID @precMarker=Add @dynamicPrecedence(3);
                terminal ID: /[a-z]+/;
            `);
            const grammar = doc.parseResult.value;
            expect(doc.parseResult.parserErrors).toHaveLength(0);

            const rule = grammar.rules[0] as GrammarAST.ParserRule;
            const assignment = rule.definition as GrammarAST.Assignment;
            expect(assignment.precMarker).toBe('Add');
            expect(assignment.dynamicPrecedence).toBe(3);
        });
    });

    // ── Combined: multiple extension blocks in one grammar ─────────────

    describe('Combined grammar', () => {

        test('should parse a grammar with all extension constructs', async () => {
            const doc = await parse(`
                grammar FullTest

                entry Main: name=ID;
                Sub: val=ID;
                terminal ID: /[a-z]+/;

                precedence {
                    Low left assoc;
                    High;
                }

                external tokens from "./ext-tokens" {
                    INDENT, DEDENT
                }

                external context python from "./py-context";

                specialize ID {
                    "if" => IfKw;
                }

                extend ID {
                    "null" => NullLit;
                }

                conflicts {
                    [Main, Sub];
                }

                local tokens in Main {
                    terminal LOCAL_WS: /[ \\t]+/;
                }
            `);
            const grammar = doc.parseResult.value;
            expect(doc.parseResult.parserErrors).toHaveLength(0);

            expect(grammar.precedenceBlocks).toHaveLength(1);
            expect(grammar.externalTokenBlocks).toHaveLength(1);
            expect(grammar.externalContexts).toHaveLength(1);
            expect(grammar.specializeBlocks).toHaveLength(1);
            expect(grammar.extendBlocks).toHaveLength(1);
            expect(grammar.conflictBlocks).toHaveLength(1);
            expect(grammar.localTokenBlocks).toHaveLength(1);
        });
    });
});
