import {
  assessmentCandidateSchema,
  findHiddenReasoningField,
  findNumericScoringField,
  protocolError,
} from '@school-workbench/assessment'
import { describe, expect, it } from 'vitest'
import { CapabilityTokenStore } from './auth'
import {
  capabilityNames,
  capabilityScope,
  capabilityScopes,
  forbiddenCapabilityNames,
  forbiddenScopes,
  readCapabilityNames,
  readScopes,
  writeCapabilityNames,
  writeScopes,
} from './contracts'
import { createWorkbenchReadPlaneBootstrap, type WorkbenchLoopbackReadPlane } from './loopback'
import type { WorkbenchReadCapabilityService } from './service'
import {
  diagnosisProposeInputSchema,
  evidenceRegisterInputSchema,
  proposedCandidateSchema,
  type EvidenceRegistrationDto,
  type GroundedDiagnosisGateway,
  type StageProposalCommand,
  type WritePlaneRepository,
} from './write-contracts'
import { WorkbenchWriteCapabilityService, WritePlaneProtocolError } from './write-service'

const SCHOOL = 'school-1'
const RUN = 'run-1'

function readServiceStub(): WorkbenchReadCapabilityService {
  return {
    schoolContext: async () => ({}),
    stageCurrent: async () => ({}),
    stateCurrent: async () => ({}),
    stateHistory: async () => ({}),
    evidenceList: async () => ({}),
    diagnosisList: async () => ({}),
    standardsGet: async () => ({}),
  } as unknown as WorkbenchReadCapabilityService
}

const registration: EvidenceRegistrationDto = Object.freeze({
  evidenceId: 'e1',
  reused: false,
  observationFacts: Object.freeze([Object.freeze({ ref: 'f1', id: 'fact-1', reused: false })]),
  claims: Object.freeze([Object.freeze({ ref: 'c1', id: 'claim-1', reused: false })]),
})

const stageProposal = Object.freeze({
  stageId: 'stage-1',
  title: '建立共同推动改进的组织基础',
  summary: '我理解这个学校目前大致处于“建立共同推动改进的组织基础”的阶段。',
  focus: '这个阶段现在最需要看到：中层开始独立承担关键任务。',
  status: 'planned' as const,
  targets: Object.freeze([
    Object.freeze({ dimensionKey: 'leadership', title: '领导力', description: '目标 1' }),
    Object.freeze({ dimensionKey: 'key_tasks', title: '关键任务', description: '目标 2' }),
    Object.freeze({ dimensionKey: 'structure', title: '结构与机制', description: '目标 3' }),
    Object.freeze({ dimensionKey: 'culture', title: '文化', description: '目标 4' }),
    Object.freeze({ dimensionKey: 'capability', title: '能力', description: '目标 5' }),
  ]),
})

const validStageProposalInput = Object.freeze({
  title: '建立共同推动改进的组织基础',
  summary: '我理解这个学校目前大致处于“建立共同推动改进的组织基础”的阶段。',
  focus: '这个阶段现在最需要看到：中层开始独立承担关键任务。',
  targets: {
    leadership: { title: '领导力', description: '目标 1' },
    key_tasks: { title: '关键任务', description: '目标 2' },
    structure: { title: '结构与机制', description: '目标 3' },
    culture: { title: '文化', description: '目标 4' },
    capability: { title: '能力', description: '目标 5' },
  },
})

function repositoryStub(overrides: Partial<WritePlaneRepository> = {}): WritePlaneRepository {
  return {
    registerEvidence: async () => registration,
    saveStageProposal: async () => stageProposal,
    buildAssessmentInput: async () => ({ protocolVersion: 1 }),
    ...overrides,
  }
}

function gatewayStub(overrides: Partial<GroundedDiagnosisGateway> = {}): GroundedDiagnosisGateway {
  return {
    create: async () => ({
      proposal: { id: 'proposal-1', status: 'proposed' as const },
      claimIds: ['claim-1'],
      stageTargetIds: ['target-1'],
      criteria: [],
    }),
    ...overrides,
  }
}

function rejectingGateway(codes: readonly string[]): GroundedDiagnosisGateway {
  return gatewayStub({
    create: async () => {
      const error = new Error('rejected')
      error.name = 'GroundedDiagnosisProtocolError'
      Reflect.set(
        error,
        'errors',
        codes.map((code) =>
          protocolError(
            code as Parameters<typeof protocolError>[0],
            '$.candidate',
            `${code} explained`,
          ),
        ),
      )
      throw error
    },
  })
}

const validRegisterInput = {
  sourceType: 'observation',
  title: '观察记录',
  inlineText: '中层没有拆解关键任务。',
  observationFacts: [
    {
      ref: 'f1',
      factType: 'organization',
      text: '会议上没有出现任务拆解环节。',
      locator: 'p.1',
      directness: 'high',
    },
  ],
  claims: [
    {
      ref: 'c1',
      statement: '关键任务尚未被中层拆解。',
      facts: [{ factRef: 'f1', stance: 'supporting' }],
    },
  ],
}

describe('SPEC 17 capability scopes', () => {
  it('adds exactly the three write scopes the SPEC always allowed', () => {
    expect([...writeScopes]).toEqual(['evidence.register', 'diagnosis.propose', 'stage.propose'])
    expect([...capabilityScopes]).toEqual([...readScopes, ...writeScopes])
    expect(capabilityScopes).toHaveLength(9)
  })

  it('never maps a capability to a scope SPEC 17 forbids', () => {
    const mapped = new Set<string>(Object.values(capabilityScope))
    for (const forbidden of forbiddenScopes) {
      expect(mapped.has(forbidden)).toBe(false)
      expect((capabilityScopes as readonly string[]).includes(forbidden)).toBe(false)
    }
  })

  it('issues write scopes and still refuses anything outside the frozen list', () => {
    const store = new CapabilityTokenStore()
    expect(() =>
      store.issue({ schoolId: SCHOOL, agentRunId: RUN, scopes: capabilityScopes }),
    ).not.toThrow()

    for (const forbidden of forbiddenScopes) {
      expect(() =>
        store.issue({ schoolId: SCHOOL, agentRunId: RUN, scopes: [forbidden] }),
      ).toThrowError(/frozen SPEC 17 capability scopes/u)
    }
    expect(() =>
      store.issue({ schoolId: SCHOOL, agentRunId: RUN, scopes: ['evidence.write'] }),
    ).toThrowError(/frozen SPEC 17 capability scopes/u)
  })
})

describe('SPEC 25 forbidden capabilities', () => {
  it('states the prohibition explicitly rather than relying on absence', () => {
    expect([...forbiddenCapabilityNames]).toEqual([
      'diagnosis_accept',
      'diagnosis_reject',
      'state_commit',
      'stage_activate',
    ])
  })

  it('keeps them off every capability list', () => {
    for (const forbidden of forbiddenCapabilityNames) {
      expect((capabilityNames as readonly string[]).includes(forbidden)).toBe(false)
      expect(Object.hasOwn(capabilityScope, forbidden)).toBe(false)
    }
    // SPEC 18 freezes eleven tools; this slice serves ten of them.
    expect(capabilityNames).toHaveLength(10)
    expect((capabilityNames as readonly string[]).includes('feishu_ensure_ready')).toBe(false)
  })
})

describe('the propose input is the frozen candidate, not a second DTO', () => {
  it('is derived from assessmentCandidateSchema with only the school removed', () => {
    const frozenKeys = Object.keys(assessmentCandidateSchema.shape).sort()
    const derivedKeys = Object.keys(proposedCandidateSchema.shape).sort()
    expect(derivedKeys).toEqual(frozenKeys.filter((key) => key !== 'school'))
  })

  it('still refuses anything the frozen schema would refuse', () => {
    const base = evidenceRegisterInputSchema.safeParse(validRegisterInput)
    expect(base.success).toBe(true)
    // The Agent cannot choose its own school, and cannot smuggle extra fields.
    expect(
      proposedCandidateSchema.safeParse({ school: { kind: 'school', schoolId: SCHOOL } }).success,
    ).toBe(false)
  })
})

describe('write payload shape', () => {
  it('uses no key name the assessment contracts fail closed on', () => {
    // `packages/assessment` scans key names before running Zod: a `score`,
    // `weight`, `rating` or `scratchpad` key anywhere is refused outright.
    // Everything the Agent writes through these tools must survive that scan.
    expect(findNumericScoringField(validRegisterInput)).toBeNull()
    expect(findHiddenReasoningField(validRegisterInput)).toBeNull()
    expect(findNumericScoringField(candidateFixture())).toBeNull()
    expect(findHiddenReasoningField(candidateFixture())).toBeNull()

    const registerKeys = Object.keys(evidenceRegisterInputSchema.shape ?? {})
    const proposeKeys = Object.keys(diagnosisProposeInputSchema.shape)
    for (const key of [...registerKeys, ...proposeKeys]) {
      expect(findNumericScoringField({ [key]: 1 }), key).toBeNull()
      expect(findHiddenReasoningField({ [key]: 1 }), key).toBeNull()
    }
  })
})

describe('write capability service', () => {
  it('passes the assessment findings through unchanged and counts the round', async () => {
    const service = new WorkbenchWriteCapabilityService(
      repositoryStub(),
      rejectingGateway([
        'ASSESSMENT_PROPOSED_CRITERION_REQUIRED',
        'ASSESSMENT_COUNTER_SEARCH_REQUIRED',
      ]),
    )
    const context = { schoolId: SCHOOL, agentRunId: RUN }
    const body = { type: 'state' as const, title: 't', candidate: candidateFixture() }

    await expect(service.diagnosisPropose(context, body)).rejects.toBeInstanceOf(
      WritePlaneProtocolError,
    )
    const error = await service
      .diagnosisPropose(context, body)
      .then(() => null)
      .catch((thrown: unknown) => thrown as WritePlaneProtocolError)

    expect(error?.errors.map((item) => item.code)).toEqual([
      'ASSESSMENT_PROPOSED_CRITERION_REQUIRED',
      'ASSESSMENT_COUNTER_SEARCH_REQUIRED',
    ])
    expect(service.selfCorrectionRounds(RUN)).toBe(2)
    service.forgetRun(RUN)
    expect(service.selfCorrectionRounds(RUN)).toBe(0)
  })

  it('fills the school scope from the capability token, never from the payload', async () => {
    let seen: { schoolId?: string; candidate?: unknown } = {}
    const service = new WorkbenchWriteCapabilityService(
      repositoryStub(),
      gatewayStub({
        create: async (input) => {
          seen = { schoolId: input.schoolId, candidate: input.rawAssessmentCandidate }
          return {
            proposal: { id: 'p1', status: 'proposed' as const },
            claimIds: [],
            stageTargetIds: [],
            criteria: [],
          }
        },
      }),
    )

    await service.diagnosisPropose(
      { schoolId: SCHOOL, agentRunId: RUN },
      { type: 'state', title: 't', candidate: candidateFixture() },
    )
    expect(seen.schoolId).toBe(SCHOOL)
    expect((seen.candidate as { school: { schoolId: string } }).school).toEqual({
      kind: 'school',
      schoolId: SCHOOL,
    })
  })

  it('refuses a payload that names a different school', async () => {
    const service = new WorkbenchWriteCapabilityService(repositoryStub(), gatewayStub())
    await expect(
      service.evidenceRegister(
        { schoolId: SCHOOL, agentRunId: RUN },
        { ...validRegisterInput, schoolId: 'school-2' },
      ),
    ).rejects.toThrowError(/does not match the scoped school/u)
  })

  it('delegates a stage proposal to persistence under the scoped school', async () => {
    let command: StageProposalCommand | undefined
    const service = new WorkbenchWriteCapabilityService(
      repositoryStub({
        saveStageProposal: async (c) => {
          command = c
          return stageProposal
        },
      }),
      gatewayStub(),
    )
    const result = await service.stagePropose(
      { schoolId: SCHOOL, agentRunId: RUN },
      validStageProposalInput,
    )
    expect(result.stageId).toBe('stage-1')
    expect(result.status).toBe('planned')
    expect(result.targets).toHaveLength(5)
    expect(command?.schoolId).toBe(SCHOOL)
    expect(command?.agentRunId).toBe(RUN)
    expect(command?.input.title).toBe(validStageProposalInput.title)
  })

  it('refuses a stage proposal that names a different school', async () => {
    const service = new WorkbenchWriteCapabilityService(repositoryStub(), gatewayStub())
    await expect(
      service.stagePropose(
        { schoolId: SCHOOL, agentRunId: RUN },
        { ...validStageProposalInput, schoolId: 'school-2' },
      ),
    ).rejects.toThrowError(/does not match the scoped school/u)
  })

  it('refuses a stage proposal that misses a dimension target', async () => {
    const service = new WorkbenchWriteCapabilityService(repositoryStub(), gatewayStub())
    const withoutLeadership = {
      key_tasks: validStageProposalInput.targets.key_tasks,
      structure: validStageProposalInput.targets.structure,
      culture: validStageProposalInput.targets.culture,
      capability: validStageProposalInput.targets.capability,
    }
    await expect(
      service.stagePropose(
        { schoolId: SCHOOL, agentRunId: RUN },
        { ...validStageProposalInput, targets: withoutLeadership },
      ),
    ).rejects.toThrowError(/Capability input failed strict validation/u)
  })

  it('re-throws anything that is not a protocol rejection', async () => {
    const service = new WorkbenchWriteCapabilityService(
      repositoryStub(),
      gatewayStub({
        create: async () => {
          throw new Error('disk on fire')
        },
      }),
    )
    await expect(
      service.diagnosisPropose(
        { schoolId: SCHOOL, agentRunId: RUN },
        { type: 'state', title: 't', candidate: candidateFixture() },
      ),
    ).rejects.toThrowError(/disk on fire/u)
    expect(service.selfCorrectionRounds(RUN)).toBe(0)
  })
})

function candidateFixture() {
  return {
    protocolVersion: 1,
    claimRefs: ['claim-1'],
    criterionMappings: [
      { packKey: 'data-wise', version: '3', criterionId: 'DW.C2.PRACTICE_VISIBILITY', reason: 'r' },
    ],
    stageTargetRefs: ['target-1'],
    supportingFactRefs: ['fact-1'],
    counterFactRefs: [],
    counterEvidenceSearch: {
      completed: true,
      summary: '查过相反迹象。',
      searchedEvidenceRefs: ['e1'],
      searchedFactRefs: ['fact-1'],
    },
    interpretations: [
      { kind: 'interpretation', id: 'i1', summary: '解释。', factRefs: ['fact-1'] },
    ],
    provisionalJudgment: '暂定判断。',
    mechanism: null,
    alternativeHypotheses: ['另一种可能。'],
    unresolvedQuestions: [],
    recommendedActions: [],
    nextObservations: [],
    impactEvidencePlan: [],
    evidenceQuality: { directness: 'high', triangulation: 'single_source', limitations: [] },
    confidence: 'medium',
    status: 'proposed',
  }
}

async function callCapability(
  plane: WorkbenchLoopbackReadPlane,
  capability: string,
  token: string,
  body: unknown,
): Promise<Readonly<{ status: number; payload: Record<string, unknown> }>> {
  const response = await fetch(`${plane.endpoint ?? ''}/${capability}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-swb-school-id': SCHOOL,
      'x-swb-agent-run-id': RUN,
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> }
}

describe('loopback write routing', () => {
  it('serves the write capabilities and keeps the forbidden ones unroutable', async () => {
    const writeService = new WorkbenchWriteCapabilityService(repositoryStub(), gatewayStub())
    const plane = createWorkbenchReadPlaneBootstrap(readServiceStub(), { writeService })
    await plane.start()
    try {
      const grant = plane.issueToken({
        schoolId: SCHOOL,
        agentRunId: RUN,
        scopes: capabilityScopes,
      })

      const registered = await callCapability(
        plane,
        'evidence_register',
        grant.token,
        validRegisterInput,
      )
      expect(registered.status).toBe(200)
      expect(registered.payload.ok).toBe(true)

      const proposed = await callCapability(plane, 'diagnosis_propose', grant.token, {
        type: 'state',
        title: '判断',
        candidate: candidateFixture(),
      })
      expect(proposed.status).toBe(200)

      const stageProposed = await callCapability(
        plane,
        'stage_propose',
        grant.token,
        validStageProposalInput,
      )
      expect(stageProposed.status).toBe(200)
      expect((stageProposed.payload.data as { status: string }).status).toBe('planned')

      for (const forbidden of forbiddenCapabilityNames) {
        const refused = await callCapability(plane, forbidden, grant.token, {})
        expect(refused.status, forbidden).toBe(404)
        expect((refused.payload.error as { code: string }).code).toBe('CAPABILITY_NOT_FOUND')
      }
    } finally {
      await plane.stop()
    }
  })

  it('refuses a write with a read-only token', async () => {
    const writeService = new WorkbenchWriteCapabilityService(repositoryStub(), gatewayStub())
    const plane = createWorkbenchReadPlaneBootstrap(readServiceStub(), { writeService })
    await plane.start()
    try {
      const grant = plane.issueToken({ schoolId: SCHOOL, agentRunId: RUN, scopes: readScopes })
      for (const capability of writeCapabilityNames) {
        const refused = await callCapability(plane, capability, grant.token, validRegisterInput)
        expect(refused.status, capability).toBe(403)
        expect((refused.payload.error as { code: string }).code).toBe('AUTH_SCOPE_DENIED')
      }
      // The same token still reads.
      const read = await callCapability(plane, readCapabilityNames[0], grant.token, {})
      expect(read.status).toBe(200)
    } finally {
      await plane.stop()
    }
  })

  it('returns the protocol findings as a structured list (decision L5)', async () => {
    const writeService = new WorkbenchWriteCapabilityService(
      repositoryStub(),
      rejectingGateway(['ASSESSMENT_ABSTENTION_REQUIRED', 'ASSESSMENT_FACT_STANCE_MISMATCH']),
    )
    const plane = createWorkbenchReadPlaneBootstrap(readServiceStub(), { writeService })
    await plane.start()
    try {
      const grant = plane.issueToken({
        schoolId: SCHOOL,
        agentRunId: RUN,
        scopes: capabilityScopes,
      })
      const refused = await callCapability(plane, 'diagnosis_propose', grant.token, {
        type: 'state',
        title: '判断',
        candidate: candidateFixture(),
      })

      expect(refused.status).toBe(422)
      expect((refused.payload.error as { code: string }).code).toBe('ASSESSMENT_PROTOCOL_REJECTED')
      expect(refused.payload.errors).toEqual([
        {
          code: 'ASSESSMENT_ABSTENTION_REQUIRED',
          path: '$.candidate',
          message: 'ASSESSMENT_ABSTENTION_REQUIRED explained',
        },
        {
          code: 'ASSESSMENT_FACT_STANCE_MISMATCH',
          path: '$.candidate',
          message: 'ASSESSMENT_FACT_STANCE_MISMATCH explained',
        },
      ])
    } finally {
      await plane.stop()
    }
  })

  it('refuses cleanly when the write plane was never wired', async () => {
    const plane = createWorkbenchReadPlaneBootstrap(readServiceStub())
    await plane.start()
    try {
      const grant = plane.issueToken({
        schoolId: SCHOOL,
        agentRunId: RUN,
        scopes: capabilityScopes,
      })
      const refused = await callCapability(
        plane,
        'evidence_register',
        grant.token,
        validRegisterInput,
      )
      expect(refused.status).toBe(500)
      expect((refused.payload.error as { code: string }).code).toBe('INTERNAL')
    } finally {
      await plane.stop()
    }
  })
})
