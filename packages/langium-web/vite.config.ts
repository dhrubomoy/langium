import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 5173,
        headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin'
        }
    },
    preview: {
        port: 5173,
        headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin'
        }
    },
    worker: {
        format: 'es'
    },
    optimizeDeps: {
        include: [
            'langium',
            'langium/lsp',
            'web-tree-sitter',
            'vscode-languageserver-protocol',
            'vscode-languageserver-types',
            'vscode-languageserver',
            'vscode-languageserver/browser.js',
            'vscode-languageclient',
            'vscode-languageclient/browser.js',
            'vscode-uri',
            'vscode-languageserver-textdocument',
            'vscode-jsonrpc/lib/common/cancellation.js',
            'vscode-jsonrpc/lib/common/events.js',
            '@chevrotain/regexp-to-ast',
            'chevrotain-allstar',
            'chevrotain'
        ]
    },
    resolve: {
        dedupe: [
            '@codingame/monaco-vscode-api',
            '@codingame/monaco-vscode-base-service-override',
            '@codingame/monaco-vscode-environment-service-override',
            '@codingame/monaco-vscode-extensions-service-override',
            '@codingame/monaco-vscode-files-service-override',
            '@codingame/monaco-vscode-host-service-override',
            '@codingame/monaco-vscode-keybindings-service-override',
            '@codingame/monaco-vscode-layout-service-override',
            '@codingame/monaco-vscode-lifecycle-service-override',
            '@codingame/monaco-vscode-localization-service-override',
            '@codingame/monaco-vscode-quickaccess-service-override',
            'vscode',
            'vscode-languageserver-protocol',
            'vscode-languageserver-types'
        ]
    }
});
