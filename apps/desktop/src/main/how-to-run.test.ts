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

  it('tells the consultant how to find out whether the assistant is reachable', () => {
    expect(guide).toContain('运行连接测试')
    // Two promises the button has to keep, stated where the consultant reads
    // about it: no school material is used, and nothing is recorded.
    expect(guide).toContain('不会用到任何学校的资料')
    // And a failure is never turned into the consultant's fault.
    expect(guide).toContain('不是你写错了什么，也不是学校资料有问题')
  })

  it('describes switching assistant as a choice, never as something automatic', () => {
    expect(guide).toContain('换个助手重试')
    expect(guide).toContain('永远不会自己替你换助手')
    // Two assistants exist now, so the control can genuinely appear. The guide
    // must say when it does not — and must not describe either as a fallback
    // for the other (PRD 15).
    expect(guide).toContain('只有一个能用时这块不会出现')
    expect(guide).toContain('两个是平等的，不分主备')
  })

  it('explains the second assistant by what it needs, not by what runs it', () => {
    expect(guide).toContain('工作台自带助手')
    expect(guide).toContain('AI 模型连接')
    // The key handling is the part a consultant has to be able to trust, so it
    // is stated where they set it up rather than left to a design document.
    expect(guide).toContain('系统钥匙串')
    expect(guide).toContain('拒绝保存')
    for (const word of ['pi', 'harness', 'provider', 'safeStorage', 'OpenAI']) {
      expect(guide, word).not.toContain(word)
    }
  })

  it('tells the consultant how to let the assistant read a Feishu document', () => {
    expect(guide).toContain('让 AI 助手能看飞书文档')
    expect(guide).toContain('读取测试')
    expect(guide).toContain('可以把文档内容直接粘贴进来再试')
  })

  it('says a version notice is a notice, not a block', () => {
    expect(guide).toContain('此版本未经产品验证')
    expect(guide).toContain('不会**因此不让你用')
  })

  it('does not overstate where the consultant data goes', () => {
    // Analysis is carried out by Codex, so "nothing ever leaves this computer"
    // would be untrue.
    expect(guide).not.toContain('没有上传到任何地方')
    expect(guide).toContain('不完全留在本机')
  })
})
