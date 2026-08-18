import { describe, expect, it } from 'vitest'
import { localToolStatuses } from './local-tool-status'

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
