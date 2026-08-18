import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  parseReportedVersion,
  pinnedBuiltinHarnessVersion,
  resolveCodexAcpEntry,
  resolveSystemCodexPath,
  versionStanding,
  type VerifiedRuntimeKey,
} from '@school-workbench/agent-host'
import type { LocalToolStatusView, RuntimeVersionView } from '@school-workbench/shared'

type PathExists = (path: string) => boolean

function resolveSystemLarkCliPath(
  environment: NodeJS.ProcessEnv,
  exists: PathExists,
): string | null {
  const overridden = environment.SWB_LARK_CLI_PATH
  if (overridden) {
    const absolute = resolve(overridden)
    return exists(absolute) ? absolute : null
  }

  for (const directory of (environment.PATH ?? '').split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue
    const candidate = join(directory, 'lark-cli')
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * Reports only whether the two local command-line tools can be found. It never
 * reads credentials, opens a browser, or treats installed software as an
 * authenticated Feishu connection.
 */
export function localToolStatuses(
  environment: NodeJS.ProcessEnv = process.env,
  exists: PathExists = existsSync,
): readonly LocalToolStatusView[] {
  const codexAvailable = resolveSystemCodexPath(environment, exists) !== null
  const larkCliAvailable = resolveSystemLarkCliPath(environment, exists) !== null

  return Object.freeze([
    {
      key: 'codex_cli',
      label: 'Codex 命令行工具',
      availability: codexAvailable ? 'available' : 'unavailable',
      detail: codexAvailable
        ? '已检测到，可用于新的学校分析。'
        : '未检测到。安装 Codex 后重新打开设置即可重新检查。',
    },
    {
      key: 'lark_cli',
      label: '飞书命令行工具',
      availability: larkCliAvailable ? 'available' : 'unavailable',
      detail: larkCliAvailable
        ? '已检测到。飞书材料接入尚未启用，后续可继续完成授权设置。'
        : '未检测到。启用飞书材料接入前需要先安装飞书命令行工具。',
    },
  ])
}

/** How long the workbench waits for a tool to print its own version. */
const VERSION_PROBE_TIMEOUT_MS = 5_000

type RunCommand = (command: string, args: readonly string[]) => Promise<string>

const runCommand: RunCommand = (command, args) =>
  new Promise((resolvePromise) => {
    execFile(
      command,
      [...args],
      { timeout: VERSION_PROBE_TIMEOUT_MS, windowsHide: true },
      (error, stdout, stderr) => {
        // A tool that cannot answer leaves the version unknown. That is a
        // display detail, never a reason to fail anything.
        resolvePromise(error ? '' : `${stdout}${stderr}`)
      },
    )
  })

type ReadFile = (path: string) => string

/**
 * Reads the ACP bridge's own version from the package it was resolved out of.
 *
 * SPEC 12 keeps the bridge an opaque spawned artifact, so it is never imported
 * — the version is read off disk next to the entry point that would be spawned,
 * which is the same artifact a run actually uses.
 */
export function readCodexAcpVersion(
  mainDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
  exists: PathExists = existsSync,
  readFile: ReadFile = (path) => readFileSync(path, 'utf8'),
): string | null {
  let entryPath: string
  try {
    entryPath = resolveCodexAcpEntry(mainDirectory, environment, exists).path
  } catch {
    return null
  }

  const directory = dirname(entryPath)
  for (const candidate of [
    join(directory, 'package.json'),
    join(directory, '..', 'package.json'),
  ]) {
    if (!exists(candidate)) continue
    try {
      const parsed: unknown = JSON.parse(readFile(candidate))
      if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
        const version = (parsed as { version?: unknown }).version
        if (typeof version === 'string' && version.length > 0) return version
      }
    } catch {
      // A manifest that will not parse simply leaves the version unknown.
    }
  }
  return null
}

const VERSION_LABELS: Readonly<Record<VerifiedRuntimeKey, string>> = Object.freeze({
  codex_cli: 'Codex',
  codex_acp: '工作台与 Codex 之间的连接组件',
})

const BUILTIN_HARNESS_LABEL = '工作台自带助手的推理组件'

/**
 * The pinned harness's row.
 *
 * Built by hand rather than through `describeVersion` because the question is
 * different. For Codex the question is "which of the versions that exist in the
 * world has anybody checked", and the answer is a range. Here the version is
 * whatever this build pins, so there is nothing to compare it against — the
 * only open question is whether a real analysis has ever been driven through
 * it, and the honest answer today is no.
 *
 * It says `unverified` for exactly that reason, and it goes back to saying
 * something else only when the acceptance run in the ledger has been done. That
 * is a run somebody performs, not a constant somebody edits.
 */
function describeBuiltinHarnessVersion(): RuntimeVersionView {
  return Object.freeze({
    key: 'builtin_harness' as const,
    label: BUILTIN_HARNESS_LABEL,
    version: pinnedBuiltinHarnessVersion,
    standing: 'unverified' as const,
    note: UNVERIFIED_NOTE,
  })
}

const UNVERIFIED_NOTE = '此版本未经产品验证。'
const UNKNOWN_NOTE = '暂时读不到这个版本号。'

function describeVersion(key: VerifiedRuntimeKey, version: string | null): RuntimeVersionView {
  const standing = versionStanding(key, version)
  return Object.freeze({
    key,
    label: VERSION_LABELS[key],
    version,
    standing,
    note:
      standing === 'verified' ? null : standing === 'unverified' ? UNVERIFIED_NOTE : UNKNOWN_NOTE,
  })
}

/**
 * What is actually installed, next to what the product has been verified
 * against.
 *
 * Reporting only. Nothing here gates a run, picks an assistant, or changes any
 * behaviour — SPEC 62 keeps the compatibility verdict on what a runtime really
 * answers. An unverified version is stated once and then ignored.
 *
 * Reading the Codex version means asking Codex to print it. That is the tool's
 * own `--version`; no credential, configuration file or account is touched.
 */
export async function runtimeVersions(
  mainDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
  exists: PathExists = existsSync,
  run: RunCommand = runCommand,
): Promise<readonly RuntimeVersionView[]> {
  const codexPath = resolveSystemCodexPath(environment, exists)
  const codexVersion = codexPath ? parseReportedVersion(await run(codexPath, ['--version'])) : null

  return Object.freeze([
    describeVersion('codex_cli', codexVersion),
    describeVersion('codex_acp', readCodexAcpVersion(mainDirectory, environment, exists)),
    describeBuiltinHarnessVersion(),
  ])
}
