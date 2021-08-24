import * as path from 'path'
import { ExtensionContext, workspace } from 'vscode'
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node'

let client: LanguageClient

export function activate(context: ExtensionContext) {
  const serverModule = context.asAbsolutePath(
    path.join('out', 'server', 'server.js')
  )

  const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] }

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  }

  const clientOptions: LanguageClientOptions = {
    // 设置校验的语言类型
    documentSelector: [{ scheme: 'file' }],
    diagnosticCollectionName: 'CodeCheck',
    progressOnInitialization: true,
    synchronize: {
      fileEvents: [workspace.createFileSystemWatcher('.code-check.js')],
    },
    middleware: {
      workspace: {
        configuration: async params => {
          if (params.items === undefined) {
            return []
          }
          const result: any[] = []
          params.items.forEach(item => {
            if (item.section === 'workspaceFolder') {
              result.push(workspace.workspaceFolders?.[0]?.uri?.fsPath)
            }
          })
          return result
        },
      },
    },
  }

  client = new LanguageClient(
    'code-checker',
    'CodeChecker',
    serverOptions,
    clientOptions
  )

  client.start()
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined
  }
  return client.stop()
}
