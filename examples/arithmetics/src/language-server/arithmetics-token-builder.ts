/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Grammar, TokenBuilderOptions } from 'langium';
import { DefaultTokenBuilder, GrammarUtils } from 'langium';
import { stream } from 'langium';

export class ArithmeticsTokenBuilder extends DefaultTokenBuilder {

    override buildTokens(grammar: Grammar, options?: TokenBuilderOptions | undefined) {
        const reachableRules = stream(GrammarUtils.getAllReachableRules(grammar, false));
        const terminalTokens = this.buildTerminalTokens(reachableRules);
        const tokens = this.buildKeywordTokens(reachableRules, terminalTokens, options);

        const id = terminalTokens.find((e) => e.name === 'ID')!;
        for (const keywordToken of tokens) {
            if (/[_a-zA-Z][\w_]*/.test(keywordToken.name)) {
                keywordToken.CATEGORIES = [id];
            }
        }
        tokens.push(...terminalTokens);
        return tokens;
    }

}
