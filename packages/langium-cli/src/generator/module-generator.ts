/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { expandToNode, joinToNode, toString } from 'langium/generate';
import type { ParsedGrammarSet } from '../grammar-parser/grammar-parser.js';
import { getGrammarName } from '../grammar-parser/grammar-queries.js';
import type { LangiumConfig } from '../package-types.js';
import { generatedHeader } from './node-util.js';

export function generateModule(set: ParsedGrammarSet, config: LangiumConfig): string {
    const grammarName = [...set.values()].map(getGrammarName).find(Boolean) ?? config.projectName;
    const importExtension = config.importExtension ?? '';
    const modeValue = config.mode === 'production' ? 'production' : 'development';

    const node = expandToNode`
        ${generatedHeader}

        import type { LangiumSharedCoreServices, LangiumCoreServices, LangiumGeneratedCoreServices, LangiumGeneratedSharedCoreServices, LanguageMetaData, Module } from 'langium';
        import { ${config.projectName}AstReflection } from './ast${importExtension}';

        export const ${config.projectName}GeneratedSharedModule: Module<LangiumSharedCoreServices, LangiumGeneratedSharedCoreServices> = {
            AstReflection: () => new ${config.projectName}AstReflection(),
        };

        ${joinToNode(config.languages, lang => {
            const safeId = lang.id.replace(/-/g, '_');
            return expandToNode`
                export const ${safeId}LanguageMetaData = {
                    languageId: '${lang.id}',
                    fileExtensions: [${(lang.fileExtensions ?? []).map(e => `'${e.startsWith('.') ? e : '.' + e}'`).join(', ')}],
                    caseInsensitive: ${Boolean(lang.caseInsensitive)},
                    mode: '${modeValue}',
                } as const satisfies LanguageMetaData;

                export const ${grammarName}GeneratedModule: Module<LangiumCoreServices, LangiumGeneratedCoreServices> = {
                    LanguageMetaData: () => ${safeId}LanguageMetaData,
                    parser: {},
                };
            `.appendNewLine();
        })}
    `.appendNewLine();

    return toString(node);
}
