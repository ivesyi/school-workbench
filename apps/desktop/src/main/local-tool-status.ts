import { existsSync } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { resolveSystemCodexPath } from '@school-workbench/agent-host'
import type { LocalToolStatusView } from '@school-workbench/shared'

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
