/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { CodeLens, CodeLensParams } from 'vscode-languageserver';
import type { MaybePromise, LangiumDocument, Cancellation } from 'langium-core';

export interface CodeLensProvider {
    provideCodeLens(document: LangiumDocument, params: CodeLensParams, cancelToken?: Cancellation.CancellationToken): MaybePromise<CodeLens[] | undefined>
}
