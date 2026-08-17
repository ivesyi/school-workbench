import {
  assessmentCandidateSchema,
  assessmentInputSchema,
  type AssessmentCandidate,
  type AssessmentInput,
} from '@school-workbench/assessment'
import type { GroundedDiagnosisRecord } from '@school-workbench/domain'
import {
  loadMethodologyRegistry,
  MethodologyRegistry,
  type MethodologyPack,
} from '@school-workbench/methodology'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GroundedDiagnosisProtocolError,
  GroundedDiagnosisService,
  type GroundedDiagnosisPersistenceRequest,
  type GroundedDiagnosisRepository,
} from './grounded-diagnosis-service'

function activeRegistry(): MethodologyRegistry {
  const registry = loadMethodologyRegistry(
    resolve('knowledge/methodology'),
    resolve('references/SOURCE_MANIFEST.md'),
  )
  return new MethodologyRegistry(
    registry.listPacks().map((pack) => ({ ...pack, status: 'active' }) as MethodologyPack),
  )
}

function fixture(): { input: AssessmentInput; candidate: AssessmentCandidate } {
  const schoolId = 'school-grounded-app'
  const criterion = {
    packKey: 'schooling-by-design',
    version: '1',
    criterionId: 'SBD.C4.SYSTEM_ALIGNMENT',
  } as const
  const input = assessmentInputSchema.parse({
    protocolVersion: 1,
    school: { kind: 'school', schoolId },
    activeStage: { id: 'stage-1', schoolId, title: '阶段一', status: 'active' },
    confirmedStageTargets: [
      {
        id: 'target-1',
        stageId: 'stage-1',
        schoolId,
        dimensionKey: 'key_tasks',
        title: '关键任务形成协同',
        description: '检查关键任务与协同是否形成可观察联系。',
        status: 'confirmed',
      },
    ],
    evidence: [
      {
        kind: 'evidence',
        id: 'evidence-1',
        schoolId,
        sourceType: 'pasted_text',
        title: '合成记录',
        uri: null,
        inlineText: '完全合成的学校材料。',
        locator: 'synthetic:evidence-1',
        capturedAt: '2026-08-17T00:00:00.000Z',
      },
    ],
    observationFacts: [
      {
        kind: 'observation_fact',
        id: 'fact-1',
        schoolId,
        evidenceId: 'evidence-1',
        factType: 'organization',
        text: '三个工作组在同一计划中明确共同目标与依赖。',
        locator: 'synthetic:fact-1',
        directness: 'high',
      },
    ],
    claims: [
      {
        kind: 'claim',
        id: 'claim-1',
        schoolId,
        statement: '当前关键任务与协同机制之间存在可核查联系。',
        predicateKey: 'synthetic:alignment',
        scope: { kind: 'school', schoolId },
      },
    ],
    claimFacts: [{ claimId: 'claim-1', factId: 'fact-1', stance: 'supporting' }],
    methodologyContext: [criterion],
  })
  const candidate = assessmentCandidateSchema.parse({
    protocolVersion: 1,
    school: { kind: 'school', schoolId },
    claimRefs: ['claim-1'],
    criterionMappings: [{ ...criterion, reason: '与当前 Claim 的系统对齐问题直接对应。' }],
    stageTargetRefs: ['target-1'],
    supportingFactRefs: ['fact-1'],
    counterFactRefs: [],
    counterEvidenceSearch: {
      completed: true,
      summary: '已检查当前 Claim 范围内登记的支持与相反事实。',
      searchedEvidenceRefs: ['evidence-1'],
      searchedFactRefs: ['fact-1'],
    },
    interpretations: [
      {
        kind: 'interpretation',
        id: 'interpretation-1',
        summary: '当前事实支持一个可审核的系统对齐解释。',
        factRefs: ['fact-1'],
      },
    ],
    provisionalJudgment: '当前关键任务与协同安排已经出现可核查的对齐迹象。',
    mechanism: '共同目标与显式依赖降低了跨组行动偏差。',
    alternativeHypotheses: ['这也可能只是一次短期项目协调。'],
    unresolvedQuestions: ['下一轮是否仍能观察到相同关系？'],
    recommendedActions: ['保留可观察的协同记录。'],
    nextObservations: ['观察下一轮跨组任务。'],
    impactEvidencePlan: ['比较下一轮任务阻塞记录。'],
    evidenceQuality: {
      directness: 'high',
      triangulation: 'single_source',
      limitations: ['当前只有一类合成材料。'],
    },
    confidence: 'medium',
    status: 'proposed',
  })
  return { input, candidate }
}

class MemoryRepository implements GroundedDiagnosisRepository {
  writes = 0
  lastRequest: GroundedDiagnosisPersistenceRequest | null = null

  async saveGroundedProposal(
    request: GroundedDiagnosisPersistenceRequest,
  ): Promise<GroundedDiagnosisRecord> {
    this.writes += 1
    this.lastRequest = request
    return {
      proposal: request.proposal,
      claimIds: [...request.candidate.claimRefs],
      criteria: request.methodology.map((item) => ({
        criterionId: item.criterion.id,
        packKey: item.packKey,
        version: item.version,
        stableKey: item.criterion.stableKey,
      })),
      stageTargetIds: [...request.candidate.stageTargetRefs],
    }
  }

  async findGroundedProposal(): Promise<GroundedDiagnosisRecord | null> {
    return null
  }
}

describe('GroundedDiagnosisService', () => {
  it('validates raw protocol input itself before mapping and persistence', async () => {
    const { input, candidate } = fixture()
    const repository = new MemoryRepository()
    const service = new GroundedDiagnosisService(activeRegistry(), repository, {
      createId: () => 'proposal-1',
      now: () => new Date('2026-08-17T01:00:00.000Z'),
    })

    const saved = await service.create({
      schoolId: input.school.schoolId,
      type: 'mismatch',
      title: '系统对齐暂定诊断',
      rawAssessmentInput: input,
      rawAssessmentCandidate: candidate,
    })

    expect(repository.writes).toBe(1)
    expect(saved.proposal.status).toBe('proposed')
    expect(saved.proposal.provisionalJudgment).toBe(candidate.provisionalJudgment)
    expect(saved.proposal.interpretations).toEqual(['当前事实支持一个可审核的系统对齐解释。'])
    expect(saved.claimIds).toEqual(['claim-1'])
    expect(saved.criteria[0]?.stableKey).toBe('SBD.C4.SYSTEM_ALIGNMENT')
    expect(saved.stageTargetIds).toEqual(['target-1'])
  })

  it('returns stable protocol errors and performs zero writes for an invalid candidate', async () => {
    const { input, candidate } = fixture()
    const repository = new MemoryRepository()
    const service = new GroundedDiagnosisService(activeRegistry(), repository)
    const invalid = { ...candidate, claimRefs: [] }

    try {
      await service.create({
        schoolId: input.school.schoolId,
        type: 'state',
        title: '不应保存',
        rawAssessmentInput: input,
        rawAssessmentCandidate: invalid,
      })
      throw new Error('expected validation failure')
    } catch (error) {
      expect(error).toBeInstanceOf(GroundedDiagnosisProtocolError)
      expect((error as GroundedDiagnosisProtocolError).errors.map((item) => item.code)).toContain(
        'ASSESSMENT_PROPOSED_CLAIM_REQUIRED',
      )
    }
    expect(repository.writes).toBe(0)
  })
})
