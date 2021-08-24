import { TextDocument } from 'vscode-languageserver-textdocument'
import {
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  DidChangeConfigurationNotification,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node'

// import { resolveSettings } from './resolveSettings'

const MaxNumberOfProblems = 100

/**
 * 代码检查验证器
 */
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  console.log('active codecheck')
  // 获取当前编辑器的文本
  const text = textDocument.getText()

  // 获取配置
  // const config = await resolveSettings(connection, textDocument)
  const config = []
  console.log('config', config)

  // 需要进行验证的匹配
  const pattern = /\b\W+{2,}\b/g
  let m: RegExpExecArray | null

  // problems用于统计问题数量，限制最大报警数量
  let problems = 0

  const diagnostics: Diagnostic[] = []

  // 遍历每个pattern匹配到的符号
  while ((m = pattern.exec(text)) && problems < MaxNumberOfProblems) {
    problems++

    const catched = config.find(rule => new RegExp(rule.pattern).test(m[0]))
    if (catched) {
      // 创建一个问题
      const diagnostic: Diagnostic = {
        // 问题级别
        severity: DiagnosticSeverity[catched.type],
        // 问题位置
        range: {
          start: textDocument.positionAt(m.index),
          end: textDocument.positionAt(m.index + m[0].length),
        },
        // 问题信息
        message: catched.message,
        // 问题标识
        source: 'Lint:',
      }

      // 判断是否具备诊断相关信息能力
      if (hasDiagnosticRelatedInformationCapability) {
        // 给出问题提示
        diagnostic.relatedInformation = [
          {
            location: {
              uri: textDocument.uri,
              range: Object.assign({}, diagnostic.range),
            },
            message: catched.message,
          },
        ]
      }
      // 收集到当前编辑器所有的问题
      diagnostics.push(diagnostic)
    }
  }

  // lsp服务发射问题
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics })
}

/**********************************************
 * 下方的代码不要动
 *********************************************/

let connection = createConnection(ProposedFeatures.all)

let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

let hasConfigurationCapability: boolean = false
let hasWorkspaceFolderCapability: boolean = false
let hasDiagnosticRelatedInformationCapability: boolean = false

connection.onInitialize((params: InitializeParams) => {
  let capabilities = params.capabilities

  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  )
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  )
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  )

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
      },
    },
  }
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    }
  }

  return result
})

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    )
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(_event => {
      connection.console.log('Workspace folder change event received.')
    })
  }
})

documents.onDidChangeContent(change => {
  validateTextDocument(change.document)
})

documents.listen(connection)
connection.listen()
