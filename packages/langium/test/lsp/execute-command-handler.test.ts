/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { AbstractExecuteCommandHandler, type ExecuteCommandAcceptor } from 'langium/lsp';
import { describe, expect, test } from 'vitest';
import { BACKENDS } from '../langium-lezer-test.js';

const grammarStub = `
grammar Empty
entry NOOP: "NOOP";
hidden terminal WS: /\\s+/;
`;

for (const { name, createServices } of BACKENDS) {
    describe(`AbstractExecuteCommandHandler (${name})`, () => {

        test('Registered commands are available in `commands` property', async () => {

            class MultiCommandHandler extends AbstractExecuteCommandHandler {
                registerCommands(acceptor: ExecuteCommandAcceptor): void {
                    acceptor('b', () => { /* noop */ });
                    acceptor('a', () => { /* noop */ });
                }
            }

            const services = await createServices({
                grammar: grammarStub,
                sharedModule: {
                    lsp: {
                        ExecuteCommandHandler: () => new MultiCommandHandler()
                    }
                }
            });
            if (!services) return;
            const commands = services.shared.lsp.ExecuteCommandHandler!.commands;
            expect(commands).toBeDefined();
            expect(commands).toHaveLength(2);
            expect(commands).toContain('a');
            expect(commands).toContain('b');
        });

        test('Executing a command is possible and returns expected result', async () => {

            class TestCommandHandler extends AbstractExecuteCommandHandler {
                registerCommands(acceptor: ExecuteCommandAcceptor): void {
                    acceptor('execute', args => {
                        const value = args[0];
                        return value + 5;
                    });
                }
            }

            const services = await createServices({
                grammar: grammarStub,
                sharedModule: {
                    lsp: {
                        ExecuteCommandHandler: () => new TestCommandHandler()
                    }
                }
            });
            if (!services) return;
            const commandResult = await services.shared.lsp.ExecuteCommandHandler?.executeCommand('execute', [3]);
            expect(commandResult).toBe(8);
        });
    });
}
