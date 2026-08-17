import {
  assertPackReviewCoverage,
  derivePackReviewDecision,
  packReviewIsOutdated,
  resolvePackRuntimeStatus,
  type Criterion,
  type EvidenceGuidance,
  type MethodologyPack,
  type MethodologyPackStatusWriter,
  type MethodologyRegistry,
  type MethodologyRepository,
  type MethodologyReviewRepository,
  type PackReviewCriterionVerdict,
  type PackReviewSignOff,
  type SourceLocator,
} from '@school-workbench/methodology'
import {
  packReviewWorkbenchViewSchema,
  signOffPackInputSchema,
  type PackCriterionReviewView,
  type PackLifecycleStatus,
  type PackReviewView,
  type PackReviewWorkbenchView,
  type SignOffPackInput,
} from '@school-workbench/shared'
import { ulid } from 'ulid'

const statusLabels: Readonly<Record<PackLifecycleStatus, string>> = {
  draft: '还在整理',
  review: '按你的要求暂停使用',
  active: '正在使用',
  retired: '已停用',
}

const sourceLabels: Readonly<Record<MethodologyPack['sourceType'], string>> = {
  book: '书籍',
  framework: '框架',
  standard: '标准',
}

const dimensionLabels: Readonly<Record<string, string>> = {
  leadership: '领导力',
  key_tasks: '关键任务',
  structure: '结构与机制',
  culture: '文化',
  capability: '能力',
}

export type MethodologyReviewServiceDependencies = Readonly<{
  createId?: () => string
  now?: () => Date
}>

export function unavailableMethodologyWorkbench(detail: string | null): PackReviewWorkbenchView {
  return packReviewWorkbenchViewSchema.parse({
    state: 'unavailable',
    message: '方法论内容暂时读不到，工作台其他部分不受影响。',
    detail,
  })
}

function locatorView(locator: SourceLocator): PackCriterionReviewView['sourceLocator'] {
  return {
    label: locator.label,
    chapter: locator.chapter ?? null,
    printedPages: locator.printedPages ?? null,
    figure: locator.figure ?? null,
  }
}

function criterionGaps(
  criterion: Criterion,
  guidance: EvidenceGuidance,
  behaviorAnchorCount: number,
): string[] {
  const gaps: string[] = []
  if (criterion.description.trim() === criterion.title.trim()) {
    gaps.push('还没有真正的描述：描述与名称完全相同。')
  }
  if (criterion.dimensionKey === null) {
    gaps.push('还没有对应到五个维度中的任何一个。')
  }
  if (behaviorAnchorCount === 0) {
    gaps.push('还没有行为锚点，无法据此分档。')
  }
  if (guidance.supportingIndicators.length === 0) gaps.push('还没有列出支持性表现。')
  if (guidance.counterIndicators.length === 0) gaps.push('还没有列出相反表现。')
  if (guidance.insufficientEvidence.length === 0) gaps.push('还没有说明什么情况下证据不足。')
  if (guidance.counterexampleChecks.length === 0) gaps.push('还没有列出反例核查。')
  if (guidance.collectionPrinciples.length === 0) gaps.push('还没有列出证据收集原则。')
  if (guidance.adjustmentConditions.length === 0) gaps.push('还没有列出需要调整判断的情况。')
  return gaps
}

/**
 * Says, in the consultant's own terms, whether this content is currently
 * constraining real judgment — and if not, that it was his own call.
 */
function statusDetail(
  pack: MethodologyPack,
  storedStatus: PackLifecycleStatus | null,
  signOff: PackReviewSignOff | null,
  outdated: boolean,
): string {
  if (pack.status !== 'active' || storedStatus === 'retired') {
    return '这份内容目前不参与正式判断。'
  }
  if (storedStatus === 'active') return '正在用于正式判断。'
  if (storedStatus === null) return '这份内容默认可以用于判断，本机还没有完成一次加载。'
  if (outdated) {
    return '你上次要求修订之后，这份内容又有改动。在你重新看过之前，它不会用于正式判断。'
  }
  const needsRevision =
    signOff?.verdicts.filter((item) => item.verdict === 'needs_revision').length ?? 0
  if (needsRevision === 0) return '按你的要求，这份内容暂时不用于正式判断。'
  return `你把其中 ${needsRevision} 条标为需要修订，所以这份内容暂时不用于正式判断；改回「可以用于判断」并保存后立刻恢复。`
}

export class MethodologyReviewService {
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(
    private readonly registry: MethodologyRegistry,
    private readonly methodologyRepository: MethodologyRepository & MethodologyPackStatusWriter,
    private readonly reviewRepository: MethodologyReviewRepository,
    dependencies: MethodologyReviewServiceDependencies = {},
  ) {
    this.createId = dependencies.createId ?? ulid
    this.now = dependencies.now ?? (() => new Date())
  }

  async getWorkbench(): Promise<PackReviewWorkbenchView> {
    const packs: PackReviewView[] = []
    for (const pack of this.registry.listPacks()) packs.push(await this.buildPackView(pack))
    return packReviewWorkbenchViewSchema.parse({ state: 'ready', packs })
  }

  async signOff(input: SignOffPackInput): Promise<PackReviewWorkbenchView> {
    const parsed = signOffPackInputSchema.parse(input)
    const pack = this.registry.getPack(parsed.packKey, parsed.packVersion)
    if (!pack) throw new Error(`未找到方法论内容 ${parsed.packKey}@${parsed.packVersion}`)

    const verdicts: PackReviewCriterionVerdict[] = parsed.verdicts.map((verdict) => ({
      criterionStableKey: verdict.criterionStableKey,
      verdict: verdict.verdict,
      note: verdict.note && verdict.note.trim() ? verdict.note.trim() : null,
    }))
    assertPackReviewCoverage(pack, {
      packKey: parsed.packKey,
      packVersion: parsed.packVersion,
      contentHash: pack.canonicalContentHash.value,
      verdicts,
    })

    const record: PackReviewSignOff = {
      id: this.createId(),
      packKey: pack.key,
      packVersion: pack.version,
      contentHash: pack.canonicalContentHash.value,
      decision: derivePackReviewDecision(verdicts),
      note: parsed.note && parsed.note.trim() ? parsed.note.trim() : null,
      signedAt: this.now().toISOString(),
      verdicts,
    }
    await this.reviewRepository.recordSignOff(record)
    await this.applyReviewOutcome(pack, record)

    return this.getWorkbench()
  }

  /**
   * A conclusion takes effect immediately. One `needs_revision` withdraws the
   * pack from use and every downstream judgment fails closed from that moment;
   * marking everything usable again puts it straight back.
   */
  private async applyReviewOutcome(
    pack: MethodologyPack,
    signOff: PackReviewSignOff,
  ): Promise<void> {
    if (pack.status !== 'active') return
    const persisted = await this.methodologyRepository.getPack(pack.key, pack.version)
    if (!persisted) return
    if (persisted.status !== 'active' && persisted.status !== 'review') return
    const target = resolvePackRuntimeStatus(pack.status, signOff)
    if (target === persisted.status) return
    await this.methodologyRepository.setPackStatus(pack.key, pack.version, target)
  }

  private async buildPackView(pack: MethodologyPack): Promise<PackReviewView> {
    const persisted = await this.methodologyRepository.getPack(pack.key, pack.version)
    const storedStatus = persisted?.status ?? null
    const signOff = await this.reviewRepository.getLatestSignOff(pack.key, pack.version)
    const outdated = packReviewIsOutdated(pack, signOff)
    const verdictByCriterion = new Map(
      (signOff && !outdated ? signOff.verdicts : []).map((verdict) => [
        verdict.criterionStableKey,
        verdict,
      ]),
    )
    const constructTitles = new Map(pack.constructs.map((item) => [item.id, item]))
    const guidanceByCriterion = new Map(
      pack.evidenceGuidance.map((guidance) => [guidance.criterionId, guidance]),
    )

    const criteria = pack.criteria.map((criterion) => {
      const construct = constructTitles.get(criterion.constructId)
      const guidance = guidanceByCriterion.get(criterion.id)
      if (!construct) throw new Error(`Criterion ${criterion.id} has no construct`)
      if (!guidance) throw new Error(`Criterion ${criterion.id} has no evidence guidance`)
      const behaviorAnchorCount = pack.behaviorAnchors.filter(
        (anchor) => anchor.criterionId === criterion.id,
      ).length
      const verdict = verdictByCriterion.get(criterion.id)

      return {
        stableKey: criterion.id,
        title: criterion.title,
        description: criterion.description,
        constructTitle: construct.title,
        assessmentQuestion: construct.assessmentQuestion,
        practiceType: criterion.practiceType,
        dimensionLabel: criterion.dimensionKey
          ? (dimensionLabels[criterion.dimensionKey] ?? criterion.dimensionKey)
          : null,
        appliesTo: [...criterion.applicability.appliesTo],
        doesNotApplyTo: [...criterion.applicability.doesNotApplyTo],
        applicabilityNotes: [...(criterion.applicability.notes ?? [])],
        supportingIndicators: [...guidance.supportingIndicators],
        counterIndicators: [...guidance.counterIndicators],
        insufficientEvidence: [...guidance.insufficientEvidence],
        counterexampleChecks: [...guidance.counterexampleChecks],
        collectionPrinciples: [...guidance.collectionPrinciples],
        adjustmentConditions: [...guidance.adjustmentConditions],
        guardrails: pack.inferenceGuardrails
          .filter((guardrail) => guardrail.criterionId === criterion.id)
          .map((guardrail) => guardrail.statement),
        behaviorAnchorCount,
        sourceLocator: locatorView(criterion.sourceLocator),
        gaps: criterionGaps(criterion, guidance, behaviorAnchorCount),
        lastVerdict: verdict ? { verdict: verdict.verdict, note: verdict.note } : null,
      }
    })

    // What the consultant sees is what actually happens locally, not what the
    // shipped file declares.
    const effectiveStatus: PackLifecycleStatus = storedStatus ?? pack.status

    return {
      key: pack.key,
      version: pack.version,
      title: pack.title,
      status: effectiveStatus,
      statusLabel: statusLabels[effectiveStatus],
      statusDetail: statusDetail(pack, storedStatus, signOff, outdated),
      inUse: pack.status === 'active' && storedStatus === 'active',
      sourceLabel: sourceLabels[pack.sourceType],
      constructs: pack.constructs.map((construct) => ({
        stableKey: construct.id,
        title: construct.title,
        assessmentQuestion: construct.assessmentQuestion,
        sourceLocator: locatorView(construct.sourceLocator),
      })),
      criteria,
      packGuardrails: pack.inferenceGuardrails
        .filter((guardrail) => guardrail.scope === 'pack')
        .map((guardrail) => guardrail.statement),
      behaviorAnchorCount: pack.behaviorAnchors.length,
      review: signOff
        ? {
            decision: signOff.decision,
            decisionLabel: signOff.decision === 'approved' ? '全部可以用于判断' : '需要修订',
            decidedAt: signOff.signedAt,
            note: signOff.note,
            usableCount: signOff.verdicts.filter((item) => item.verdict === 'usable').length,
            needsRevisionCount: signOff.verdicts.filter((item) => item.verdict === 'needs_revision')
              .length,
            outdated,
          }
        : null,
      technical: {
        packId: pack.id,
        sourceRef: pack.sourceRef,
        sourceFingerprint: pack.sourceFingerprint.value,
        contentHash: pack.canonicalContentHash.value,
        fileStatus: pack.status,
        storedStatus,
        reviewedContentHash: signOff?.contentHash ?? null,
      },
    }
  }
}
