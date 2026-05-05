/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { describe, expect, test } from 'vitest';
import { createArithmeticsServices } from '../src/language-server/arithmetics-module.js';
import type { Module } from '../src/language-server/generated/ast.js';

describe('Arithmetics tree-sitter pipeline activation', () => {

    test('parsing a document populates document.documentIndex with declarations', async () => {
        const { arithmetics } = createArithmeticsServices(EmptyFileSystem);
        await arithmetics.parser.WasmLoader.init();

        const parse = parseHelper<Module>(arithmetics);
        const document = await parse(`
            module sample
            def a: 1;
            def b: a + 2;
        `);

        expect(document.treeSitterTree, 'tree-sitter parse should produce a Tree').toBeDefined();
        expect(document.documentIndex, 'document index should be populated').toBeDefined();
        expect(document.documentIndex!.declarations.size, 'at least one declaration should be indexed')
            .toBeGreaterThan(0);
    });

});
