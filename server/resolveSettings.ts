import { existsSync, readFile, realpathSync } from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import { _Connection } from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'

export type ValidataRule = {
  pattern: string
  message: string
  type: 'Error' | 'Warning' | 'Information' | 'Hint'
}

export const getConfig = async (rootPath: string) => {
  if (rootPath) {
    const configFile = path.join(rootPath, '.code-check.json')
    let buf: Buffer
    try {
      buf = await promisify(readFile)(configFile)
    } catch (error) {}
    if (buf) {
      return JSON.parse(buf.toString()) as ValidataRule[]
    }
  }
  return []
}

const enum CharCode {
  /**
   * The `\` character.
   */
  Backslash = 92,
}

// 项目标识
const projectFolderIndicators: [string, boolean][] = [['package.json', true]]

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

const document2Settings = new Map<string, ValidataRule[]>()

// 获取当前文档的rule配置
export async function resolveSettings(
  connection: _Connection,
  document: TextDocument
): Promise<ValidataRule[]> {
  const uri = document.uri
  let resultPromise = document2Settings.get(uri)
  if (resultPromise) {
    return resultPromise
  }

  const workspaceFolder = await connection.workspace.getConfiguration(
    'workspaceFolder'
  )
  const workspaceFolderPath = workspaceFolder

  const filePath = getFilePath(document)

  const projectRootPath = findWorkingDirectory(workspaceFolderPath, filePath)
  console.log('projectRootPath', workspaceFolderPath, filePath)
  const settings = await getConfig(projectRootPath)
  document2Settings.set(uri, settings)

  return settings
}
