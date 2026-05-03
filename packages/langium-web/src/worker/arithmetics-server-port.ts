/******************************************************************************
 * Copyright 2026 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

/// <reference lib="WebWorker" />

import { start } from './arithmetics-server-start.js';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent) => {
    if (event.data.port !== undefined) {
        start(event.data.port);
    }
};
