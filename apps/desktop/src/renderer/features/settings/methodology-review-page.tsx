import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Skeleton,
  Textarea,
} from '@school-workbench/experience'
import type {
  PackCriterionReviewView,
  PackReviewView,
  PackReviewVerdictValue,
  PackReviewWorkbenchView,
} from '@school-workbench/shared'
import { ArrowLeft, CheckCircle2, CircleAlert, CircleDashed } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWorkbenchApi } from '../../lib/workbench-api'

type VerdictDraft = Readonly<{
  verdict?: PackReviewVerdictValue
  note: string
}>

type PackDraft = Readonly<{
  note: string
  verdicts: Readonly<Record<string, VerdictDraft>>
}>

const emptyDraft: PackDraft = { note: '', verdicts: {} }

function List({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="font-medium text-foreground">{title}</p>
      {items.map((item) => (
        <p key={item}>· {item}</p>
      ))}
    </div>
  )
}

function LocatorText({ locator }: { locator: PackCriterionReviewView['sourceLocator'] }) {
  const parts = [locator.label, locator.chapter, locator.printedPages, locator.figure].filter(
    (part): part is string => Boolean(part),
  )
  return <span>{parts.join(' · ')}</span>
}

function CriterionCard({
  packKey,
  criterion,
  draft,
  onVerdict,
  onNote,
}: {
  packKey: string
  criterion: PackCriterionReviewView
  draft: VerdictDraft
  onVerdict: (verdict: PackReviewVerdictValue) => void
  onNote: (note: string) => void
}) {
  const groupName = `${packKey}:${criterion.stableKey}`
  return (
    <article className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold">{criterion.title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{criterion.description}</p>
        </div>
        {criterion.lastVerdict ? (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            上次：{criterion.lastVerdict.verdict === 'usable' ? '可以用于判断' : '需要修订'}
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        属于「{criterion.constructTitle}」 · 出处 <LocatorText locator={criterion.sourceLocator} />
      </p>

      {criterion.gaps.length > 0 ? (
        <div className="mt-4 rounded-lg bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">这一条目前还缺什么</p>
          {criterion.gaps.map((gap) => (
            <p key={gap}>· {gap}</p>
          ))}
        </div>
      ) : null}

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer font-medium">看完整内容</summary>
        <div className="mt-3 space-y-3 leading-6 text-muted-foreground">
          <p>这条标准要回答：{criterion.assessmentQuestion}</p>
          <List title="适用于" items={criterion.appliesTo} />
          <List title="不适用于" items={criterion.doesNotApplyTo} />
          <List title="补充说明" items={criterion.applicabilityNotes} />
          <List title="支持性表现" items={criterion.supportingIndicators} />
          <List title="相反表现" items={criterion.counterIndicators} />
          <List title="证据不足的情况" items={criterion.insufficientEvidence} />
          <List title="反例核查" items={criterion.counterexampleChecks} />
          <List title="证据收集原则" items={criterion.collectionPrinciples} />
          <List title="需要调整判断的情况" items={criterion.adjustmentConditions} />
          <List title="这条标准上的额外约束" items={criterion.guardrails} />
        </div>
      </details>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">{criterion.title}：这条可以用来判断吗？</legend>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={groupName}
              value="usable"
              checked={draft.verdict === 'usable'}
              onChange={() => onVerdict('usable')}
            />
            可以用于判断
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={groupName}
              value="needs_revision"
              checked={draft.verdict === 'needs_revision'}
              onChange={() => onVerdict('needs_revision')}
            />
            需要修订
          </label>
        </div>
        <label className="mt-3 block text-sm">
          <span className="text-muted-foreground">未决意见（可不填）</span>
          <Textarea
            className="mt-1"
            rows={2}
            value={draft.note}
            aria-label={`${criterion.title}的未决意见`}
            onChange={(event) => onNote(event.target.value)}
          />
        </label>
      </fieldset>
    </article>
  )
}

function PackSection({
  pack,
  draft,
  submitting,
  onChange,
  onSubmit,
}: {
  pack: PackReviewView
  draft: PackDraft
  submitting: boolean
  onChange: (next: PackDraft) => void
  onSubmit: () => void
}) {
  const decided = pack.criteria.filter(
    (criterion) => draft.verdicts[criterion.stableKey]?.verdict,
  ).length
  const complete = decided === pack.criteria.length

  return (
    <section className="mt-8 rounded-xl border border-border bg-surface">
      <header className="border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{pack.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {pack.sourceLabel} · 共 {pack.criteria.length} 条判断标准
            </p>
          </div>
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            {pack.inUse ? (
              <CheckCircle2 className="size-4 text-primary" />
            ) : (
              <CircleDashed className="size-4" />
            )}
            {pack.statusLabel}
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{pack.statusDetail}</p>

        {pack.review ? (
          <div className="mt-4 rounded-lg bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
            <p className="font-medium text-foreground">
              上次结论：{pack.review.decisionLabel}
              {pack.review.outdated ? '（已失效）' : ''}
            </p>
            <p>
              可以用于判断 {pack.review.usableCount} 条 · 需要修订 {pack.review.needsRevisionCount}{' '}
              条
            </p>
            {pack.review.note ? <p>未决意见：{pack.review.note}</p> : null}
          </div>
        ) : null}
      </header>

      <div className="px-6 py-5">
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">这份内容想回答的问题</summary>
          <div className="mt-3 space-y-3 leading-6 text-muted-foreground">
            {pack.constructs.map((construct) => (
              <div key={construct.stableKey}>
                <p className="font-medium text-foreground">{construct.title}</p>
                <p>{construct.assessmentQuestion}</p>
                <p className="text-xs">
                  出处 <LocatorText locator={construct.sourceLocator} />
                </p>
              </div>
            ))}
          </div>
        </details>

        {pack.packGuardrails.length > 0 ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium">这份内容对判断过程的共同约束</summary>
            <div className="mt-3 space-y-1 leading-6 text-muted-foreground">
              {pack.packGuardrails.map((statement) => (
                <p key={statement}>· {statement}</p>
              ))}
            </div>
          </details>
        ) : null}

        <div className="mt-5 space-y-3">
          {pack.criteria.map((criterion) => (
            <CriterionCard
              key={criterion.stableKey}
              packKey={pack.key}
              criterion={criterion}
              draft={draft.verdicts[criterion.stableKey] ?? { note: '' }}
              onVerdict={(verdict) =>
                onChange({
                  ...draft,
                  verdicts: {
                    ...draft.verdicts,
                    [criterion.stableKey]: {
                      verdict,
                      note: draft.verdicts[criterion.stableKey]?.note ?? '',
                    },
                  },
                })
              }
              onNote={(note) =>
                onChange({
                  ...draft,
                  verdicts: {
                    ...draft.verdicts,
                    [criterion.stableKey]: {
                      ...(draft.verdicts[criterion.stableKey] ?? {}),
                      note,
                    },
                  },
                })
              }
            />
          ))}
        </div>

        <label className="mt-5 block text-sm">
          <span className="font-medium">这份内容整体上还有什么未决意见？（可不填）</span>
          <Textarea
            className="mt-2"
            rows={3}
            value={draft.note}
            aria-label={`${pack.title}的未决意见`}
            onChange={(event) => onChange({ ...draft, note: event.target.value })}
          />
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="button" disabled={!complete || submitting} onClick={onSubmit}>
            提交审核结论
          </Button>
          <span className="text-sm text-muted-foreground">
            {complete
              ? '提交后会记录你对每一条的结论。'
              : `还有 ${pack.criteria.length - decided} 条没有给出结论。`}
          </span>
        </div>

        <details className="mt-6 text-sm">
          <summary className="cursor-pointer font-medium text-muted-foreground">
            更技术的信息
          </summary>
          <div className="mt-3 space-y-1 leading-6 text-muted-foreground">
            <p>标识：{pack.technical.packId}</p>
            <p>原始来源：{pack.technical.sourceRef}</p>
            <p>来源指纹：{pack.technical.sourceFingerprint}</p>
            <p>内容哈希：{pack.technical.contentHash}</p>
            <p>已审核内容哈希：{pack.technical.reviewedContentHash ?? '（还没有审核记录）'}</p>
            <p>
              文件状态：{pack.technical.fileStatus} · 本地库状态：
              {pack.technical.storedStatus ?? '（尚未写入）'}
            </p>
            <p>
              审核通过后，在仓库里执行 pnpm methodology:activate --pack {pack.key} --version{' '}
              {pack.version} --apply 才会真正启用。
            </p>
          </div>
        </details>
      </div>
    </section>
  )
}

export function MethodologyReviewPage(): React.JSX.Element {
  const api = useWorkbenchApi()
  const [workbench, setWorkbench] = useState<PackReviewWorkbenchView | null>(null)
  const [drafts, setDrafts] = useState<Record<string, PackDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void api.methodology
      .getReviewWorkbench()
      .then((result) => {
        if (current) setWorkbench(result)
      })
      .catch(() => {
        if (current) setError('暂时读不到方法论内容。请重新打开应用后再试。')
      })
    return () => {
      current = false
    }
  }, [api])

  async function submit(pack: PackReviewView, draft: PackDraft): Promise<void> {
    setSubmitting(pack.key)
    setError(null)
    try {
      const result = await api.methodology.signOff({
        packKey: pack.key,
        packVersion: pack.version,
        note: draft.note.trim() ? draft.note.trim() : null,
        verdicts: pack.criteria.map((criterion) => {
          const entry = draft.verdicts[criterion.stableKey]
          if (!entry?.verdict) throw new Error('missing verdict')
          return {
            criterionStableKey: criterion.stableKey,
            verdict: entry.verdict,
            note: entry.note.trim() ? entry.note.trim() : null,
          }
        }),
      })
      setWorkbench(result)
      setDrafts((current) => ({ ...current, [pack.key]: emptyDraft }))
    } catch {
      setError('这次审核结论没有保存成功。请检查每条结论后再试一次。')
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-10 py-12">
      <Link
        to="/settings"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        设置
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">方法论内容审核</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        这些判断标准是从已出版的方法论整理出来的。只有你逐条确认过，它们才会用来约束正式判断。
      </p>

      {error ? (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>没有保存成功</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!workbench && !error ? (
        <div className="mt-8 grid gap-3" aria-label="正在读取方法论内容">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : null}

      {workbench?.state === 'unavailable' ? (
        <Alert variant="quiet" className="mt-8">
          <CircleAlert className="size-4" />
          <AlertTitle>暂时看不到方法论内容</AlertTitle>
          <AlertDescription>{workbench.message}</AlertDescription>
        </Alert>
      ) : null}

      {workbench?.state === 'ready'
        ? workbench.packs.map((pack) => (
            <PackSection
              key={`${pack.key}@${pack.version}`}
              pack={pack}
              draft={drafts[pack.key] ?? emptyDraft}
              submitting={submitting === pack.key}
              onChange={(next) => setDrafts((current) => ({ ...current, [pack.key]: next }))}
              onSubmit={() => void submit(pack, drafts[pack.key] ?? emptyDraft)}
            />
          ))
        : null}
    </div>
  )
}
