import { describe, expect, it } from 'vitest'
import { resolveCodexAcpEntry, resolveSystemCodexPath, resolveWorkbenchMcpEntry } from './paths'

const bundleDirectory = '/app/Contents/Resources/app.asar/out/main'

describe('workbench MCP entry resolution', () => {
  it('prefers the copy placed next to the main bundle', () => {
    const entry = resolveWorkbenchMcpEntry(
      bundleDirectory,
      {},
      (path) => path === '/app/Contents/Resources/app.asar/out/main/workbench-mcp/stdio.js',
    )
    expect(entry).toEqual({
      path: '/app/Contents/Resources/app.asar/out/main/workbench-mcp/stdio.js',
      origin: 'bundled',
    })
  })

  it('falls back to the unpacked copy because a subprocess cannot run from inside asar', () => {
    const unpacked = '/app/Contents/Resources/app.asar.unpacked/out/main/workbench-mcp/stdio.js'
    expect(resolveWorkbenchMcpEntry(bundleDirectory, {}, (path) => path === unpacked)).toEqual({
      path: unpacked,
      origin: 'bundled',
    })
  })

  it('finds the workspace build output during development', () => {
    const workspace =
      '/repo/apps/desktop/node_modules/@school-workbench/workbench-mcp/dist/stdio.js'
    expect(
      resolveWorkbenchMcpEntry('/repo/apps/desktop/out/main', {}, (path) => path === workspace),
    ).toEqual({ path: workspace, origin: 'node_modules' })
  })

  it('honours an explicit override', () => {
    expect(
      resolveWorkbenchMcpEntry(
        '/repo/apps/desktop/out/main',
        { SWB_WORKBENCH_MCP_ENTRY: '/tmp/custom/stdio.js' },
        () => true,
      ),
    ).toEqual({ path: '/tmp/custom/stdio.js', origin: 'environment' })
  })

  it('reports a missing bundle instead of spawning something that is not there', () => {
    expect(() => resolveWorkbenchMcpEntry('/repo/apps/desktop/out/main', {}, () => false)).toThrow(
      /workbench MCP server bundle was not found/u,
    )
    expect(() =>
      resolveWorkbenchMcpEntry(
        '/repo/apps/desktop/out/main',
        { SWB_WORKBENCH_MCP_ENTRY: '/tmp/missing.js' },
        () => false,
      ),
    ).toThrow(/does not exist/u)
  })
})

describe('codex-acp entry resolution', () => {
  it('finds the pinned bridge through node_modules', () => {
    const bridge = '/repo/apps/desktop/node_modules/@agentclientprotocol/codex-acp/dist/index.js'
    expect(
      resolveCodexAcpEntry('/repo/apps/desktop/out/main', {}, (path) => path === bridge),
    ).toEqual({ path: bridge, origin: 'node_modules' })
  })

  it('reports a missing bridge rather than falling back to a network fetch', () => {
    expect(() => resolveCodexAcpEntry('/repo/apps/desktop/out/main', {}, () => false)).toThrow(
      /codex-acp bridge was not found/u,
    )
  })
})

describe('system codex discovery', () => {
  it('prefers the consultant existing codex on PATH (SPEC 12)', () => {
    expect(
      resolveSystemCodexPath(
        { PATH: '/opt/none:/home/user/.local/bin:/usr/bin' },
        (path) => path === '/home/user/.local/bin/codex',
      ),
    ).toBe('/home/user/.local/bin/codex')
  })

  it('returns null when there is no system codex, leaving the runtime to decide', () => {
    expect(resolveSystemCodexPath({ PATH: '/usr/bin' }, () => false)).toBeNull()
    expect(resolveSystemCodexPath({}, () => true)).toBeNull()
  })

  it('honours an explicit override only when it exists', () => {
    expect(resolveSystemCodexPath({ SWB_CODEX_PATH: '/tmp/codex' }, () => true)).toBe('/tmp/codex')
    expect(resolveSystemCodexPath({ SWB_CODEX_PATH: '/tmp/codex' }, () => false)).toBeNull()
  })
})
