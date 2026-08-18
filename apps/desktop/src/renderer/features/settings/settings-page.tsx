import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Separator,
} from '@school-workbench/experience'
import type {
  AssistantChoice,
  AssistantConnectionCheckView,
  AssistantSettingsView,
} from '@school-workbench/shared'
import { CheckCircle2, ChevronRight, CircleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWorkbenchApi } from '../../lib/workbench-api'

export function SettingsPage(): React.JSX.Element {
  const api = useWorkbenchApi()
  const [assistant, setAssistant] = useState<AssistantSettingsView | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<AssistantConnectionCheckView | null>(null)
  const [channelBaseUrl, setChannelBaseUrl] = useState('')
  const [channelModel, setChannelModel] = useState('')
  // Never seeded from what is stored, because what is stored is never read
  // back. An empty box means "type a new one", which is the only thing a
  // consultant can do with a key the workbench cannot show them.
  const [channelApiKey, setChannelApiKey] = useState('')
  const [savingChannel, setSavingChannel] = useState(false)
  const [channelMessage, setChannelMessage] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void api.settings
      .getAssistant()
      .then((result) => {
        if (!current) return
        setAssistant(result)
        setChannelBaseUrl(result.modelChannel.baseUrl ?? '')
        setChannelModel(result.modelChannel.model ?? '')
      })
      .catch(() => {
        if (current) setError('暂时读不到 AI 助手的设置。')
      })
    return () => {
      current = false
    }
  }, [api])

  async function choose(next: AssistantChoice): Promise<void> {
    if (saving || assistant?.selected === next) return
    setSaving(true)
    setError(null)
    try {
      setAssistant(await api.settings.chooseAssistant({ assistant: next }))
    } catch {
      setError('这次没能保存你的选择，请再试一次。')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Really asks the assistant a trivial question and reports what came back.
   *
   * Only ever started here, by hand: it costs a real turn, so nothing runs it
   * on launch. The answer is shown and nothing else — it never switches
   * assistant, never retries, and never changes what the workbench will allow.
   */
  async function runConnectionCheck(): Promise<void> {
    if (checking) return
    setChecking(true)
    setError(null)
    setCheckResult(null)
    try {
      setCheckResult(await api.settings.checkConnection())
    } catch {
      setError('这次没能完成连接测试，请稍后再试一次。')
    } finally {
      setChecking(false)
    }
  }

  /**
   * Saves the model connection.
   *
   * The key leaves this component once, on its way to the operating system's
   * secret store, and is cleared from the form straight afterwards. Nothing
   * reads it back, so nothing here can put it on screen again.
   */
  async function saveModelChannel(): Promise<void> {
    if (savingChannel) return
    setSavingChannel(true)
    setChannelMessage(null)
    try {
      const result = await api.settings.saveModelChannel({
        baseUrl: channelBaseUrl.trim(),
        model: channelModel.trim(),
        apiKey: channelApiKey,
      })
      setChannelApiKey('')
      setChannelMessage(result.saved ? '已保存。' : result.problem)
      // The assistant list depends on this, so it is re-read rather than
      // guessed at: an assistant that just became usable should say so.
      setAssistant(await api.settings.getAssistant())
    } catch {
      setChannelMessage('这次没能保存，请检查填写内容后再试一次。')
    } finally {
      setSavingChannel(false)
    }
  }

  async function clearModelChannel(): Promise<void> {
    if (savingChannel) return
    setSavingChannel(true)
    setChannelMessage(null)
    try {
      const next = await api.settings.clearModelChannel()
      setAssistant(next)
      setChannelBaseUrl('')
      setChannelModel('')
      setChannelApiKey('')
      setChannelMessage('已清除。')
    } catch {
      setChannelMessage('这次没能清除，请稍后再试一次。')
    } finally {
      setSavingChannel(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-10 py-12">
      <p className="mb-2 text-sm font-medium text-primary">应用</p>
      <h1 className="text-3xl font-semibold tracking-tight">设置</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">日常使用不需要维护技术配置。</p>

      <section className="mt-10 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <h2 className="font-medium">本地数据</h2>
            <p className="mt-1 text-sm text-muted-foreground">学校数据保存在这台电脑上</p>
          </div>
          <span className="inline-flex items-center gap-2 text-sm text-primary">
            <CheckCircle2 className="size-4" />
            正常
          </span>
        </div>
        <Separator />
        <div className="px-6 py-5">
          <h2 className="font-medium">默认 AI 助手</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            日常工作里不会再问你用哪一个。新的分析由它来做，工作台自己不下判断。
          </p>

          {assistant === null ? (
            <p className="mt-4 text-sm text-muted-foreground">正在读取…</p>
          ) : (
            <div className="mt-4 space-y-2" role="radiogroup" aria-label="默认 AI 助手">
              {assistant.options.map((option) => {
                const selected = assistant.selected === option.key
                const unavailable = option.availability === 'unavailable'
                return (
                  <label
                    key={option.key}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-muted"
                  >
                    <input
                      type="radio"
                      name="default-assistant"
                      className="mt-1 accent-primary"
                      checked={selected}
                      disabled={saving}
                      onChange={() => void choose(option.key)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{option.label}</span>
                      {unavailable && option.detail ? (
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {option.detail}
                        </span>
                      ) : null}
                      {!unavailable ? (
                        <span className="mt-1 block text-sm text-muted-foreground">
                          你在工作台说的每一条情况都会先交给它看一遍。
                        </span>
                      ) : null}
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          {assistant && assistant.options.every((option) => option.availability !== 'ready') ? (
            <p className="mt-3 text-sm text-muted-foreground">
              在它准备好之前，已经记录下来的学校、判断和状态都还能照常查看，只是不能开始新的分析。
            </p>
          ) : null}

          <div className="mt-5 rounded-lg border border-border px-4 py-4">
            <p className="text-sm font-medium">想确认它现在真的能用？</p>
            <p className="mt-1 text-sm text-muted-foreground">
              连接测试会真的让 AI
              助手回答一个无关紧要的问题，看看它这会儿通不通。测试不会用到任何学校的资料，也不会留下任何记录。可能要等上一会儿。
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              disabled={checking}
              onClick={() => void runConnectionCheck()}
            >
              {checking ? '正在测试…' : '运行连接测试'}
            </Button>
            {checkResult ? (
              <Alert
                variant={checkResult.state === 'ok' ? 'quiet' : 'destructive'}
                className="mt-4"
              >
                <AlertTitle>{checkResult.headline}</AlertTitle>
                <AlertDescription>
                  <span className="block">{checkResult.detail}</span>
                  <span className="mt-2 block text-xs">
                    这次测试用了 {checkResult.durationSeconds} 秒。
                  </span>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          {error ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="px-6 py-5">
          <h2 className="font-medium">AI 模型连接</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            「工作台自带助手」用这个连接去问模型。选 Codex
            的话这里可以不填。密钥由这台电脑的系统钥匙串保管，工作台不会把它显示出来，也不会写进日志。
          </p>
          {assistant === null ? (
            <p className="mt-4 text-sm text-muted-foreground">正在读取…</p>
          ) : (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">{assistant.modelChannel.detail}</p>
              <label className="block">
                <span className="block text-sm font-medium">模型地址</span>
                <Input
                  className="mt-1"
                  value={channelBaseUrl}
                  placeholder="https://…"
                  aria-label="模型地址"
                  onChange={(event) => setChannelBaseUrl(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium">模型名称</span>
                <Input
                  className="mt-1"
                  value={channelModel}
                  aria-label="模型名称"
                  onChange={(event) => setChannelModel(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium">密钥</span>
                <Input
                  className="mt-1"
                  type="password"
                  value={channelApiKey}
                  aria-label="密钥"
                  placeholder={
                    assistant.modelChannel.hasApiKey ? '已保存，要换的话在这里填新的' : ''
                  }
                  onChange={(event) => setChannelApiKey(event.target.value)}
                />
              </label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  disabled={savingChannel || !assistant.modelChannel.secretStorageAvailable}
                  onClick={() => void saveModelChannel()}
                >
                  {savingChannel ? '正在保存…' : '保存'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={savingChannel}
                  onClick={() => void clearModelChannel()}
                >
                  清除
                </Button>
              </div>
              {channelMessage ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {channelMessage}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="px-6 py-5">
          <h2 className="font-medium">本机工具状态</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            这里只检查工具是否已安装，不会读取你的登录信息或飞书内容。
          </p>
          {assistant === null ? (
            <p className="mt-4 text-sm text-muted-foreground">正在检查…</p>
          ) : (
            <div className="mt-4 divide-y divide-border rounded-lg border border-border">
              {assistant.localTools.map((tool) => {
                const available = tool.availability === 'available'
                return (
                  <div key={tool.key} className="flex items-start justify-between gap-4 px-4 py-3">
                    <span>
                      <span className="block text-sm font-medium">{tool.label}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {tool.detail}
                      </span>
                    </span>
                    <span
                      className={
                        available
                          ? 'inline-flex shrink-0 items-center gap-2 text-sm text-primary'
                          : 'inline-flex shrink-0 items-center gap-2 text-sm text-muted-foreground'
                      }
                    >
                      {available ? (
                        <CheckCircle2 className="size-4" />
                      ) : (
                        <CircleAlert className="size-4" />
                      )}
                      {available ? '已检测到' : '未检测到'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="px-6 py-5">
          <h2 className="font-medium">版本信息</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            这里只是告诉你装的是哪个版本。版本不影响工作台怎么运行，也不会因为版本不同就不让你用。
          </p>
          {assistant === null ? (
            <p className="mt-4 text-sm text-muted-foreground">正在读取…</p>
          ) : (
            <div className="mt-4 divide-y divide-border rounded-lg border border-border">
              {assistant.runtimeVersions.map((item) => (
                <div key={item.key} className="flex items-start justify-between gap-4 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.label}</span>
                    {item.note ? (
                      <span className="mt-1 block text-sm text-muted-foreground">{item.note}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {item.version ?? '未知'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <details className="mt-6 rounded-xl border border-border bg-surface px-6 py-5">
        <summary className="cursor-pointer text-sm font-medium">高级设置</summary>
        <div className="mt-4">
          <Link
            to="/settings/methodology-review"
            className="flex items-center justify-between gap-4 rounded-lg px-3 py-3 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>
              <span className="block font-medium">方法论内容审核</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                逐条确认这些判断标准是否可以用来约束正式判断
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </div>
      </details>

      <Alert variant="quiet" className="mt-6">
        <AlertTitle>你的判断说了算</AlertTitle>
        <AlertDescription>
          无论是工作台还是 AI 助手整理出来的判断，都要你确认之后才会进入这所学校的正式记录。
        </AlertDescription>
      </Alert>
    </div>
  )
}
