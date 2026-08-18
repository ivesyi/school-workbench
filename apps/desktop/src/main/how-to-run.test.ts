import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The starting guide is read by a school transformation consultant, not by an
 * engineer. That is a property worth keeping true as the guide is edited, so it
 * is checked rather than remembered.
 */
const guide = readFileSync(resolve('docs/development/HOW_TO_RUN.md'), 'utf8')

describe('the guide the consultant reads first', () => {
  it('names no piece of machinery', () => {
    for (const word of [
      'ACP',
      'MCP',
      'loopback',
      'stdio',
      'schema',
      'migration',
      'SQLite',
      'IPC',
      'JSON',
      'scope',
      'token',
      'Token',
      'session',
      'Session',
      'runtime',
      'Runtime',
      'API',
      'node_modules',
    ]) {
      expect(guide, word).not.toMatch(new RegExp(word, 'i'))
    }

    // `pnpm dev` is the one command the consultant has to type, so the check is
    // on a bare `npm`, not on the substring inside it.
    expect(guide).not.toMatch(/\bnpm\b/iu)
  })

  it('answers the four questions someone starting from nothing has', () => {
    // How to start it, where to click, what it looks like when it works, and
    // what to do when it does not.
    expect(guide).toContain('pnpm dev')
    expect(guide).toContain('默认 AI 助手')
    expect(guide).toContain('正在理解学校现在的情况……')
    expect(guide).toContain('遇到问题怎么办')
  })

  it('says plainly that nothing becomes formal without the consultant', () => {
    expect(guide).toContain('只有你说了算')
    expect(guide).toContain('codex login')
  })

  it('never promises a workbench that works without an assistant', () => {
    expect(guide).not.toContain('不用 AI 也能完整使用')
    expect(guide).not.toMatch(/暂不使用 ?AI/)
    // New analysis needs an assistant, and what remains possible without one is
    // stated rather than implied.
    expect(guide).toContain('新的分析必须有 AI 助手')
    expect(guide).toContain('现在还不能开始新的分析')
  })

  it('never promises a judgement the workbench would write on the assistant behalf', () => {
    expect(guide).not.toContain('我先把你说的这条记下来了')
    expect(guide).toContain('不会替它写一条判断')
    expect(guide).toContain('不会替它另外整理一条判断')
  })

  it('does not overstate where the consultant data goes', () => {
    // Analysis is carried out by Codex, so "nothing ever leaves this computer"
    // would be untrue.
    expect(guide).not.toContain('没有上传到任何地方')
    expect(guide).toContain('不完全留在本机')
  })
})
