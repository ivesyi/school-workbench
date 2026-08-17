import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { activateMethodologyPack } from './activate-methodology-pack'

const usage = `Usage:
  pnpm methodology:activate --pack <key> --version <version> [options]

Options:
  --pack <key>          methodology pack key, e.g. schooling-by-design
  --version <version>   methodology pack version, e.g. 1
  --database <path>     workbench SQLite file (default: SWB_DATABASE_PATH or the desktop app data path)
  --methodology <path>  methodology root (default: knowledge/methodology)
  --manifest <path>     source fingerprint manifest (default: references/SOURCE_MANIFEST.md)
  --apply               write the status change; without it the command only reports the decision
`

export function parseArguments(argv: readonly string[]): Record<string, string | true> {
  const parsed: Record<string, string | true> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token || !token.startsWith('--')) continue
    const name = token.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      parsed[name] = next
      index += 1
    } else {
      parsed[name] = true
    }
  }
  return parsed
}

/**
 * Mirrors Electron's `app.getPath('userData')` for the current unpackaged desktop
 * build. Packaging is not implemented yet, so `--database` stays available for
 * any other location.
 */
export function defaultDatabasePath(
  platform: NodeJS.Platform,
  home: string,
  environment: NodeJS.ProcessEnv,
): string {
  const explicit = environment.SWB_DATABASE_PATH
  if (explicit) return explicit
  const appData =
    platform === 'darwin'
      ? resolve(home, 'Library/Application Support/Electron')
      : platform === 'win32'
        ? resolve(environment.APPDATA ?? resolve(home, 'AppData/Roaming'), 'Electron')
        : resolve(environment.XDG_CONFIG_HOME ?? resolve(home, '.config'), 'Electron')
  return resolve(appData, 'school-workbench.sqlite')
}

function stringOption(
  options: Record<string, string | true>,
  name: string,
  fallback: string,
): string {
  const value = options[name]
  return typeof value === 'string' ? value : fallback
}

export async function runActivateMethodologyPackCli(
  argv: readonly string[],
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<number> {
  const options = parseArguments(argv)
  const packKey = options.pack
  const packVersion = options.version
  if (typeof packKey !== 'string' || typeof packVersion !== 'string') {
    write(usage)
    return 2
  }

  const databasePath = stringOption(
    options,
    'database',
    defaultDatabasePath(process.platform, homedir(), process.env),
  )
  if (!existsSync(databasePath)) {
    write(`找不到本地工作台数据库：${databasePath}`)
    write('先启动一次桌面应用完成审核，或用 --database 指定数据库位置。')
    return 1
  }

  const result = await activateMethodologyPack({
    packKey,
    packVersion,
    methodologyRoot: resolve(stringOption(options, 'methodology', 'knowledge/methodology')),
    sourceManifestPath: resolve(stringOption(options, 'manifest', 'references/SOURCE_MANIFEST.md')),
    databasePath,
    migrationsFolder: resolve(stringOption(options, 'migrations', 'packages/db/drizzle')),
    apply: options.apply === true,
  })

  if (!result.plan.ok) {
    write(`拒绝启用 ${packKey}@${packVersion}：${result.plan.code}`)
    write(result.plan.message)
    return 1
  }

  if (!result.applied) {
    write(`${packKey}@${packVersion} 满足启用条件（审核记录 ${result.plan.signOffId}）。`)
    write('加上 --apply 才会真正改写 pack.json 的状态。')
    return 0
  }

  write(`${packKey}@${packVersion}: ${result.plan.from} -> ${result.plan.to}`)
  write(`已改写 ${result.packFilePath ?? ''}，请检查改动后再提交。`)
  write('下次启动桌面应用时，本地库会跟着推进到已启用。')
  return 0
}
