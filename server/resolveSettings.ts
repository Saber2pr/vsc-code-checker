import { existsSync, realpathSync } from 'fs'
import * as path from 'path'
import { _Connection } from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'

export type IConfig = {
  extendsBase?: boolean
  lints: Validator[]
}

export type Validator = {
  test: RegExp
  rule?: ((result: RegExpExecArray) => boolean) | string
  message?: string
  type?: 'Error' | 'Warning' | 'Information' | 'Hint'
}

const defaultConfig: IConfig = {
  lints: [],
}

const applyConfigDefaults = (config: IConfig) => {
  const extendsBase = config.extendsBase ?? true
  if (extendsBase) {
    config.lints.push(...defaultConfig.lints)
    config.extendsBase = false
  }
}

export const applyValidatorDefaults = (validator: Validator) => {
  validator.rule ??= () => true
  validator.message ??= 'UnExpect Item'
  validator.type ??= 'Error'
}

export const getConfig = async (rootPath: string): Promise<IConfig> => {
  if (rootPath) {
    const configFile = path.join(rootPath, '.code-check.js')
    try {
      const config = require(configFile)
      applyConfigDefaults(config)
      return config
    } catch (error) {}
  }
  return defaultConfig
}

const enum CharCode {
  /**
   * The `\` character.
   */
  Backslash = 92,
}

// 项目标识
const projectFolderIndicators: [string, boolean][] = [
  ['package.json', true],
  ['.code-check.json', true],
]

function isUNC(path: string): boolean {
  if (process.platform !== 'win32') {
    // UNC is a windows concept
    return false
  }

  if (!path || path.length < 5) {
    // at least \\a\b
    return false
  }

  let code = path.charCodeAt(0)
  if (code !== CharCode.Backslash) {
    return false
  }
  code = path.charCodeAt(1)
  if (code !== CharCode.Backslash) {
    return false
  }
  let pos = 2
  const start = pos
  for (; pos < path.length; pos++) {
    code = path.charCodeAt(pos)
    if (code === CharCode.Backslash) {
      break
    }
  }
  if (start === pos) {
    return false
  }
  code = path.charCodeAt(pos + 1)
  if (isNaN(code) || code === CharCode.Backslash) {
    return false
  }
  return true
}

/**
 * 通过document uri向上查找项目根目录
 */
export function findWorkingDirectory(
  workspaceFolder: string,
  file: string | undefined
): string | undefined {
  if (file === undefined || isUNC(file)) {
    return workspaceFolder
  }
  // Don't probe for something in node modules folder.
  if (file.indexOf(`${path.sep}node_modules${path.sep}`) !== -1) {
    return workspaceFolder
  }

  let result: string = workspaceFolder
  let directory: string | undefined = path.dirname(file)
  outer: while (
    directory !== undefined &&
    directory.startsWith(workspaceFolder)
  ) {
    for (const item of projectFolderIndicators) {
      if (existsSync(path.join(directory, item[0]))) {
        result = directory
        if (item[1]) {
          break outer
        } else {
          break
        }
      }
    }
    const parent = path.dirname(directory)
    directory = parent !== directory ? parent : undefined
  }
  return result
}

function getFileSystemPath(uri: URI): string {
  let result = uri.fsPath
  if (process.platform === 'win32' && result.length >= 2 && result[1] === ':') {
    // Node by default uses an upper case drive letter and ESLint uses
    // === to compare paths which results in the equal check failing
    // if the drive letter is lower case in th URI. Ensure upper case.
    result = result[0].toUpperCase() + result.substr(1)
  }
  if (process.platform === 'win32' || process.platform === 'darwin') {
    const realpath = realpathSync.native(result)
    // Only use the real path if only the casing has changed.
    if (realpath.toLowerCase() === result.toLowerCase()) {
      result = realpath
    }
  }
  return result
}

export function getFilePath(
  documentOrUri: string | TextDocument | URI | undefined
): string | undefined {
  if (!documentOrUri) {
    return undefined
  }
  const uri =
    typeof documentOrUri === 'string'
      ? URI.parse(documentOrUri)
      : documentOrUri instanceof URI
      ? documentOrUri
      : URI.parse(documentOrUri.uri)
  if (uri.scheme !== 'file') {
    return undefined
  }
  return getFileSystemPath(uri)
}

const document2Settings = new Map<string, string>()

// 获取当前文档的rule配置
export async function resolveSettings(
  connection: _Connection,
  document: TextDocument
): Promise<IConfig> {
  const uri = document.uri
  let result = document2Settings.get(uri)
  if (result) {
    return getConfig(result)
  }

  const workspaceFolder = await connection.workspace.getConfiguration(
    'workspaceFolder'
  )
  const workspaceFolderPath = workspaceFolder

  const filePath = getFilePath(document)

  const projectRootPath = findWorkingDirectory(workspaceFolderPath, filePath)
  document2Settings.set(uri, projectRootPath)

  return getConfig(projectRootPath)
}
