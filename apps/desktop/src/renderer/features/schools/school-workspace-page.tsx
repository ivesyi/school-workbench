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
  AgentProgressPhase,
  AssistantChoice,
  AssistantSettingsView,
  JudgmentReviewView,
  ReviewDiagnosisInput,
  SchoolView,
  StageWorkspaceView,
} from '@school-workbench/shared'
import { ArrowLeft, CheckCircle2, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useWorkbenchApi } from '../../lib/workbench-api'
import {
  assistantNote,
  canStartAnalysis,
  progressLabel,
  switchableAssistants,
  unavailableReason,
} from './assistant-flow'

type Abstention = Readonly<{
  unresolvedQuestions: readonly string[]
  nextObservations: readonly string[]
}>

function DetailList({
  title,
  items,
}: {
  title: string
  items: readonly string[]
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div>
      <p className="font-medium text-foreground">{title}</p>
      {items.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </div>
  )
}

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
  const [reviewFeedback, setReviewFeedback] = useState('')
  const [stageWorkspace, setStageWorkspace] = useState<StageWorkspaceView>({ state: 'none' })
  const [stageFeedbackOpen, setStageFeedbackOpen] = useState(false)
  const [stageFeedback, setStageFeedback] = useState('')
  const [stageSubmitting, setStageSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stageError, setStageError] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [assistant, setAssistant] = useState<AssistantSettingsView | null>(null)
  const [phase, setPhase] = useState<AgentProgressPhase | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [retryable, setRetryable] = useState(false)
  const [runFailed, setRunFailed] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [abstention, setAbstention] = useState<Abstention | null>(null)

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

    void api.settings
      .getAssistant()
      .then((result) => {
        if (current) setAssistant(result)
      })
      .catch(() => undefined)

    // The four steps PRD 16 allows are pushed while the assistant works; the
    // page only listens for the school it is showing.
    const unsubscribe = api.agent.onProgress((event) => {
      if (event.schoolId === schoolId) setPhase(event.phase)
    })

    return () => {
      current = false
      unsubscribe()
    }
  }, [api, schoolId])

  const assistantAvailable = canStartAnalysis(assistant)
  // Peers, not fallbacks. Empty whenever there is nothing to choose between, so
  // the control below disappears entirely rather than offering a switch to
  // nowhere — which is what happens today, with one assistant integrated.
  const otherAssistants = switchableAssistants(assistant)
  // A school with no current stage still accepts one sentence (PRD 11/51): the
  // assistant reads it and proposes the starting stage. The only thing that
  // blocks a new run is a stage suggestion already waiting for confirmation.
  const stagePending = stageWorkspace.state === 'suggested'
  const analysisAvailable = assistantAvailable && !stagePending
  const blockedReason = !assistantAvailable
    ? unavailableReason(assistant)
    : stagePending
      ? '请先确认或调整上方的阶段建议，再开始新的分析。'
      : null

  async function refreshStage(): Promise<void> {
    try {
      setStageError(null)
      setStageWorkspace(await api.stages.getWorkspace(schoolId))
    } catch (reason) {
      setStageError(reason instanceof Error ? reason.message : '暂时没能整理当前阶段')
    }
  }

  /**
   * One sentence in; whatever the assistant honestly concluded out.
   *
   * There is no second path here. If the assistant does not produce a judgement
   * — because it failed, or because it decided the evidence is not enough — the
   * workbench says so and keeps what was typed so it can be tried again. It
   * never writes a judgement of its own to fill the gap.
   */
  async function submitSituation(): Promise<void> {
    const text = message.trim()
    if (!text || !analysisAvailable) return
    setSubmitting(true)
    setError(null)
    setResultMessage(null)
    setNote(null)
    setRetryable(false)
    setRunFailed(false)
    setAbstention(null)
    setPhase('understanding')

    try {
      const run = await api.agent.run({ schoolId, message: text })
      if (run.proposal) {
        setProposal(run.proposal)
        setEditedJudgment(run.proposal.proposal.provisionalJudgment)
        setReviewFeedback('')
        setEditing(false)
        setMessage('')
        return
      }
      // A run can end without a judgement because the assistant proposed the
      // school's first stage instead (PRD 11). Refresh the workspace so that
      // proposal shows up for confirmation rather than reading as "nothing
      // happened".
      let refreshed: StageWorkspaceView
      try {
        refreshed = await api.stages.getWorkspace(schoolId)
        setStageWorkspace(refreshed)
      } catch {
        refreshed = stageWorkspace
      }
      if (refreshed.state === 'suggested') {
        setResultMessage('AI 助手根据你说的情况，先提议了一个当前阶段。请确认后再继续。')
        setRetryable(false)
        return
      }
      setNote(assistantNote(run))
      setAbstention(run.abstention)
      setRetryable(run.outcome !== 'needs_more_evidence')
      setRunFailed(run.outcome === 'failed')
    } catch {
      setNote('AI 助手这次没能完成。你写的内容还在，可以过一会儿再重试。')
      setRetryable(true)
      setRunFailed(true)
    } finally {
      setPhase(null)
      setSubmitting(false)
    }
  }

  /**
   * Switches to another assistant and runs the same sentence again.
   *
   * Not a fallback and not a route: the workbench never picks the next
   * assistant, never tries one after another and never decides that a failure
   * means a different assistant should be used. A person chooses here, and the
   * choice is saved through exactly the same setting the settings page writes,
   * so the next run uses it too (PRD 15).
   */
  async function switchAssistantAndRetry(next: AssistantChoice): Promise<void> {
    if (submitting || switching) return
    setSwitching(true)
    setError(null)
    try {
      setAssistant(await api.settings.chooseAssistant({ assistant: next }))
    } catch {
      setError('这次没能换成另一个 AI 助手，请再试一次。')
      return
    } finally {
      setSwitching(false)
    }
    // The consultant's words were never cleared, so this is the same sentence.
    await submitSituation()
  }

  async function review(decision: ReviewDiagnosisInput['decision']): Promise<void> {
    if (!proposal) return
    setReviewing(true)
    setError(null)
    try {
      const feedback = reviewFeedback.trim()
      const input: ReviewDiagnosisInput = {
        schoolId,
        diagnosisId: proposal.proposal.id,
        decision,
        ...(feedback ? { feedback } : {}),
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
      setReviewFeedback('')
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
        <h1 className="text-3xl font-semibold tracking-tight">{school.name}</h1>
        <nav className="mt-5 flex gap-5 text-sm" aria-label="学校内导航">
          <span className="font-medium text-foreground">工作台</span>
          <Link
            to={`/schools/${schoolId}/state`}
            className="text-muted-foreground hover:text-foreground"
          >
            学校状态
          </Link>
        </nav>
      </header>

      <section className="mt-10 rounded-xl border border-border bg-surface p-7">
        <h2 className="text-lg font-semibold">今天有什么新的情况？</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          直接说发生了什么。AI
          助手会看过这所学校已有的材料后整理成一条待确认判断，只有你确认后才进入正式记录。
        </p>
        <Textarea
          className="mt-5"
          value={message}
          maxLength={20000}
          disabled={!analysisAvailable}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="例如：今天的中层会议里，任务拆解还是主要由校长完成……"
        />
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {analysisAvailable
              ? 'AI 助手会先看一遍这所学校的情况，可能需要一会儿。'
              : '已经记录下来的学校、判断和状态都还能照常查看。'}
          </p>
          <Button
            type="button"
            disabled={!analysisAvailable || submitting || message.trim().length === 0}
            onClick={() => void submitSituation()}
          >
            {submitting ? '正在整理…' : retryable ? '重试' : '提交情况'}
          </Button>
        </div>
      </section>

      {!analysisAvailable && blockedReason ? (
        <Alert variant="quiet" className="mt-5">
          <AlertTitle>现在还不能开始新的分析</AlertTitle>
          <AlertDescription>{blockedReason}</AlertDescription>
        </Alert>
      ) : null}

      {phase ? (
        <section
          className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-surface px-6 py-5"
          aria-live="polite"
        >
          <Sparkles className="size-4 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">{progressLabel(phase)}</p>
        </section>
      ) : null}

      {note ? (
        <Alert variant="quiet" className="mt-5">
          <AlertTitle>AI 助手</AlertTitle>
          <AlertDescription>
            <span className="block">{note}</span>
            {abstention && abstention.nextObservations.length > 0 ? (
              <span className="mt-3 block">
                <span className="block font-medium text-foreground">下一步值得补充什么</span>
                {abstention.nextObservations.map((item) => (
                  <span key={item} className="block">
                    {item}
                  </span>
                ))}
              </span>
            ) : null}
            {abstention && abstention.unresolvedQuestions.length > 0 ? (
              <span className="mt-3 block">
                <span className="block font-medium text-foreground">目前还不能确定什么</span>
                {abstention.unresolvedQuestions.map((item) => (
                  <span key={item} className="block">
                    {item}
                  </span>
                ))}
              </span>
            ) : null}
            {runFailed && otherAssistants.length > 0 ? (
              <span className="mt-4 block">
                <span className="block font-medium text-foreground">换个助手重试</span>
                <span className="mt-1 block">
                  也可以换一个 AI 助手，用你刚才写的那段话再跑一次。换哪个由你决定。
                </span>
                <span className="mt-3 flex flex-wrap gap-3">
                  {otherAssistants.map((option) => (
                    <Button
                      key={option.key}
                      type="button"
                      variant="secondary"
                      disabled={switching || submitting}
                      onClick={() => void switchAssistantAndRetry(option.key)}
                    >
                      {switching ? '正在切换…' : `换成 ${option.label} 重试`}
                    </Button>
                  ))}
                </span>
              </span>
            ) : null}
            {runFailed ? (
              <span className="mt-3 block text-xs">
                还是不行的话，到
                <Link to="/settings" className="mx-1 underline">
                  设置
                </Link>
                里跑一次「连接测试」，就知道是不是 AI 助手那边的问题。
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

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
          {proposal.grounding.stageTargets.length > 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              这个阶段原本希望：{proposal.grounding.stageTargets[0]?.text}
            </p>
          ) : null}
          <p className="mt-2 text-sm text-muted-foreground">
            依据 {proposal.proposal.evidenceCount} 条
            {proposal.counterFacts.length > 0
              ? ` · 有 ${proposal.counterFacts.length} 条相反迹象`
              : ' · 没有找到与它不一致的记录'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            这条是 AI 助手看过这所学校的情况后整理的，仍然要你确认才算数。
          </p>

          <details className="mt-5 rounded-lg border border-border px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">为什么这样判断？</summary>
            <div className="mt-4 space-y-4 leading-6 text-muted-foreground">
              <div>
                <p className="font-medium text-foreground">我看到的事实</p>
                {proposal.facts.map((fact) => (
                  <p key={fact.id}>{fact.text}</p>
                ))}
              </div>
              <DetailList title="这些事实可能说明什么" items={proposal.proposal.interpretations} />
              <div>
                <p className="font-medium text-foreground">支持这个判断的依据</p>
                {proposal.evidence.map((item) => (
                  <p key={item.id}>
                    {item.title}（{item.sourceLabel}）{item.excerpt ? `：${item.excerpt}` : ''}
                    {item.uri ? (
                      <a className="ml-2 underline" href={item.uri}>
                        查看原文
                      </a>
                    ) : null}
                  </p>
                ))}
              </div>
              <div>
                <p className="font-medium text-foreground">与这个判断不一致的依据</p>
                {proposal.counterFacts.length > 0 ? (
                  proposal.counterFacts.map((fact) => <p key={fact.id}>{fact.text}</p>)
                ) : (
                  <p>已经找过与这条判断相反的记录，这一轮没有找到。</p>
                )}
              </div>
              <DetailList
                title="还有哪些可能的解释"
                items={proposal.proposal.alternativeHypotheses}
              />
              <DetailList
                title="目前还不能确定什么"
                items={proposal.proposal.unresolvedQuestions}
              />
              {proposal.proposal.mechanism ? (
                <div>
                  <p className="font-medium text-foreground">我认为背后的机制</p>
                  <p>{proposal.proposal.mechanism}</p>
                </div>
              ) : null}
              <DetailList
                title="下一轮值得重点观察什么"
                items={proposal.proposal.recommendedObservations}
              />
              <DetailList title="建议采取的行动" items={proposal.proposal.proposedActions} />
              <DetailList
                title="怎么验证这些行动是否起作用"
                items={proposal.proposal.impactMeasures}
              />
              <div>
                <p className="font-medium text-foreground">这条判断的出处</p>
                <p>学校：{proposal.grounding.schoolName}</p>
                <p>阶段：{proposal.grounding.stageTitle}</p>
                {proposal.grounding.stageTargets.map((target) => (
                  <p key={target.id}>
                    本阶段目标 · {target.label}：{target.text}
                  </p>
                ))}
                {proposal.grounding.criteria.map((criterion) => (
                  <p key={criterion.id}>
                    判断标准 · {criterion.title}（{criterion.packTitle} 第 {criterion.packVersion}{' '}
                    版）：{criterion.description}
                  </p>
                ))}
              </div>
            </div>
          </details>

          {editing ? (
            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="review-feedback">
                  你觉得哪里不准确？
                </label>
                <Textarea
                  id="review-feedback"
                  value={reviewFeedback}
                  onChange={(event) => setReviewFeedback(event.target.value)}
                  placeholder="例如：不是中层不会拆，是校长一直没有真正放权。"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="review-final-text">
                  改成你的判断
                </label>
                <Textarea
                  id="review-final-text"
                  value={editedJudgment}
                  onChange={(event) => setEditedJudgment(event.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                原来的这条判断、你写的意见和最终文字都会一起留下来。
              </p>
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
