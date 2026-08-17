import { Alert, AlertDescription, AlertTitle, Separator } from '@school-workbench/experience'
import type { AssistantChoice, AssistantSettingsView } from '@school-workbench/shared'
import { CheckCircle2, ChevronRight, CircleDashed } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWorkbenchApi } from '../../lib/workbench-api'

export function SettingsPage(): React.JSX.Element {
  const api = useWorkbenchApi()
  const [assistant, setAssistant] = useState<AssistantSettingsView | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void api.settings
      .getAssistant()
      .then((result) => {
        if (current) setAssistant(result)
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
            选好以后，日常工作里不会再问你用哪一个。
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
                      {option.key === 'codex' && !unavailable ? (
                        <span className="mt-1 block text-sm text-muted-foreground">
                          选中后，你在工作台说的每一条情况都会先交给它看一遍。
                        </span>
                      ) : null}
                      {option.key === 'none' ? (
                        <span className="mt-1 block text-sm text-muted-foreground">
                          工作台照常记录你说的情况，只是不再等 AI。
                        </span>
                      ) : null}
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          {assistant && assistant.selected === 'none' ? (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
              <CircleDashed className="size-4" />
              目前没有使用 AI 助手
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
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
