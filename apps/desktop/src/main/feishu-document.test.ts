import { describe, expect, it, vi } from 'vitest'
import {
  assembleConsultantMessage,
  classifyFeishuFailure,
  extractDocumentTitle,
  FEISHU_BODY_LIMIT,
  FEISHU_FAILURE_CODES,
  FEISHU_TRUNCATION_NOTE,
  fetchFeishuDocument,
  findFeishuDocumentUrls,
  formatFetchedDocument,
  humanFeishuFailure,
  prepareConsultantMessage,
  testFeishuRead,
  truncateFeishuBody,
  type CommandResult,
  type RunTimedCommand,
} from './feishu-document'

const DOC_URL = 'https://sample.feishu.cn/docx/Abc123Token'
const WIKI_URL = 'https://sample.feishu.cn/wiki/Wik456Token'

function boundAuthJson(): string {
  return JSON.stringify({
    identities: { user: { status: 'ready', available: true, userName: '易虎' } },
  })
}

function unboundAuthJson(): string {
  return JSON.stringify({
    identities: { user: { status: 'missing', available: false, userName: '易虎' } },
  })
}

function fetchPayload(content: string): string {
  return JSON.stringify({
    ok: true,
    data: { document: { document_id: 'doxcnTEST', content } },
  })
}

function result(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    stdout: '',
    stderr: '',
    timedOut: false,
    exitCode: 0,
    ...overrides,
  }
}

function mockRun(handler: RunTimedCommand): RunTimedCommand {
  return handler
}

describe('recognising Feishu document links', () => {
  it('finds feishu.cn docx and wiki URLs and de-duplicates them', () => {
    const text = `先看 ${DOC_URL} ，知识库在 ${WIKI_URL}。同一份再贴一次 ${DOC_URL}`
    expect(findFeishuDocumentUrls(text)).toEqual([DOC_URL, WIKI_URL])
  })

  it('ignores other hosts and non-document paths', () => {
    expect(
      findFeishuDocumentUrls(
        'https://example.com/docx/Abc 以及 https://sample.larksuite.com/docx/Abc 还有 https://sample.feishu.cn/drive/Abc',
      ),
    ).toEqual([])
  })
})

describe('title, truncation and source marking', () => {
  it('prefers a markdown heading, then an xml title', () => {
    expect(extractDocumentTitle('# 课堂观察纪要\n\n正文')).toBe('课堂观察纪要')
    expect(extractDocumentTitle('<title>阶段复盘</title><p>正文</p>')).toBe('阶段复盘')
  })

  it('cuts a long body and notes that it did', () => {
    const long = '甲'.repeat(FEISHU_BODY_LIMIT + 40)
    const cut = truncateFeishuBody(long)
    expect(cut.truncated).toBe(true)
    expect(cut.text.endsWith(FEISHU_TRUNCATION_NOTE)).toBe(true)
    expect(cut.text.startsWith('甲'.repeat(FEISHU_BODY_LIMIT))).toBe(true)
    expect(truncateFeishuBody('短的').truncated).toBe(false)
  })

  it('keeps the consultant original when the combined text would overflow', () => {
    const original = '甲'.repeat(19_500)
    const assembled = assembleConsultantMessage(original, [
      {
        url: DOC_URL,
        title: '长文',
        body: '乙'.repeat(8000),
        fetchedAt: new Date('2026-08-19T04:00:00.000Z'),
      },
    ])
    expect(assembled.startsWith(original)).toBe(true)
    expect(assembled.length).toBeLessThanOrEqual(20_000)
    expect(assembled.slice(0, original.length)).toBe(original)
  })

  it('marks the source of a fetched document', () => {
    const block = formatFetchedDocument({
      url: DOC_URL,
      title: '课堂观察纪要',
      body: '今天校长仍在拆任务。',
      fetchedAt: new Date('2026-08-19T04:05:00.000Z'),
    })
    expect(block).toContain('—— 飞书文档 ——')
    expect(block).toContain(`出处：${DOC_URL}`)
    expect(block).toContain('标题：《课堂观察纪要》')
    expect(block).toContain('取回时间：')
    expect(block).toContain('今天校长仍在拆任务。')
    expect(block).toContain('—— 飞书文档结束 ——')
  })
})

describe('classifying a failed read', () => {
  it('maps typical tool output onto four honest reasons', () => {
    expect(classifyFeishuFailure('User identity: missing (no token)')).toBe('unbound')
    expect(classifyFeishuFailure('permission denied 403')).toBe('permission')
    expect(classifyFeishuFailure('document not found')).toBe('invalid_link')
  })

  it('writes the consultant-facing sentence without machinery words', () => {
    const text = humanFeishuFailure('unbound')
    expect(text).toContain('链接里的文档没能取回来：飞书还没绑定')
    expect(text).toContain('可以把文档内容直接粘贴进来再试')
    for (const word of ['lark-cli', 'CLI', 'token', 'OAuth']) {
      expect(text, word).not.toContain(word)
    }
  })
})

describe('fetching a document through a mocked subprocess', () => {
  it('returns the title and body when the tool answers', async () => {
    const run = mockRun(async (_command, args) => {
      if (args[0] === 'auth') return result({ stdout: boundAuthJson() })
      expect(args).toEqual([
        'docs',
        '+fetch',
        '--api-version',
        'v2',
        '--as',
        'user',
        '--doc',
        DOC_URL,
        '--doc-format',
        'markdown',
        '--json',
      ])
      return result({ stdout: fetchPayload('# 课堂观察纪要\n\n校长仍在拆任务。') })
    })

    const fetched = await fetchFeishuDocument(DOC_URL, {
      environment: { PATH: '/tools' },
      exists: (path) => path === '/tools/lark-cli',
      run,
    })

    expect(fetched).toEqual({
      ok: true,
      title: '课堂观察纪要',
      body: '# 课堂观察纪要\n\n校长仍在拆任务。',
      truncated: false,
    })
  })

  it('does not call the document command when nobody is signed in', async () => {
    const asked: string[][] = []
    const fetched = await fetchFeishuDocument(DOC_URL, {
      environment: { PATH: '/tools' },
      exists: (path) => path === '/tools/lark-cli',
      run: async (_command, args) => {
        asked.push([...args])
        return result({ stdout: unboundAuthJson() })
      },
    })

    expect(fetched).toEqual({ ok: false, reason: 'unbound' })
    expect(asked).toEqual([['auth', 'status', '--json']])
  })

  it('reports a timeout without retrying', async () => {
    const fetched = await fetchFeishuDocument(DOC_URL, {
      environment: { PATH: '/tools' },
      exists: (path) => path === '/tools/lark-cli',
      run: async (_command, args) => {
        if (args[0] === 'auth') return result({ stdout: boundAuthJson() })
        return result({ timedOut: true, exitCode: null })
      },
    })
    expect(fetched).toEqual({ ok: false, reason: 'timeout' })
  })
})

describe('the settings read test', () => {
  it('says the title in plain words when the document can be read', async () => {
    const view = await testFeishuRead(DOC_URL, {
      now: () => new Date('2026-08-19T04:00:00.000Z'),
      fetch: async () => ({
        ok: true,
        title: '课堂观察纪要',
        body: '正文',
        truncated: false,
      }),
    })
    expect(view.state).toBe('ok')
    expect(view.headline).toBe('能读到：《课堂观察纪要》')
    expect(view.reason).toBeNull()
  })

  it('says the person is not bound, without machinery words', async () => {
    const view = await testFeishuRead(DOC_URL, {
      now: () => new Date('2026-08-19T04:00:00.000Z'),
      fetch: async () => ({ ok: false, reason: 'unbound' }),
    })
    expect(view.state).toBe('failed')
    expect(view.reason).toBe('unbound')
    expect(view.detail).toContain('还没绑定')
    expect(view.detail).not.toContain('lark-cli')
  })

  it('says it waited too long', async () => {
    const view = await testFeishuRead(DOC_URL, {
      now: () => new Date('2026-08-19T04:00:00.000Z'),
      fetch: async () => ({ ok: false, reason: 'timeout' }),
    })
    expect(view.state).toBe('failed')
    expect(view.reason).toBe('timeout')
    expect(view.detail).toContain('等了太久')
  })
})

describe('preparing the analysis message', () => {
  it('leaves a message without links untouched and does not fetch', async () => {
    const fetch = vi.fn()
    const prepared = await prepareConsultantMessage('今天中层会议还是校长在拆任务。', { fetch })
    expect(prepared).toEqual({ ok: true, message: '今天中层会议还是校长在拆任务。' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('folds fetched documents into the message with a source marker', async () => {
    const logs: string[] = []
    const prepared = await prepareConsultantMessage(`请看这份材料 ${DOC_URL}`, {
      now: () => new Date('2026-08-19T04:05:00.000Z'),
      log: (line) => logs.push(line),
      fetch: async () => ({
        ok: true,
        title: '课堂观察纪要',
        body: '今天校长仍在拆任务。',
        truncated: false,
      }),
    })

    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.message).toContain('请看这份材料')
    expect(prepared.message).toContain('—— 飞书文档 ——')
    expect(prepared.message).toContain(`出处：${DOC_URL}`)
    expect(prepared.message).toContain('标题：《课堂观察纪要》')
    expect(prepared.message).toContain('今天校长仍在拆任务。')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain(`feishu fetch url=${DOC_URL} result=ok elapsedMs=`)
    expect(logs[0]).not.toContain('今天校长仍在拆任务')
  })

  it('stops the run when a document cannot be read', async () => {
    const logs: string[] = []
    const prepared = await prepareConsultantMessage(`请看 ${DOC_URL}`, {
      log: (line) => logs.push(line),
      fetch: async () => ({ ok: false, reason: 'permission' }),
    })

    expect(prepared).toEqual({
      ok: false,
      reason: 'permission',
      failureCode: FEISHU_FAILURE_CODES.permission,
      detail: humanFeishuFailure('permission'),
    })
    expect(logs[0]).toContain(`url=${DOC_URL}`)
    expect(logs[0]).toContain('result=permission')
  })
})
