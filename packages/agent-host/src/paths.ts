import { existsSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { AgentHostError } from './contracts'

export type PathExists = (path: string) => boolean

export type ResolvedEntry = Readonly<{
  path: string
  origin: 'environment' | 'bundled' | 'node_modules'
}>

/**
 * Yields `<dir>`, `<dir>/..`, ... up to the filesystem root.
 *
 * An Electron main bundle lives at `apps/desktop/out/main`, so walking up is
 * how a spawned-artifact path is found in a development checkout as well as in
 * an unpacked application directory.
 */
function ancestors(from: string): string[] {
  const chain: string[] = []
  let current = resolve(from)
  for (;;) {
    chain.push(current)
    const parent = dirname(current)
    if (parent === current) return chain
    current = parent
  }
}

/**
 * A subprocess cannot be executed from inside an asar archive, so every
 * candidate inside `app.asar` is also probed in `app.asar.unpacked`.
 */
function withAsarFallback(candidate: string): string[] {
  return candidate.includes(`${'app.asar'}${'/'}`) || candidate.endsWith('app.asar')
    ? [candidate, candidate.replace('app.asar', 'app.asar.unpacked')]
    : [candidate]
}

function firstExisting(candidates: readonly string[], exists: PathExists): string | null {
  for (const candidate of candidates) {
    for (const probed of withAsarFallback(candidate)) {
      if (exists(probed)) return probed
    }
  }
  return null
}

function fromEnvironment(
  value: string | undefined,
  variable: string,
  exists: PathExists,
): ResolvedEntry | null {
  if (!value) return null
  const absolute = resolve(value)
  if (!exists(absolute)) {
    throw new AgentHostError(
      'RUNTIME_NOT_FOUND',
      `${variable} points at a path that does not exist: ${absolute}`,
    )
  }
  return Object.freeze({ path: absolute, origin: 'environment' })
}

/**
 * Locates the bundled workbench MCP server entry point.
 *
 * Order:
 *   1. `SWB_WORKBENCH_MCP_ENTRY` override;
 *   2. the copy `electron-vite` places next to the main bundle (packaged app);
 *   3. the workspace build output reachable through `node_modules`
 *      (`pnpm dev` / `pnpm test`).
 *
 * `packages/workbench-mcp` is bundled by esbuild into `dist/stdio.js`, so the
 * file only exists once that package has been built. The root `dev` and `build`
 * scripts both build it first.
 */
export function resolveWorkbenchMcpEntry(
  currentDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
  exists: PathExists = existsSync,
): ResolvedEntry {
  const overridden = fromEnvironment(
    environment.SWB_WORKBENCH_MCP_ENTRY,
    'SWB_WORKBENCH_MCP_ENTRY',
    exists,
  )
  if (overridden) return overridden

  const bundled = firstExisting(
    [join(resolve(currentDirectory), 'workbench-mcp', 'stdio.js')],
    exists,
  )
  if (bundled) return Object.freeze({ path: bundled, origin: 'bundled' })

  const fromModules = firstExisting(
    ancestors(currentDirectory).map((directory) =>
      join(directory, 'node_modules', '@school-workbench', 'workbench-mcp', 'dist', 'stdio.js'),
    ),
    exists,
  )
  if (fromModules) return Object.freeze({ path: fromModules, origin: 'node_modules' })

  throw new AgentHostError(
    'WORKBENCH_MCP_NOT_FOUND',
    'The workbench MCP server bundle was not found. Build @school-workbench/workbench-mcp first.',
  )
}

/**
 * Locates the `codex-acp` ACP bridge entry point.
 *
 * SPEC 12 keeps the workbench on the ACP boundary: `codex-acp` is spawned as an
 * opaque artifact and never imported, so it is resolved by path rather than by
 * `import`. The version is pinned in `apps/desktop/package.json`; nothing here
 * inspects or branches on it (SPEC 62 forbids hard-coded version checks).
 */
export function resolveCodexAcpEntry(
  currentDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
  exists: PathExists = existsSync,
): ResolvedEntry {
  const overridden = fromEnvironment(environment.SWB_CODEX_ACP_ENTRY, 'SWB_CODEX_ACP_ENTRY', exists)
  if (overridden) return overridden

  const bundled = firstExisting([join(resolve(currentDirectory), 'codex-acp', 'index.js')], exists)
  if (bundled) return Object.freeze({ path: bundled, origin: 'bundled' })

  const fromModules = firstExisting(
    ancestors(currentDirectory).map((directory) =>
      join(directory, 'node_modules', '@agentclientprotocol', 'codex-acp', 'dist', 'index.js'),
    ),
    exists,
  )
  if (fromModules) return Object.freeze({ path: fromModules, origin: 'node_modules' })

  throw new AgentHostError(
    'RUNTIME_NOT_FOUND',
    'The codex-acp bridge was not found. Install @agentclientprotocol/codex-acp.',
  )
}

/**
 * Finds the consultant's own `codex` executable.
 *
 * SPEC 12 says the workbench prefers the consultant's existing system Codex.
 * codex-acp reads `CODEX_PATH` and only falls back to the copy it vendors when
 * the variable is absent, so pointing it at the system binary is the whole
 * integration. Nothing here reads or writes Codex credentials or configuration.
 */
export function resolveSystemCodexPath(
  environment: NodeJS.ProcessEnv = process.env,
  exists: PathExists = existsSync,
): string | null {
  const overridden = environment.SWB_CODEX_PATH
  if (overridden) {
    const absolute = resolve(overridden)
    return exists(absolute) ? absolute : null
  }

  const pathValue = environment.PATH ?? ''
  for (const directory of pathValue.split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue
    const candidate = join(directory, 'codex')
    if (exists(candidate)) return candidate
  }
  return null
}
