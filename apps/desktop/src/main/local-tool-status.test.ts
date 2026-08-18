import { describe, expect, it } from 'vitest'
import { localToolStatuses, readCodexAcpVersion, runtimeVersions } from './local-tool-status'

describe('local tool status checks', () => {
  it('reports Codex and Feishu CLI separately when both are installed', () => {
    const existing = new Set(['/tools/codex', '/tools/lark-cli'])

    expect(localToolStatuses({ PATH: '/tools' }, (path) => existing.has(path))).toEqual([
      {
        key: 'codex_cli',
        label: 'Codex 命令行工具',
        availability: 'available',
        detail: '已检测到，可用于新的学校分析。',
      },
      {
        key: 'lark_cli',
        label: '飞书命令行工具',
        availability: 'available',
        detail: '已检测到。飞书材料接入尚未启用，后续可继续完成授权设置。',
      },
    ])
  })

  it('reports missing commands without reading credentials or running either CLI', () => {
    expect(localToolStatuses({ PATH: '/tools' }, () => false)).toEqual([
      {
        key: 'codex_cli',
        label: 'Codex 命令行工具',
        availability: 'unavailable',
        detail: '未检测到。安装 Codex 后重新打开设置即可重新检查。',
      },
      {
        key: 'lark_cli',
        label: '飞书命令行工具',
        availability: 'unavailable',
        detail: '未检测到。启用飞书材料接入前需要先安装飞书命令行工具。',
      },
    ])
  })
})

describe('the versions installed on this computer', () => {
  const bundled = '/app/out/main/codex-acp/index.js'

  it('reads Codex by asking it, and never touches a credential', async () => {
    const asked: string[][] = []
    const versions = await runtimeVersions(
      '/app/out/main',
      { PATH: '/tools', SWB_CODEX_ACP_ENTRY: bundled },
      (path) => path === '/tools/codex' || path === bundled,
      async (command, args) => {
        asked.push([command, ...args])
        return 'codex-cli 0.147.0\n'
      },
    )

    expect(asked).toEqual([['/tools/codex', '--version']])
    const codex = versions.find((item) => item.key === 'codex_cli')
    expect(codex?.version).toBe('0.147.0')
    expect(codex?.standing).toBe('verified')
    expect(codex?.note).toBeNull()
  })

  it('marks a version nobody verified without taking anything away', async () => {
    const versions = await runtimeVersions(
      '/app/out/main',
      { PATH: '/tools' },
      (path) => path === '/tools/codex',
      async () => 'codex-cli 0.999.0\n',
    )

    const codex = versions.find((item) => item.key === 'codex_cli')
    expect(codex?.standing).toBe('unverified')
    expect(codex?.note).toBe('此版本未经产品验证。')
    // One line, and that is all it is: nothing here says "stop" or "upgrade
    // first". SPEC 62 keeps the verdict on what the runtime actually answers.
    expect(codex?.note).not.toContain('不能')
  })

  it('says unknown when a tool cannot answer, instead of guessing', async () => {
    const versions = await runtimeVersions('/app/out/main', { PATH: '/tools' }, () => false)
    for (const item of versions) {
      expect(item.version, item.key).toBeNull()
      expect(item.standing, item.key).toBe('unknown')
      expect(item.note, item.key).toBe('暂时读不到这个版本号。')
    }
  })

  it('names the pieces in words a consultant can read', async () => {
    const versions = await runtimeVersions('/app/out/main', { PATH: '/tools' }, () => false)
    const labels = versions.map((item) => item.label).join('\n')
    for (const word of ['codex-acp', 'ACP', 'MCP', 'node_modules', 'bridge']) {
      expect(labels, word).not.toContain(word)
    }
  })

  it('reads the connection component version off the artifact that would be spawned', () => {
    const version = readCodexAcpVersion(
      '/app/out/main',
      { SWB_CODEX_ACP_ENTRY: bundled },
      (path) => path === bundled || path === '/app/out/main/codex-acp/package.json',
      () => JSON.stringify({ name: '@agentclientprotocol/codex-acp', version: '1.4.0' }),
    )
    expect(version).toBe('1.4.0')
  })

  it('leaves the version unknown rather than failing when nothing can be read', () => {
    expect(readCodexAcpVersion('/nowhere', { SWB_CODEX_ACP_ENTRY: '/missing.js' })).toBeNull()
    expect(
      readCodexAcpVersion(
        '/app/out/main',
        { SWB_CODEX_ACP_ENTRY: bundled },
        (path) => path === bundled || path === '/app/out/main/codex-acp/package.json',
        () => 'not json at all',
      ),
    ).toBeNull()
  })
})
