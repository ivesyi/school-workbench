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
})
