const SBD_SYSTEM_ALIGNMENT = {
  packKey: 'schooling-by-design',
  version: '1',
  criterionId: 'SBD.C4.SYSTEM_ALIGNMENT',
} as const

const DATA_WISE_PRACTICE_VISIBILITY = {
  packKey: 'data-wise',
  version: '3',
  criterionId: 'DW.C2.PRACTICE_VISIBILITY',
} as const

type CriterionRef = Readonly<{
  packKey: string
  version: string
  criterionId: string
}>

function baseInput(
  schoolId: string,
  criterionRef: CriterionRef | null,
  evidenceText = '合成材料：项目组记录到一项可观察的学校实践。',
) {
  return {
    protocolVersion: 1,
    school: { kind: 'school', schoolId },
    activeStage: {
      id: `${schoolId}-stage-1`,
      schoolId,
      title: '合成阶段一',
      status: 'active',
    },
    confirmedStageTargets: [
      {
        id: `${schoolId}-target-1`,
        stageId: `${schoolId}-stage-1`,
        schoolId,
        dimensionKey: 'key_tasks',
        title: '形成可观察的工作协同',
        description: '用合成记录检查关键任务与协同是否发生。',
        status: 'confirmed',
      },
    ],
    evidence: [
      {
        kind: 'evidence',
        id: `${schoolId}-e1`,
        schoolId,
        sourceType: 'pasted_text',
        title: '合成会议记录',
        uri: null,
        inlineText: evidenceText,
        locator: 'synthetic:meeting-note:1',
        capturedAt: '2026-08-01T09:00:00.000Z',
      },
    ],
    observationFacts: [
      {
        kind: 'observation_fact',
        id: `${schoolId}-f1`,
        schoolId,
        evidenceId: `${schoolId}-e1`,
        factType: 'organization',
        text: '三个工作组在同一周计划中使用同一目标，并记录各自依赖的交付条件。',
        locator: 'synthetic:meeting-note:fact-1',
        directness: 'high',
      },
    ],
    claims: [
      {
        kind: 'claim',
        id: `${schoolId}-c1`,
        schoolId,
        statement: '当前协同安排与阶段目标之间存在可核查的对齐关系。',
        predicateKey: 'synthetic:alignment',
        scope: { kind: 'school', schoolId },
      },
    ],
    claimFacts: [{ claimId: `${schoolId}-c1`, factId: `${schoolId}-f1`, stance: 'supporting' }],
    methodologyContext: criterionRef ? [criterionRef] : [],
  }
}

function baseCandidate(
  schoolId: string,
  criterionRef: CriterionRef | null,
  provisionalJudgment = '现有合成事实支持一个暂定的对齐判断。',
) {
  return {
    protocolVersion: 1,
    school: { kind: 'school', schoolId },
    criterionMappings: criterionRef
      ? [
          {
            ...criterionRef,
            reason: '该稳定 Criterion 与当前需要核查的实践关系直接对应。',
          },
        ]
      : [],
    stageTargetRefs: [`${schoolId}-target-1`],
    supportingFactRefs: [`${schoolId}-f1`],
    counterFactRefs: [],
    counterEvidenceSearch: {
      completed: true,
      summary: '已检查当前输入中的全部合成事实及其 ClaimFact stance，未发现已登记的相反事实。',
      searchedEvidenceRefs: [`${schoolId}-e1`],
      searchedFactRefs: [`${schoolId}-f1`],
    },
    interpretations: [
      {
        kind: 'interpretation',
        id: `${schoolId}-i1`,
        summary: '该观察可以解释为当前协同机制与阶段目标形成了可追溯联系。',
        factRefs: [`${schoolId}-f1`],
      },
    ],
    provisionalJudgment,
    mechanism: '共同目标与显式依赖让跨组行动更容易保持一致。',
    alternativeHypotheses: ['现有一致性也可能只是短期项目协调，而非稳定机制。'],
    unresolvedQuestions: ['这种对齐是否能在下一轮工作中持续出现？'],
    recommendedActions: ['保留当前协同记录方式，并在下一轮复盘中核对偏差。'],
    nextObservations: ['观察下一轮跨组计划是否仍显式记录共同目标与依赖。'],
    impactEvidencePlan: ['比较下一轮交付前后的依赖阻塞记录与学习任务变化。'],
    evidenceQuality: {
      directness: 'high',
      triangulation: 'single_source',
      limitations: ['当前仅有一类合成会议记录。'],
    },
    confidence: 'medium',
    status: 'proposed',
  }
}

function goldenCase(
  id: string,
  title: string,
  contextProfile: string,
  input: unknown,
  candidate: unknown,
  expected: {
    validationOutcome: 'pass' | 'fail'
    errorCodes: readonly string[]
    substantiveReviewStatus: 'pending_review' | 'not_applicable'
  },
) {
  return {
    schemaVersion: 1,
    id,
    title,
    materialPolicy: 'synthetic_only',
    contextProfile,
    input,
    candidate,
    expected,
  }
}

const sbdSchool = 'school-sbd-synthetic'
const dataWiseSchool = 'school-dw-synthetic'

const dataWiseInput = baseInput(
  dataWiseSchool,
  DATA_WISE_PRACTICE_VISIBILITY,
  '合成材料：教研组同时查看课堂任务产物、简短自述和观察记录。',
)
const dataWiseFact = dataWiseInput.observationFacts[0]
const dataWiseClaim = dataWiseInput.claims[0]
if (!dataWiseFact || !dataWiseClaim) throw new Error('Synthetic Data Wise fixture is incomplete')
dataWiseInput.observationFacts[0] = {
  ...dataWiseFact,
  factType: 'adult_practice',
  text: '教研组把课堂任务产物、自述和一次观察记录并列查看，再讨论实际发生的教学互动。',
}
dataWiseInput.claims[0] = {
  ...dataWiseClaim,
  statement: '团队当前能够用多类可观察材料讨论成人实践。',
  predicateKey: 'synthetic:practice_visibility',
}

const counterSchool = 'school-counter-synthetic'
const counterInput = baseInput(counterSchool, SBD_SYSTEM_ALIGNMENT)
counterInput.observationFacts.push({
  kind: 'observation_fact',
  id: `${counterSchool}-f2`,
  schoolId: counterSchool,
  evidenceId: `${counterSchool}-e1`,
  factType: 'organization',
  text: '另一个工作组仍使用独立目标，且未记录与其他组的依赖。',
  locator: 'synthetic:meeting-note:fact-2',
  directness: 'high',
})
counterInput.claimFacts.push({
  claimId: `${counterSchool}-c1`,
  factId: `${counterSchool}-f2`,
  stance: 'counter',
})
const counterCandidate = baseCandidate(counterSchool, SBD_SYSTEM_ALIGNMENT)
counterCandidate.counterEvidenceSearch.searchedFactRefs.push(`${counterSchool}-f2`)

const vagueSchool = 'school-vague-synthetic'
const vagueInput = baseInput(
  vagueSchool,
  null,
  '合成材料：顾问只收到一句“最近协作不太顺”，没有可定位的观察事实。',
)
vagueInput.observationFacts = []
vagueInput.claims = []
vagueInput.claimFacts = []
const vagueCandidate = {
  protocolVersion: 1,
  school: { kind: 'school', schoolId: vagueSchool },
  criterionMappings: [],
  stageTargetRefs: [],
  supportingFactRefs: [],
  counterFactRefs: [],
  counterEvidenceSearch: {
    completed: false,
    summary: '当前没有足够事实完成反证搜索。',
    searchedEvidenceRefs: [`${vagueSchool}-e1`],
    searchedFactRefs: [],
  },
  interpretations: [],
  provisionalJudgment: null,
  mechanism: null,
  alternativeHypotheses: [],
  unresolvedQuestions: ['“协作不顺”具体发生在哪个任务、角色和时间点？'],
  recommendedActions: [],
  nextObservations: ['收集一次可定位的跨组协作记录并区分事实与解释。'],
  impactEvidencePlan: [],
  evidenceQuality: {
    directness: 'low',
    triangulation: 'single_source',
    limitations: ['只有一句模糊描述。'],
  },
  confidence: 'low',
  status: 'insufficient_evidence',
}

const confusionSchool = 'school-confusion-synthetic'
const confusionInput = baseInput(confusionSchool, SBD_SYSTEM_ALIGNMENT)
const confusionInputWithInterpretation = {
  ...confusionInput,
  observationFacts: [
    {
      kind: 'interpretation',
      id: `${confusionSchool}-i-as-fact`,
      summary: '这是解释，不是可观察事实。',
      factRefs: [],
    },
  ],
}

const scopeSchool = 'school-scope-synthetic'
const scopeInput = baseInput(scopeSchool, SBD_SYSTEM_ALIGNMENT)
const scopeFact = scopeInput.observationFacts[0]
if (!scopeFact) throw new Error('Synthetic scope fixture is incomplete')
scopeInput.activeStage.schoolId = 'other-school'
scopeInput.observationFacts[0] = {
  ...scopeFact,
  evidenceId: 'missing-evidence',
}

const wrongVersion = {
  packKey: 'schooling-by-design',
  version: '99',
  criterionId: 'SBD.C4.SYSTEM_ALIGNMENT',
} as const

const versionMismatchSchool = 'school-version-mismatch-synthetic'
const versionMismatchCandidate = baseCandidate(versionMismatchSchool, SBD_SYSTEM_ALIGNMENT)
const versionMismatchMapping = versionMismatchCandidate.criterionMappings[0]
if (!versionMismatchMapping) throw new Error('Synthetic version fixture is incomplete')
versionMismatchCandidate.criterionMappings[0] = {
  ...versionMismatchMapping,
  version: '2',
}

export const syntheticGoldenSuite = {
  schemaVersion: 1,
  cases: [
    goldenCase(
      'sbd-system-alignment-proposed',
      'SBD system alignment protocol-valid proposed candidate',
      'active',
      baseInput(sbdSchool, SBD_SYSTEM_ALIGNMENT),
      baseCandidate(sbdSchool, SBD_SYSTEM_ALIGNMENT),
      { validationOutcome: 'pass', errorCodes: [], substantiveReviewStatus: 'pending_review' },
    ),
    goldenCase(
      'data-wise-practice-visibility-proposed',
      'Data Wise practice visibility protocol-valid proposed candidate',
      'active',
      dataWiseInput,
      baseCandidate(
        dataWiseSchool,
        DATA_WISE_PRACTICE_VISIBILITY,
        '现有合成事实支持“成人实践已具有可观察入口”的暂定判断。',
      ),
      { validationOutcome: 'pass', errorCodes: [], substantiveReviewStatus: 'pending_review' },
    ),
    goldenCase(
      'counter-fact-omitted',
      'Known counter fact cannot be omitted',
      'active',
      counterInput,
      counterCandidate,
      {
        validationOutcome: 'fail',
        errorCodes: ['ASSESSMENT_COUNTER_FACT_OMITTED'],
        substantiveReviewStatus: 'not_applicable',
      },
    ),
    goldenCase(
      'single-vague-input-abstains',
      'Single vague input abstains instead of forcing a judgment',
      'active',
      vagueInput,
      vagueCandidate,
      { validationOutcome: 'pass', errorCodes: [], substantiveReviewStatus: 'not_applicable' },
    ),
    goldenCase(
      'observation-interpretation-confusion',
      'Interpretation cannot masquerade as ObservationFact',
      'active',
      confusionInputWithInterpretation,
      baseCandidate(confusionSchool, SBD_SYSTEM_ALIGNMENT),
      {
        validationOutcome: 'fail',
        errorCodes: ['ASSESSMENT_FACT_INTERPRETATION_CONFUSION'],
        substantiveReviewStatus: 'not_applicable',
      },
    ),
    goldenCase(
      'wrong-school-and-dangling-ref',
      'Wrong school scope and dangling Evidence ref fail closed',
      'active',
      scopeInput,
      baseCandidate(scopeSchool, SBD_SYSTEM_ALIGNMENT),
      {
        validationOutcome: 'fail',
        errorCodes: ['ASSESSMENT_SCHOOL_SCOPE_MISMATCH', 'ASSESSMENT_EVIDENCE_REF_DANGLING'],
        substantiveReviewStatus: 'not_applicable',
      },
    ),
    goldenCase(
      'review-pack-rejected',
      'Production validator rejects review methodology pack',
      'review',
      baseInput('school-review-pack-synthetic', SBD_SYSTEM_ALIGNMENT),
      baseCandidate('school-review-pack-synthetic', SBD_SYSTEM_ALIGNMENT),
      {
        validationOutcome: 'fail',
        errorCodes: ['ASSESSMENT_METHODOLOGY_PACK_NOT_ACTIVE'],
        substantiveReviewStatus: 'not_applicable',
      },
    ),
    goldenCase(
      'retired-pack-rejected',
      'Production validator rejects retired methodology pack',
      'retired',
      baseInput('school-retired-pack-synthetic', SBD_SYSTEM_ALIGNMENT),
      baseCandidate('school-retired-pack-synthetic', SBD_SYSTEM_ALIGNMENT),
      {
        validationOutcome: 'fail',
        errorCodes: ['ASSESSMENT_METHODOLOGY_PACK_NOT_ACTIVE'],
        substantiveReviewStatus: 'not_applicable',
      },
    ),
    goldenCase(
      'wrong-pack-version-rejected',
      'Wrong methodology pack version fails exact resolution',
      'active',
      baseInput('school-wrong-version-synthetic', wrongVersion),
      baseCandidate('school-wrong-version-synthetic', wrongVersion),
      {
        validationOutcome: 'fail',
        errorCodes: ['ASSESSMENT_METHODOLOGY_PACK_NOT_FOUND'],
        substantiveReviewStatus: 'not_applicable',
      },
    ),
    goldenCase(
      'criterion-version-mismatch-rejected',
      'Candidate criterion mapping must match exact input pack version',
      'two_active_versions',
      baseInput(versionMismatchSchool, SBD_SYSTEM_ALIGNMENT),
      versionMismatchCandidate,
      {
        validationOutcome: 'fail',
        errorCodes: ['ASSESSMENT_CRITERION_MAPPING_NOT_IN_CONTEXT'],
        substantiveReviewStatus: 'not_applicable',
      },
    ),
  ],
} as const
