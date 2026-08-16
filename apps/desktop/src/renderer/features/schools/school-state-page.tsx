import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Skeleton,
  Textarea,
} from '@school-workbench/experience'
import type { SchoolView, StateOverviewView, StateWorkspaceView } from '@school-workbench/shared'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useWorkbenchApi } from '../../lib/workbench-api'

function StateOverview({ overview, baseline }: { overview: StateOverviewView; baseline: boolean }) {
  return (
    <>
      <section className="mt-6 rounded-xl border border-border bg-surface px-6 py-5">
        <p className="text-xs font-medium text-muted-foreground">当前阶段</p>
        <h2 className="mt-2 text-lg font-semibold">{overview.stage.title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{overview.stage.focus}</p>
      </section>

      <section className="mt-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-primary">
              {baseline ? '起点状态' : '现在的状态'}
            </p>
            <h2 className="mt-2 text-xl font-semibold">{overview.summary}</h2>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {overview.dimensions.map((dimension) => (
            <article
              key={dimension.dimensionKey}
              className="rounded-xl border border-border bg-surface p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold">{dimension.label}</h3>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  {dimension.statusLabel}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{dimension.summary}</p>
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-medium">为什么这样整理？</summary>
                <div className="mt-3 space-y-3 leading-6 text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground">这个阶段希望看到</p>
                    <p>{dimension.target}</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">目前依据</p>
                    {dimension.basis.length > 0 ? (
                      dimension.basis.map((item) => <p key={item}>· {item}</p>)
                    ) : (
                      <p>目前还没有足够的正式判断支持达到程度。</p>
                    )}
                  </div>
                </div>
              </details>
            </article>
          ))}
        </div>

        {overview.limitations.length > 0 ? (
          <div className="mt-5 rounded-xl bg-muted/40 px-5 py-4 text-sm leading-6 text-muted-foreground">
            <p className="font-medium text-foreground">还需要留意</p>
            {overview.limitations.map((item) => (
              <p key={item} className="mt-1">
                {item}
              </p>
            ))}
          </div>
        ) : null}
      </section>
    </>
  )
}

export function SchoolStatePage(): React.JSX.Element {
  const { schoolId = '' } = useParams()
  const api = useWorkbenchApi()
  const [school, setSchool] = useState<SchoolView | null>(null)
  const [workspace, setWorkspace] = useState<StateWorkspaceView | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmedMessage, setConfirmedMessage] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void Promise.all([api.schools.get(schoolId), api.states.getWorkspace(schoolId)])
      .then(([schoolResult, stateResult]) => {
        if (!current) return
        setSchool(schoolResult)
        setWorkspace(stateResult)
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : '读取学校状态时遇到问题')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [api, schoolId])

  async function adjustState(): Promise<void> {
    if (workspace?.state !== 'draft' || !feedback.trim()) return
    setSubmitting(true)
    setError(null)
    setConfirmedMessage(null)
    try {
      const result = await api.states.adjust({ schoolId, feedback })
      setWorkspace(result)
      setFeedback('')
      setFeedbackOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时没能重新整理当前状态')
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmState(): Promise<void> {
    if (workspace?.state !== 'draft') return
    setSubmitting(true)
    setError(null)
    try {
      const result = await api.states.confirm({ schoolId })
      setWorkspace(result)
      setFeedbackOpen(false)
      setConfirmedMessage('已经记录这所学校当前的起点状态。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '确认当前状态时遇到问题')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-10 py-12">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-10 h-64 w-full" />
      </div>
    )
  }

  if (!school) {
    return (
      <div className="mx-auto w-full max-w-3xl px-10 py-12">
        <Alert variant="destructive">
          <AlertTitle>没有找到这所学校</AlertTitle>
          <AlertDescription>它可能已经被移除，或者当前链接已经失效。</AlertDescription>
        </Alert>
        <Button asChild variant="secondary" className="mt-6">
          <Link to="/">返回学校</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-10 py-10">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        所有学校
      </Link>

      <header className="mt-7">
        <h1 className="text-3xl font-semibold tracking-tight">{school.name}</h1>
        <nav className="mt-5 flex gap-5 text-sm" aria-label="学校内导航">
          <Link to={`/schools/${schoolId}`} className="text-muted-foreground hover:text-foreground">
            工作台
          </Link>
          <span className="font-medium text-foreground">学校状态</span>
        </nav>
      </header>

      {error ? (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>这一步没有完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {confirmedMessage ? (
        <Alert variant="quiet" className="mt-6">
          <CheckCircle2 className="size-4" />
          <AlertTitle>已记录</AlertTitle>
          <AlertDescription>{confirmedMessage}</AlertDescription>
        </Alert>
      ) : null}

      {workspace?.state === 'needs_stage' ? (
        <section className="mt-8 rounded-xl border border-border bg-surface p-7">
          <h2 className="text-lg font-semibold">还没有可以用来判断状态的当前阶段</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            先回到工作台确认这所学校现在处于哪个阶段，之后这里会按这个阶段整理当前状态。
          </p>
          <Button asChild variant="secondary" className="mt-5">
            <Link to={`/schools/${schoolId}`}>回工作台确认阶段</Link>
          </Button>
        </section>
      ) : null}

      {workspace?.state === 'needs_judgments' ? (
        <section className="mt-8 rounded-xl border border-border bg-surface p-7">
          <p className="text-sm font-medium text-primary">当前阶段 · {workspace.stageTitle}</p>
          <h2 className="mt-2 text-lg font-semibold">还需要先确认一些真实情况</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            目前还没有正式判断可以支撑学校状态。先回工作台说一条最近发生的情况并确认判断。
          </p>
          <Button asChild variant="secondary" className="mt-5">
            <Link to={`/schools/${schoolId}`}>回工作台补充情况</Link>
          </Button>
        </section>
      ) : null}

      {workspace?.state === 'draft' ? (
        <>
          <StateOverview overview={workspace.overview} baseline={false} />
          <section className="mt-6 rounded-xl border border-border bg-surface p-6">
            <p className="text-sm leading-6 text-muted-foreground">
              这还只是待你确认的整理。你确认之前，不会成为这所学校的正式状态记录。
            </p>

            {feedbackOpen ? (
              <div className="mt-5 rounded-lg bg-muted/40 p-4">
                <label className="text-sm font-medium" htmlFor="state-feedback">
                  哪里需要调整？
                </label>
                <Textarea
                  id="state-feedback"
                  className="mt-2"
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="例如：领导力这部分先别判断，还需要更多观察……"
                />
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={submitting || feedback.trim().length === 0}
                    onClick={() => void adjustState()}
                  >
                    {submitting ? '正在重新整理…' : '重新整理当前状态'}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-3">
              <Button type="button" disabled={submitting} onClick={() => void confirmState()}>
                确认现在的状态
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                onClick={() => setFeedbackOpen((value) => !value)}
              >
                我想调整
              </Button>
            </div>
          </section>
        </>
      ) : null}

      {workspace?.state === 'baseline' ? (
        <>
          <StateOverview overview={workspace.overview} baseline />
          <p className="mt-5 text-sm text-muted-foreground">
            这是你确认过的起点状态。后面有新的变化时，再继续补充。
          </p>
        </>
      ) : null}
    </div>
  )
}
