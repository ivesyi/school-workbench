import { execFile, type ExecFileException } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { FeishuReadFailureReason, FeishuReadTestView } from '@school-workbench/shared'
import { probeFeishuBinding, resolveSystemLarkCliPath } from './local-tool-status'

export const FEISHU_FETCH_TIMEOUT_MS = 30_000
export const FEISHU_BODY_LIMIT = 12_000
export const CONSULTANT_MESSAGE_LIMIT = 20_000
export const FEISHU_TRUNCATION_NOTE = '（内容过长，已截取前一部分）'

export const FEISHU_FAILURE_CODES = Object.freeze({
  unbound: 'FEISHU_UNBOUND',
  permission: 'FEISHU_PERMISSION',
  invalid_link: 'FEISHU_INVALID_LINK',
  timeout: 'FEISHU_TIMEOUT',
})

export const FEISHU_FAILURE_COPY = Object.freeze({
  unbound: '飞书还没绑定',
  permission: '没有读这份文档的权限',
  invalid_link: '这个链接不像是一份飞书文档',
  timeout: '等太久没有读回来',
})

/**
 * feishu.cn cloud-doc or wiki links. Query strings and trailing punctuation
 * are stripped so a sentence-final URL still counts.
 */
const FEISHU_DOCUMENT_URL = /https?:\/\/(?:[a-z0-9-]+\.)?feishu\.cn\/(?:docx|wiki)\/[A-Za-z0-9]+/gi

export type CommandResult = Readonly<{
  stdout: string
  stderr: string
  timedOut: boolean
  exitCode: number | null
}>

export type RunTimedCommand = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<CommandResult>

export type FeishuDocumentSuccess = Readonly<{
  ok: true
  title: string
  body: string
  truncated: boolean
}>

export type FeishuDocumentFailure = Readonly<{
  ok: false
  reason: FeishuReadFailureReason
}>

export type FeishuDocumentResult = FeishuDocumentSuccess | FeishuDocumentFailure

export type FetchedFeishuDocument = Readonly<{
  url: string
  title: string
  body: string
  fetchedAt: Date
}>

export type PrepareConsultantMessageResult =
  | Readonly<{ ok: true; message: string }>
  | Readonly<{
      ok: false
      reason: FeishuReadFailureReason
      failureCode: string
      detail: string
    }>

const defaultRun: RunTimedCommand = (command, args, timeoutMs) =>
  new Promise((resolvePromise) => {
    execFile(
      command,
      [...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error: ExecFileException | null, stdout, stderr) => {
        const timedOut = Boolean(error?.killed)
        resolvePromise({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut,
          exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        })
      },
    )
  })

export function findFeishuDocumentUrls(text: string): readonly string[] {
  const seen = new Set<string>()
  const found: string[] = []
  const matcher = new RegExp(FEISHU_DOCUMENT_URL.source, FEISHU_DOCUMENT_URL.flags)
  for (const match of text.matchAll(matcher)) {
    const url = match[0]
    if (seen.has(url)) continue
    seen.add(url)
    found.push(url)
  }
  return found
}

export function isFeishuDocumentUrl(value: string): boolean {
  const trimmed = value.trim()
  const matcher = new RegExp(`^${FEISHU_DOCUMENT_URL.source}$`, 'i')
  return matcher.test(trimmed)
}

export function classifyFeishuFailure(output: string): FeishuReadFailureReason {
  const text = output.toLowerCase()
  if (
    /not logged|no token|missing token|unauthorized|unauthorised|identity.*missing|user identity: missing|auth login|401/.test(
      text,
    )
  ) {
    return 'unbound'
  }
  if (/permission|forbidden|access denied|403|permission_violat/.test(text)) {
    return 'permission'
  }
  return 'invalid_link'
}

export function extractDocumentTitle(content: string): string {
  const xml = content.match(/<title>([\s\S]*?)<\/title>/i)
  if (xml?.[1]) {
    const title = xml[1].replace(/<[^>]+>/g, '').trim()
    if (title) return title
  }
  const heading = content.match(/^\s{0,3}#\s+(.+)$/m)
  if (heading?.[1]) {
    const title = heading[1].trim()
    if (title) return title
  }
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  return firstLine && firstLine.length <= 120 ? firstLine : '未命名文档'
}

export function truncateFeishuBody(body: string): { text: string; truncated: boolean } {
  if (body.length <= FEISHU_BODY_LIMIT) return { text: body, truncated: false }
  return {
    text: `${body.slice(0, FEISHU_BODY_LIMIT)}\n${FEISHU_TRUNCATION_NOTE}`,
    truncated: true,
  }
}

function extractJsonValue(text: string): unknown {
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const start =
    objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart)
  if (start < 0) return null
  const opening = text[start]
  const closing = opening === '[' ? ']' : '}'
  const end = text.lastIndexOf(closing)
  if (end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}

function contentFromFetchPayload(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const root = parsed as {
    ok?: unknown
    data?: { document?: { content?: unknown; title?: unknown } }
  }
  if (root.ok === false) return null
  const content = root.data?.document?.content
  return typeof content === 'string' ? content : null
}

export function humanFeishuFailure(reason: FeishuReadFailureReason): string {
  return `链接里的文档没能取回来：${FEISHU_FAILURE_COPY[reason]}。你写的内容还在，可以把文档内容直接粘贴进来再试。`
}

export function formatFetchedDocument(document: FetchedFeishuDocument): string {
  const fetchedAt = document.fetchedAt
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC')
  return [
    '—— 飞书文档 ——',
    `出处：${document.url}`,
    `标题：《${document.title}》`,
    `取回时间：${fetchedAt}`,
    '—— 正文 ——',
    document.body,
    '—— 飞书文档结束 ——',
  ].join('\n')
}

export function assembleConsultantMessage(
  original: string,
  documents: readonly FetchedFeishuDocument[],
): string {
  if (documents.length === 0) return original
  const suffix = `\n\n${documents.map(formatFetchedDocument).join('\n\n')}`
  const budget = CONSULTANT_MESSAGE_LIMIT - original.length
  if (budget <= 0) return original.slice(0, CONSULTANT_MESSAGE_LIMIT)
  if (suffix.length <= budget) return original + suffix
  return original + suffix.slice(0, budget)
}

export async function fetchFeishuDocument(
  url: string,
  options: {
    environment?: NodeJS.ProcessEnv
    exists?: (path: string) => boolean
    run?: RunTimedCommand
    timeoutMs?: number
  } = {},
): Promise<FeishuDocumentResult> {
  if (!isFeishuDocumentUrl(url)) {
    return { ok: false, reason: 'invalid_link' }
  }

  const environment = options.environment ?? process.env
  const exists = options.exists ?? existsSync
  const run = options.run ?? defaultRun
  const timeoutMs = options.timeoutMs ?? FEISHU_FETCH_TIMEOUT_MS
  const cli = resolveSystemLarkCliPath(environment, exists)
  if (!cli) return { ok: false, reason: 'unbound' }

  const binding = await probeFeishuBinding(environment, exists, async (command, args) => {
    const result = await run(command, args, AUTH_STATUS_AS_FETCH_TIMEOUT_MS)
    return `${result.stdout}${result.stderr}`
  })
  if (binding.state !== 'bound') return { ok: false, reason: 'unbound' }

  const result = await run(
    cli,
    [
      'docs',
      '+fetch',
      '--api-version',
      'v2',
      '--as',
      'user',
      '--doc',
      url.trim(),
      '--doc-format',
      'markdown',
      '--json',
    ],
    timeoutMs,
  )

  if (result.timedOut) return { ok: false, reason: 'timeout' }

  const combined = `${result.stdout}\n${result.stderr}`
  const parsed = extractJsonValue(result.stdout) ?? extractJsonValue(combined)
  const content = contentFromFetchPayload(parsed)
  if (content === null) {
    return { ok: false, reason: classifyFeishuFailure(combined) }
  }

  const trimmed = content.trim()
  const cut = truncateFeishuBody(trimmed)
  return {
    ok: true,
    title: extractDocumentTitle(trimmed),
    body: cut.text,
    truncated: cut.truncated,
  }
}

const AUTH_STATUS_AS_FETCH_TIMEOUT_MS = 5_000

export async function prepareConsultantMessage(
  message: string,
  options: {
    environment?: NodeJS.ProcessEnv
    exists?: (path: string) => boolean
    run?: RunTimedCommand
    fetch?: (url: string) => Promise<FeishuDocumentResult>
    now?: () => Date
    log?: (line: string) => void
    timeoutMs?: number
  } = {},
): Promise<PrepareConsultantMessageResult> {
  const urls = findFeishuDocumentUrls(message)
  if (urls.length === 0) return { ok: true, message }

  const fetch =
    options.fetch ??
    ((url: string) =>
      fetchFeishuDocument(url, {
        ...(options.environment ? { environment: options.environment } : {}),
        ...(options.exists ? { exists: options.exists } : {}),
        ...(options.run ? { run: options.run } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      }))
  const now = options.now ?? (() => new Date())
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`))

  const documents: FetchedFeishuDocument[] = []
  for (const url of urls) {
    const started = Date.now()
    const result = await fetch(url)
    const elapsedMs = Date.now() - started
    log(`feishu fetch url=${url} result=${result.ok ? 'ok' : result.reason} elapsedMs=${elapsedMs}`)
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        failureCode: FEISHU_FAILURE_CODES[result.reason],
        detail: humanFeishuFailure(result.reason),
      }
    }
    documents.push({
      url,
      title: result.title,
      body: result.body,
      fetchedAt: now(),
    })
  }

  return { ok: true, message: assembleConsultantMessage(message, documents) }
}

export async function testFeishuRead(
  url: string,
  options: {
    environment?: NodeJS.ProcessEnv
    exists?: (path: string) => boolean
    run?: RunTimedCommand
    fetch?: (url: string) => Promise<FeishuDocumentResult>
    now?: () => Date
    timeoutMs?: number
  } = {},
): Promise<FeishuReadTestView> {
  const started = Date.now()
  const now = options.now ?? (() => new Date())
  const fetch =
    options.fetch ??
    ((candidate: string) =>
      fetchFeishuDocument(candidate, {
        ...(options.environment ? { environment: options.environment } : {}),
        ...(options.exists ? { exists: options.exists } : {}),
        ...(options.run ? { run: options.run } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      }))

  const result = await fetch(url)
  const durationSeconds = Math.max(0, Math.round((Date.now() - started) / 1000))
  const checkedAt = now().toISOString()

  if (result.ok) {
    return {
      state: 'ok',
      headline: `能读到：《${result.title}》`,
      detail: '这份文档现在可以读。把链接贴进学校里的情况，AI 助手就能看到正文。',
      title: result.title,
      durationSeconds,
      checkedAt,
      reason: null,
    }
  }

  return {
    state: 'failed',
    headline: '没能读到',
    detail: readTestFailureDetail(result.reason),
    title: null,
    durationSeconds,
    checkedAt,
    reason: result.reason,
  }
}

function readTestFailureDetail(reason: FeishuReadFailureReason): string {
  switch (reason) {
    case 'unbound':
      return '飞书还没绑定，所以读不到这份文档。先到上面完成绑定，再试一次。'
    case 'permission':
      return '没有读这份文档的权限。换一份你能打开的，或者把内容直接粘贴进来。'
    case 'invalid_link':
      return '这个链接不像是一份飞书文档。请贴飞书云文档或知识库文档的链接。'
    case 'timeout':
      return '等了太久还是没读回来。请稍后再试，或者把文档内容直接粘贴进来。'
  }
}
