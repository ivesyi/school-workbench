import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Skeleton,
  Textarea,
} from '@school-workbench/experience'
import type {
  AcceptedJudgmentView,
  JudgmentReviewView,
  ReviewDiagnosisInput,
  SchoolView,
  StageWorkspaceView,
} from '@school-workbench/shared'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useWorkbenchApi } from '../../lib/workbench-api'

export function SchoolWorkspacePage(): React.JSX.Element {
  const { schoolId = '' } = useParams()
  const api = useWorkbenchApi()
  const [school, setSchool] = useState<SchoolView | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [proposal, setProposal] = useState<JudgmentReviewView | null>(null)
  const [accepted, setAccepted] = useState<AcceptedJudgmentView[]>([])
  const [editing, setEditing] = useState(false)
  const [editedJudgment, setEditedJudgment] = useState('')
  const [stageWorkspace, setStageWorkspace] = useState<StageWorkspaceView>({ state: 'none' })
  const [stageFeedbackOpen, setStageFeedbackOpen] = useState(false)
  const [stageFeedback, setStageFeedback] = useState('')
  const [stageSubmitting, setStageSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stageError, setStageError] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void Promise.all([
      api.schools.get(schoolId),
      api.judgments.listAccepted(schoolId).catch(() => []),
    ])
      .then(([schoolResult, acceptedResult]) => {
        if (!current) return
        setSchool(schoolResult)
        setAccepted(acceptedResult)
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : '读取学校时遇到问题')
      })
      .finally(() => {
        if (current) setLoading(false)
      })

    void api.stages
      .getWorkspace(schoolId)
      .then((result) => {
        if (current) setStageWorkspace(result)
      })
      .catch((reason: unknown) => {
        if (current) {
          setStageError(reason instanceof Error ? reason.message : '暂时没能整理当前阶段')
        }
      })

    return () => {
      current = false
    }
  }, [api, schoolId])

  async function refreshStage(): Promise<void> {
    try {
      setStageError(null)
      setStageWorkspace(await api.stages.getWorkspace(schoolId))
    } catch (reason) {
      setStageError(reason instanceof Error ? reason.message : '暂时没能整理当前阶段')
    }
  }

  async function submitSituation(): Promise<void> {
    if (!message.trim()) return
    setSubmitting(true)
    setError(null)
    setResultMessage(null)
    try {
      const result = await api.judgments.submitSituation({ schoolId, text: message })
      setProposal(result)
      setEditedJudgment(result.proposal.provisionalJudgment)
      setEditing(false)
      setMessage('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时没能整理这条情况')
    } finally {
      setSubmitting(false)
    }
  }

  async function review(decision: ReviewDiagnosisInput['decision']): Promise<void> {
    if (!proposal) return
    setReviewing(true)
    setError(null)
    try {
      const input: ReviewDiagnosisInput = {
        schoolId,
        diagnosisId: proposal.proposal.id,
        decision,
        ...(decision === 'modified' ? { finalText: editedJudgment } : {}),
      }
      const outcome = await api.judgments.review(input)

      if (outcome.acceptedJudgment) {
        const acceptedJudgment = outcome.acceptedJudgment
        setAccepted((items) => [acceptedJudgment, ...items])
        setResultMessage(
          decision === 'modified' ? '已经按你的修改记录这条判断。' : '已经记录这条判断。',
        )
        await refreshStage()
      } else if (decision === 'needs_more_evidence') {
        setResultMessage('已记下：先补充更多依据，这条判断暂不进入正式记录。')
      } else {
        setResultMessage('已记下你的意见，这条判断没有进入正式记录。')
      }

      setProposal(null)
      setEditing(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '确认判断时遇到问题')
    } finally {
      setReviewing(false)
    }
  }

  async function adjustStage(): Promise<void> {
    if (stageWorkspace.state !== 'suggested' || !stageFeedback.trim()) return
    setStageSubmitting(true)
    setStageError(null)
    try {
      const result = await api.stages.adjust({
        schoolId,
        stageId: stageWorkspace.stage.id,
        feedback: stageFeedback,
      })
      setStageWorkspace(result)
      setStageFeedback('')
      setStageFeedbackOpen(false)
    } catch (reason) {
      setStageError(reason instanceof Error ? reason.message : '暂时没能重新整理阶段建议')
    } finally {
      setStageSubmitting(false)
    }
  }

  async function confirmStage(): Promise<void> {
    if (stageWorkspace.state !== 'suggested') return
    setStageSubmitting(true)
    setStageError(null)
    try {
      const result = await api.stages.confirm({ schoolId, stageId: stageWorkspace.stage.id })
      setStageWorkspace(result)
      setStageFeedbackOpen(false)
      setResultMessage('已经把这个阶段记下来了。之后会围绕这个阶段持续看变化。')
    } catch (reason) {
      setStageError(reason instanceof Error ? reason.message : '确认当前阶段时遇到问题')
    } finally {
      setStageSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-10 py-12">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-10 h-48 w-full" />
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
        <p className="mb-2 text-sm font-medium text-primary">工作台</p>
        <h1 className="text-3xl font-semibold tracking-tight">{school.name}</h1>
      </header>

      <section className="mt-10 rounded-xl border border-border bg-surface p-7">
        <h2 className="text-lg font-semibold">今天有什么新的情况？</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          直接说发生了什么。系统会先整理成一条待确认判断，只有你确认后才进入正式记录。
        </p>
        <Textarea
          className="mt-5"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="例如：今天的中层会议里，任务拆解还是主要由校长完成……"
        />
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            disabled={submitting || message.trim().length === 0}
            onClick={() => void submitSituation()}
          >
            {submitting ? '正在整理…' : '提交情况'}
          </Button>
        </div>
      </section>

      {error ? (
        <Alert variant="destructive" className="mt-5">
          <AlertTitle>这一步没有完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {stageError ? (
        <Alert variant="destructive" className="mt-5">
          <AlertTitle>阶段建议暂时没有更新</AlertTitle>
          <AlertDescription>{stageError}</AlertDescription>
        </Alert>
      ) : null}

      {resultMessage ? (
        <Alert variant="quiet" className="mt-5">
          <CheckCircle2 className="size-4" />
          <AlertTitle>已处理</AlertTitle>
          <AlertDescription>{resultMessage}</AlertDescription>
        </Alert>
      ) : null}

      {proposal ? (
        <section className="mt-6 rounded-xl border border-border bg-surface p-7">
          <p className="text-sm font-medium text-primary">我发现一个新的情况，想让你确认</p>
          <h2 className="mt-2 text-xl font-semibold">{proposal.proposal.provisionalJudgment}</h2>
          <p className="mt-4 text-sm text-muted-foreground">
            依据 {proposal.proposal.evidenceCount} 条 · 当前还需要更多观察
          </p>

          <details className="mt-5 rounded-lg border border-border px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">为什么这样判断？</summary>
            <div className="mt-4 space-y-4 leading-6 text-muted-foreground">
              <div>
                <p className="font-medium text-foreground">看到的事实</p>
                {proposal.facts.map((fact) => (
                  <p key={fact.id}>{fact.text}</p>
                ))}
              </div>
              <div>
                <p className="font-medium text-foreground">暂时的解释</p>
                {proposal.proposal.interpretations.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
              {proposal.proposal.alternativeHypotheses.length > 0 ? (
                <div>
                  <p className="font-medium text-foreground">也可能是</p>
                  {proposal.proposal.alternativeHypotheses.map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>
              ) : null}
              {proposal.proposal.unresolvedQuestions.length > 0 ? (
                <div>
                  <p className="font-medium text-foreground">还不知道</p>
                  {proposal.proposal.unresolvedQuestions.map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>
              ) : null}
              {proposal.proposal.recommendedObservations.length > 0 ? (
                <div>
                  <p className="font-medium text-foreground">下一步值得看</p>
                  {proposal.proposal.recommendedObservations.map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>
              ) : null}
            </div>
          </details>

          {editing ? (
            <div className="mt-5">
              <p className="mb-2 text-sm font-medium">改成你的判断</p>
              <Textarea
                value={editedJudgment}
                onChange={(event) => setEditedJudgment(event.target.value)}
              />
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <Button type="button" disabled={reviewing} onClick={() => void review('accepted')}>
              认同
            </Button>
            {editing ? (
              <Button
                type="button"
                variant="secondary"
                disabled={reviewing || editedJudgment.trim().length === 0}
                onClick={() => void review('modified')}
              >
                确认修改
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={reviewing}
                onClick={() => setEditing(true)}
              >
                我想改一下
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={reviewing}
              onClick={() => void review('needs_more_evidence')}
            >
              先补充更多依据
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={reviewing}
              onClick={() => void review('rejected')}
            >
              不认同
            </Button>
          </div>
        </section>
      ) : null}

      {stageWorkspace.state === 'suggested' ? (
        <section className="mt-6 rounded-xl border border-border bg-surface p-7">
          <p className="text-sm font-medium text-primary">根据目前已经确认的判断</p>
          <h2 className="mt-2 text-xl font-semibold">{stageWorkspace.stage.summary}</h2>
          <p className="mt-4 leading-7 text-muted-foreground">{stageWorkspace.stage.focus}</p>
          <p className="mt-4 text-sm font-medium">这样理解基本对吗？</p>

          <details className="mt-5 rounded-lg border border-border px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">这个阶段我会重点看什么</summary>
            <div className="mt-4 space-y-3">
              {stageWorkspace.stage.targets.map((target) => (
                <div key={target.id}>
                  <p className="font-medium text-foreground">{target.label}</p>
                  <p className="mt-1 leading-6 text-muted-foreground">{target.text}</p>
                </div>
              ))}
            </div>
          </details>

          {stageFeedbackOpen ? (
            <div className="mt-5 rounded-lg bg-muted/40 p-4">
              <label className="text-sm font-medium" htmlFor="stage-feedback">
                哪里需要调整？
              </label>
              <Textarea
                id="stage-feedback"
                className="mt-2"
                value={stageFeedback}
                onChange={(event) => setStageFeedback(event.target.value)}
                placeholder="例如：现在中层其实已经能独立推进，只是校长还没有真正放手……"
              />
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={stageSubmitting || stageFeedback.trim().length === 0}
                  onClick={() => void adjustStage()}
                >
                  {stageSubmitting ? '正在重新整理…' : '重新整理建议'}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex gap-3">
            <Button type="button" disabled={stageSubmitting} onClick={() => void confirmStage()}>
              基本对
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={stageSubmitting}
              onClick={() => setStageFeedbackOpen((value) => !value)}
            >
              调整一下
            </Button>
          </div>
        </section>
      ) : null}

      {stageWorkspace.state === 'active' ? (
        <section className="mt-6 rounded-xl border border-border bg-surface px-6 py-5">
          <p className="text-xs font-medium text-muted-foreground">当前阶段</p>
          <h2 className="mt-2 text-lg font-semibold">{stageWorkspace.stage.title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {stageWorkspace.stage.focus}
          </p>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-medium">这个阶段重点看什么</summary>
            <div className="mt-3 space-y-2 text-muted-foreground">
              {stageWorkspace.stage.targets.map((target) => (
                <p key={target.id}>
                  <span className="font-medium text-foreground">{target.label}：</span>
                  {target.text}
                </p>
              ))}
            </div>
          </details>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">已经确认的判断</h2>
        {accepted.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            还没有正式判断。先从上面说一条最近发生的情况开始。
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {accepted.map((item) => (
              <div key={item.id} className="rounded-xl border border-border bg-surface px-5 py-4">
                <p className="leading-7">{item.text}</p>
                <p className="mt-2 text-xs text-muted-foreground">已由你确认</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
