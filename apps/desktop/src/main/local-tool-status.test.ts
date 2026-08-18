import { describe, expect, it } from 'vitest'
import { pinnedBuiltinHarnessVersion } from '@school-workbench/agent-host'
import {
  FEISHU_BIND_COMMAND,
  localToolStatuses,
  probeFeishuBinding,
  readCodexAcpVersion,
  runtimeVersions,
} from './local-tool-status'

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
        detail: '已检测到。绑定情况和读取测试见下方「飞书」。',
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
        detail: '未检测到。要让 AI 助手读飞书文档，需要先在这台电脑上装好飞书。',
      },
    ])
  })
})

describe('Feishu binding three-state', () => {
  it('is uninstalled when the tool is not on disk', async () => {
    const asked: string[][] = []
    const view = await probeFeishuBinding({ PATH: '/tools' }, () => false, async (command, args) => {
      asked.push([command, ...args])
      return ''
    })

    expect(view.state).toBe('uninstalled')
    expect(view.accountName).toBeNull()
    expect(view.bindCommand).toBeNull()
    expect(view.detail).toContain('还没装好飞书')
    expect(asked).toEqual([])
  })

  it('is unbound when the tool is installed but the person is not signed in', async () => {
    const asked: string[][] = []
    const view = await probeFeishuBinding(
      { PATH: '/tools' },
      (path) => path === '/tools/lark-cli',
      async (command, args) => {
        asked.push([command, ...args])
        return JSON.stringify({
          identities: {
            user: {
              status: 'missing',
              available: false,
              userName: '易虎',
            },
          },
        })
      },
    )

    expect(asked).toEqual([['/tools/lark-cli', 'auth', 'status', '--json']])
    expect(view.state).toBe('unbound')
    expect(view.accountName).toBeNull()
    expect(view.bindCommand).toBe(FEISHU_BIND_COMMAND)
    expect(view.detail).toContain('还没绑定')
    expect(view.detail).not.toContain('token')
  })

  it('is bound and shows the account name when the user identity is ready', async () => {
    const view = await probeFeishuBinding(
      { PATH: '/tools' },
      (path) => path === '/tools/lark-cli',
      async () =>
        JSON.stringify({
          identities: {
            user: {
              status: 'ready',
              available: true,
              userName: '易虎',
            },
          },
        }),
    )

    expect(view.state).toBe('bound')
    expect(view.accountName).toBe('易虎')
    expect(view.bindCommand).toBeNull()
    expect(view.detail).toBe('已绑定：易虎')
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
    // The two external pieces are what can go missing. The pinned harness is
    // part of this build, so its version is never unknown — it is reported
    // below instead.
    for (const item of versions.filter((entry) => entry.key !== 'builtin_harness')) {
      expect(item.version, item.key).toBeNull()
      expect(item.standing, item.key).toBe('unknown')
      expect(item.note, item.key).toBe('暂时读不到这个版本号。')
    }
  })

  it('reports the pinned harness version, and does not claim it has been verified', async () => {
    const versions = await runtimeVersions('/app/out/main', { PATH: '/tools' }, () => false)
    const builtin = versions.find((item) => item.key === 'builtin_harness')

    // Pinned in this repository's lockfile, so it is always known — there is
    // no machine on which this build runs a different one.
    expect(builtin?.version).toBe(pinnedBuiltinHarnessVersion)
    // And no end-to-end run against a real model has been done on it yet, so
    // the page says exactly that rather than implying somebody checked.
    expect(builtin?.standing).toBe('unverified')
    expect(builtin?.note).toBe('此版本未经产品验证。')
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
