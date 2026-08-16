import {
  adjustStageRecommendation,
  createStageRecommendation,
  type AcceptedJudgment,
  type JudgmentRepository,
  type SchoolRepository,
  type StageRecommendation,
  type StageRecommendationDraft,
  type StageRepository,
} from '@school-workbench/domain'
import {
  adjustStageInputSchema,
  confirmStageInputSchema,
  schoolIdSchema,
  type AdjustStageInput,
  type ConfirmStageInput,
  type StageSummaryView,
  type StageWorkspaceView,
} from '@school-workbench/shared'

export interface StageRecommendationEngine {
  recommend(judgments: AcceptedJudgment[], feedback?: string): Promise<StageRecommendationDraft>
}

type RecommendationKind = 'organization' | 'practice' | 'student'

function classifyExplicitFeedback(feedback: string): RecommendationKind | null {
  if (/学生|学习|成绩|学业|学习体验|学生学习/.test(feedback)) return 'student'
  if (/教师|课堂|教研|教案|教学|备课|教师实践/.test(feedback)) return 'practice'
  if (/组织|中层|校长|领导|授权|协作|职责|责任|任务|推进|机制|管理/.test(feedback)) {
    return 'organization'
  }
  return null
}

function classifyJudgments(judgments: AcceptedJudgment[]): RecommendationKind {
  const context = judgments.map((item) => item.statement).join('\n')
  if (/学生|学习|成绩|学业|学习体验/.test(context)) return 'student'
  if (/教师|课堂|教研|教案|教学|备课/.test(context)) return 'practice'
  return 'organization'
}

function target(title: string, description: string) {
  return { title, description }
}

export class BaselineStageRecommendationEngine implements StageRecommendationEngine {
  async recommend(
    judgments: AcceptedJudgment[],
    feedback?: string,
  ): Promise<StageRecommendationDraft> {
    if (judgments.length === 0) throw new Error('没有正式判断时不能形成阶段建议')

    const trimmedFeedback = feedback?.trim() ?? ''
    const kind = trimmedFeedback
      ? (classifyExplicitFeedback(trimmedFeedback) ?? classifyJudgments(judgments))
      : classifyJudgments(judgments)
    const feedbackLead = trimmedFeedback ? `结合你的补充“${trimmedFeedback}”，` : ''

    if (kind === 'student') {
      return {
        title: '验证学生学习变化',
        summary: '我理解这个学校目前大致处于“验证学生学习变化”的阶段。',
        focus: `${feedbackLead}这个阶段现在最需要看到：成人实践的改变能够稳定对应到学生学习体验和结果的变化。`,
        targets: {
          leadership: target('领导力', '领导团队持续追问改进行动是否真正带来学生学习变化。'),
          key_tasks: target('关键任务', '关键改进任务明确连接学生学习证据，并据此调整下一步行动。'),
          structure: target('结构与机制', '形成稳定收集、讨论和使用学生学习证据的工作节奏。'),
          culture: target('文化', '团队能够基于证据讨论成效，而不是只汇报做了哪些事情。'),
          capability: target('能力', '教师与中层能够从学生学习证据中判断实践效果并继续调整。'),
        },
      }
    }

    if (kind === 'practice') {
      return {
        title: '让改进进入教师实践',
        summary: '我理解这个学校目前大致处于“让改进进入教师实践”的阶段。',
        focus: `${feedbackLead}这个阶段现在最需要看到：教师和教研团队开始用真实课堂证据持续调整实践，而不是只停留在理解和要求层面。`,
        targets: {
          leadership: target('领导力', '领导团队把关注点从布置要求转向支持教师实践改进和复盘。'),
          key_tasks: target('关键任务', '课堂改进任务能够落到具体教学行为，并持续观察学生反应。'),
          structure: target(
            '结构与机制',
            '教研、观察和复盘形成稳定节奏，能够支持教师持续试验和调整。',
          ),
          culture: target('文化', '教师能够公开讨论真实课堂问题，并把失败和差异作为共同学习材料。'),
          capability: target('能力', '教师能够基于课堂证据反思、调整教学，并与同伴共同改进。'),
        },
      }
    }

    return {
      title: '建立共同推动改进的组织基础',
      summary: '我理解这个学校目前大致处于“建立共同推动改进的组织基础”的阶段。',
      focus: `${feedbackLead}这个阶段现在最需要看到：关键工作逐步不再只依赖校长，中层开始独立承担、推进和复盘，学校形成可重复的协作方式。`,
      targets: {
        leadership: target('领导力', '校长从直接代办转向明确方向、授权和复盘，中层承担真实责任。'),
        key_tasks: target('关键任务', '至少一项关键改进任务由中层独立拆解、推进并根据结果调整。'),
        structure: target('结构与机制', '形成稳定的任务分工、推进节奏和复盘机制，不依赖临时推动。'),
        culture: target('文化', '中层能够公开讨论问题、提出不同判断并对推进结果负责。'),
        capability: target('能力', '中层能够独立分析问题、制定行动、协同推进并完成复盘。'),
      },
    }
  }
}

function toStageSummary(recommendation: StageRecommendation): StageSummaryView {
  return {
    id: recommendation.stage.id,
    title: recommendation.stage.title,
    summary: recommendation.stage.summary,
    focus: recommendation.stage.focus,
    targets: [...recommendation.targets]
      .sort((left, right) => left.sequence - right.sequence)
      .map((targetItem) => ({
        id: targetItem.id,
        dimensionKey: targetItem.dimensionKey,
        label: targetItem.title,
        text: targetItem.description,
      })),
  }
}

export class StageService {
  constructor(
    private readonly schoolRepository: SchoolRepository,
    private readonly judgmentRepository: JudgmentRepository,
    private readonly stageRepository: StageRepository,
    private readonly engine: StageRecommendationEngine = new BaselineStageRecommendationEngine(),
  ) {}

  private async ensureSchool(schoolId: string): Promise<void> {
    const school = await this.schoolRepository.findById(schoolId)
    if (!school || school.archivedAt) throw new Error('没有找到这所学校')
  }

  async getWorkspace(schoolId: string): Promise<StageWorkspaceView> {
    const parsedSchoolId = schoolIdSchema.parse(schoolId)
    await this.ensureSchool(parsedSchoolId)

    const active = await this.stageRepository.findActive(parsedSchoolId)
    if (active) return { state: 'active', stage: toStageSummary(active) }

    const planned = await this.stageRepository.findPlanned(parsedSchoolId)
    if (planned) return { state: 'suggested', stage: toStageSummary(planned) }

    const judgments = await this.judgmentRepository.listAcceptedJudgments(parsedSchoolId)
    if (judgments.length === 0) return { state: 'none' }

    const draft = await this.engine.recommend(judgments)
    const sequence = await this.stageRepository.nextSequence(parsedSchoolId)
    const recommendation = createStageRecommendation(
      parsedSchoolId,
      draft,
      judgments.map((item) => item.id),
      sequence,
    )
    await this.stageRepository.savePlanned(recommendation)
    return { state: 'suggested', stage: toStageSummary(recommendation) }
  }

  async adjust(input: AdjustStageInput): Promise<StageWorkspaceView> {
    const parsed = adjustStageInputSchema.parse(input)
    await this.ensureSchool(parsed.schoolId)

    const recommendation = await this.stageRepository.findById(parsed.stageId)
    if (!recommendation || recommendation.stage.schoolId !== parsed.schoolId) {
      throw new Error('没有找到这个阶段建议')
    }
    if (recommendation.stage.status !== 'planned') throw new Error('当前阶段已经确认')

    const judgments = await this.judgmentRepository.listAcceptedJudgments(parsed.schoolId)
    const draft = await this.engine.recommend(judgments, parsed.feedback)
    const adjusted = adjustStageRecommendation(recommendation, draft, parsed.feedback)
    await this.stageRepository.replacePlanned(adjusted)
    return { state: 'suggested', stage: toStageSummary(adjusted) }
  }

  async confirm(input: ConfirmStageInput): Promise<StageWorkspaceView> {
    const parsed = confirmStageInputSchema.parse(input)
    await this.ensureSchool(parsed.schoolId)
    const active = await this.stageRepository.activate(parsed.schoolId, parsed.stageId, new Date())
    return { state: 'active', stage: toStageSummary(active) }
  }
}
