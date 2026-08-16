import {
  createBaselineState,
  stageDimensionKeys,
  validateStateAssessmentDraft,
  type AcceptedJudgment,
  type DimensionAssessmentDraft,
  type DimensionAssessmentStatus,
  type JudgmentRepository,
  type SchoolRepository,
  type StageDimensionKey,
  type StageRecommendation,
  type StageRepository,
  type StateAssessmentDraft,
  type StateRecord,
  type StateRepository,
} from '@school-workbench/domain'
import {
  adjustStateInputSchema,
  confirmStateInputSchema,
  schoolIdSchema,
  type AdjustStateInput,
  type ConfirmStateInput,
  type StateOverviewView,
  type StateWorkspaceView,
} from '@school-workbench/shared'

export interface StateAssessmentEngine {
  assess(
    stage: StageRecommendation,
    judgments: AcceptedJudgment[],
    feedback?: string,
  ): Promise<StateAssessmentDraft>
}

const dimensionPatterns: Record<StageDimensionKey, RegExp> = {
  leadership: /校长|中层|领导|授权|责任|负责人|决策/,
  key_tasks: /任务|推进|教学|课堂|学习|课程|改进|项目/,
  structure: /机制|流程|节奏|教研|复盘|协作|分工|会议|制度/,
  culture: /文化|氛围|公开|讨论|信任|反馈|协作|共同|容错/,
  capability: /能力|能够|独立|教师|中层|分析|复盘|改进|专业/,
}

const negativePattern = /仍|依赖|没有|未能|未|缺少|不足|主要由|还不能|尚未|不稳定|难以/
const stablePattern = /长期稳定|持续稳定|已经稳定运行|连续.{0,6}稳定/
const progressPattern = /已经|能够|独立|稳定|持续|形成|常态|开始|逐步/

const statusLabels: Record<DimensionAssessmentStatus, string> = {
  unverified: '还需要更多观察',
  far_below: '明显低于阶段目标',
  partial: '部分达到阶段目标',
  mostly: '基本达到阶段目标',
  stable: '达到且稳定',
}

function inferStatus(judgments: AcceptedJudgment[]): DimensionAssessmentStatus {
  if (judgments.length === 0) return 'unverified'
  const statements = judgments.map((item) => item.statement).join('\n')
  const hasNegative = negativePattern.test(statements)
  const hasProgress = progressPattern.test(statements)
  if (hasNegative && hasProgress) return 'partial'
  if (hasNegative) return 'far_below'
  if (stablePattern.test(statements)) return 'stable'
  if (hasProgress) return 'mostly'
  return 'partial'
}

function feedbackDimension(feedback: string): StageDimensionKey | null {
  for (const dimensionKey of stageDimensionKeys) {
    if (dimensionPatterns[dimensionKey].test(feedback)) return dimensionKey
  }
  return null
}

function feedbackStatus(feedback: string): DimensionAssessmentStatus | null {
  if (/更多观察|证据不足|还看不清|不确定|先别判断|暂不判断/.test(feedback)) return 'unverified'
  if (/明显低于|差得很远|远低于/.test(feedback)) return 'far_below'
  if (/部分达到|有一点|开始做到/.test(feedback)) return 'partial'
  if (/基本达到|大体达到/.test(feedback)) return 'mostly'
  if (/达到且稳定|稳定达到|已经稳定/.test(feedback)) return 'stable'
  return null
}

function assessmentSummary(
  status: DimensionAssessmentStatus,
  targetTitle: string,
  targetDescription: string,
  judgments: AcceptedJudgment[],
  feedback?: string,
): string {
  if (feedback) {
    return `根据你的调整“${feedback}”，这里先按“${statusLabels[status]}”整理。这个阶段要重点看到：${targetDescription}`
  }
  if (status === 'unverified') {
    return `关于“${targetTitle}”，目前还没有足够的正式判断来确认达到情况。下一步可以重点看：${targetDescription}`
  }
  const basis = judgments
    .map((item) => item.statement)
    .slice(0, 2)
    .join('；')
  if (status === 'far_below') {
    return `相对“${targetDescription}”的阶段期待，目前已确认的情况显示仍有明显差距：${basis}`
  }
  if (status === 'partial') {
    return `相对“${targetDescription}”的阶段期待，目前已经出现一些进展，但还不够稳定：${basis}`
  }
  if (status === 'mostly') {
    return `相对“${targetDescription}”的阶段期待，目前的正式判断显示大部分关键表现已经出现：${basis}`
  }
  return `相对“${targetDescription}”的阶段期待，目前已有明确而持续的正式判断支持“达到且稳定”：${basis}`
}

function assertConfirmedStage(stage: StageRecommendation): void {
  if (stage.stage.status !== 'active') throw new Error('只有当前阶段才能形成学校状态')
  if (stage.targets.length !== stageDimensionKeys.length) throw new Error('当前阶段缺少完整目标')
  if (stage.targets.some((target) => target.status !== 'confirmed')) {
    throw new Error('当前阶段的目标还没有全部确认')
  }
}

export class BaselineStateAssessmentEngine implements StateAssessmentEngine {
  async assess(
    stage: StageRecommendation,
    judgments: AcceptedJudgment[],
    feedback?: string,
  ): Promise<StateAssessmentDraft> {
    assertConfirmedStage(stage)
    if (judgments.length === 0) throw new Error('没有正式判断时不能整理学校状态')

    const trimmedFeedback = feedback?.trim() ?? ''
    const overrideDimension = trimmedFeedback ? feedbackDimension(trimmedFeedback) : null
    const overrideStatus = trimmedFeedback ? feedbackStatus(trimmedFeedback) : null

    const assessments: DimensionAssessmentDraft[] = stageDimensionKeys.map((dimensionKey) => {
      const target = stage.targets.find((item) => item.dimensionKey === dimensionKey)
      if (!target) throw new Error('当前阶段缺少完整目标')
      const related = judgments.filter((judgment) =>
        dimensionPatterns[dimensionKey].test(judgment.statement),
      )
      let status = inferStatus(related)
      let feedbackForDimension: string | undefined
      if (overrideDimension === dimensionKey && overrideStatus) {
        status = overrideStatus
        feedbackForDimension = trimmedFeedback
      }

      const usableJudgments = status === 'unverified' ? related : related.length > 0 ? related : []
      if (status !== 'unverified' && usableJudgments.length === 0) status = 'unverified'

      return {
        dimensionKey,
        status,
        summary: assessmentSummary(
          status,
          target.title,
          target.description,
          usableJudgments,
          feedbackForDimension,
        ),
        judgmentIds: usableJudgments.map((item) => item.id),
      }
    })

    const unverifiedCount = assessments.filter((item) => item.status === 'unverified').length
    const assessedCount = assessments.length - unverifiedCount
    const summaryLead = trimmedFeedback
      ? `结合你的补充“${trimmedFeedback}”，我重新整理了当前状态。`
      : ''
    const limitations = [
      ...(unverifiedCount > 0
        ? [`还有 ${unverifiedCount} 个方面依据不足，先不判断达到程度。`]
        : []),
      '这些判断只基于目前已经确认的情况，不等于学校的客观全貌。',
    ]

    const draft: StateAssessmentDraft = {
      stageId: stage.stage.id,
      summary: `${summaryLead}目前有 ${assessedCount} 个方面可以形成初步判断，${unverifiedCount} 个方面还需要更多观察。`,
      limitations,
      assessments,
      judgmentIds: judgments.map((item) => item.id),
      adjustmentFeedback: trimmedFeedback || null,
    }
    validateStateAssessmentDraft(draft)
    return draft
  }
}

type CachedDraft = {
  draft: StateAssessmentDraft
  judgmentIds: string[]
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function limitationsFromRecord(record: StateRecord): string[] {
  const unverifiedCount = record.assessments.filter(
    (item) => item.assessment.status === 'unverified',
  ).length
  return [
    ...(unverifiedCount > 0 ? [`还有 ${unverifiedCount} 个方面依据不足，先不判断达到程度。`] : []),
    '这是当时基于已确认情况形成的起点状态，不等于学校的客观全貌。',
  ]
}

function recordAsDraft(record: StateRecord): StateAssessmentDraft {
  return {
    stageId: record.snapshot.stageId,
    summary: record.snapshot.summary,
    limitations: limitationsFromRecord(record),
    assessments: record.assessments.map((item) => ({
      dimensionKey: item.assessment.dimensionKey,
      status: item.assessment.status,
      summary: item.assessment.summary,
      judgmentIds: [...item.judgmentIds],
    })),
    judgmentIds: [...record.judgmentIds],
    adjustmentFeedback: null,
  }
}

function toOverview(
  stage: StageRecommendation,
  draft: StateAssessmentDraft,
  judgments: AcceptedJudgment[],
): StateOverviewView {
  const judgmentText = new Map(judgments.map((item) => [item.id, item.statement]))
  return {
    stage: {
      id: stage.stage.id,
      title: stage.stage.title,
      focus: stage.stage.focus,
    },
    summary: draft.summary,
    limitations: draft.limitations,
    dimensions: draft.assessments.map((assessment) => {
      const target = stage.targets.find((item) => item.dimensionKey === assessment.dimensionKey)
      if (!target) throw new Error('当前阶段缺少完整目标')
      return {
        dimensionKey: assessment.dimensionKey,
        label: target.title,
        target: target.description,
        status: assessment.status,
        statusLabel: statusLabels[assessment.status],
        summary: assessment.summary,
        basis: assessment.judgmentIds
          .map((judgmentId) => judgmentText.get(judgmentId))
          .filter((text): text is string => Boolean(text)),
      }
    }),
  }
}

export class StateService {
  private readonly drafts = new Map<string, CachedDraft>()

  constructor(
    private readonly schoolRepository: SchoolRepository,
    private readonly judgmentRepository: JudgmentRepository,
    private readonly stageRepository: StageRepository,
    private readonly stateRepository: StateRepository,
    private readonly engine: StateAssessmentEngine = new BaselineStateAssessmentEngine(),
  ) {}

  private async ensureSchool(schoolId: string): Promise<void> {
    const school = await this.schoolRepository.findById(schoolId)
    if (!school || school.archivedAt) throw new Error('没有找到这所学校')
  }

  private async currentContext(schoolId: string): Promise<{
    stage: StageRecommendation | null
    judgments: AcceptedJudgment[]
  }> {
    const [stage, judgments] = await Promise.all([
      this.stageRepository.findActive(schoolId),
      this.judgmentRepository.listAcceptedJudgments(schoolId),
    ])
    if (stage) assertConfirmedStage(stage)
    return { stage, judgments }
  }

  async getWorkspace(schoolId: string): Promise<StateWorkspaceView> {
    const parsedSchoolId = schoolIdSchema.parse(schoolId)
    await this.ensureSchool(parsedSchoolId)

    const latest = await this.stateRepository.findLatest(parsedSchoolId)
    if (latest) {
      const stage = await this.stageRepository.findById(latest.snapshot.stageId)
      if (!stage || stage.stage.schoolId !== parsedSchoolId)
        throw new Error('起点状态对应的阶段不存在')
      const judgments = await this.judgmentRepository.listAcceptedJudgments(parsedSchoolId)
      return { state: 'baseline', overview: toOverview(stage, recordAsDraft(latest), judgments) }
    }

    const { stage, judgments } = await this.currentContext(parsedSchoolId)
    if (!stage) return { state: 'needs_stage' }
    if (judgments.length === 0) return { state: 'needs_judgments', stageTitle: stage.stage.title }

    const judgmentIds = judgments.map((item) => item.id)
    const cached = this.drafts.get(parsedSchoolId)
    if (
      cached &&
      cached.draft.stageId === stage.stage.id &&
      sameIds(cached.judgmentIds, judgmentIds)
    ) {
      return { state: 'draft', overview: toOverview(stage, cached.draft, judgments) }
    }

    const draft = await this.engine.assess(stage, judgments)
    validateStateAssessmentDraft(draft)
    this.drafts.set(parsedSchoolId, { draft, judgmentIds: [...judgmentIds] })
    return { state: 'draft', overview: toOverview(stage, draft, judgments) }
  }

  async adjust(input: AdjustStateInput): Promise<StateWorkspaceView> {
    const parsed = adjustStateInputSchema.parse(input)
    await this.ensureSchool(parsed.schoolId)
    if (await this.stateRepository.findLatest(parsed.schoolId)) {
      throw new Error('起点状态已经确认，当前纵切不再修改它')
    }

    const { stage, judgments } = await this.currentContext(parsed.schoolId)
    if (!stage) throw new Error('请先在工作台确认当前阶段')
    if (judgments.length === 0) throw new Error('请先确认至少一条正式判断')

    const draft = await this.engine.assess(stage, judgments, parsed.feedback)
    validateStateAssessmentDraft(draft)
    const judgmentIds = judgments.map((item) => item.id)
    if (!sameIds(draft.judgmentIds, judgmentIds)) {
      throw new Error('状态整理使用的正式判断与记录范围不一致')
    }
    this.drafts.set(parsed.schoolId, { draft, judgmentIds: [...judgmentIds] })
    return { state: 'draft', overview: toOverview(stage, draft, judgments) }
  }

  async confirm(input: ConfirmStateInput): Promise<StateWorkspaceView> {
    const parsed = confirmStateInputSchema.parse(input)
    await this.ensureSchool(parsed.schoolId)

    const existing = await this.stateRepository.findLatest(parsed.schoolId)
    if (existing) {
      const existingStage = await this.stageRepository.findById(existing.snapshot.stageId)
      if (!existingStage) throw new Error('起点状态对应的阶段不存在')
      const judgments = await this.judgmentRepository.listAcceptedJudgments(parsed.schoolId)
      return {
        state: 'baseline',
        overview: toOverview(existingStage, recordAsDraft(existing), judgments),
      }
    }

    const { stage, judgments } = await this.currentContext(parsed.schoolId)
    if (!stage) throw new Error('请先在工作台确认当前阶段')
    if (judgments.length === 0) throw new Error('请先确认至少一条正式判断')

    const cached = this.drafts.get(parsed.schoolId)
    if (!cached || cached.draft.stageId !== stage.stage.id) {
      throw new Error('请先看一下刚刚整理出的当前状态，再确认记录')
    }
    const currentJudgmentIds = judgments.map((item) => item.id)
    if (!sameIds(cached.judgmentIds, currentJudgmentIds)) {
      this.drafts.delete(parsed.schoolId)
      throw new Error('最近又有新的正式判断，请先看一下重新整理后的状态再确认')
    }
    if (!sameIds(cached.draft.judgmentIds, currentJudgmentIds)) {
      throw new Error('状态整理使用的正式判断与记录范围不一致')
    }

    const record = createBaselineState(parsed.schoolId, cached.draft)
    await this.stateRepository.saveBaseline(record)
    this.drafts.delete(parsed.schoolId)
    return { state: 'baseline', overview: toOverview(stage, recordAsDraft(record), judgments) }
  }
}
