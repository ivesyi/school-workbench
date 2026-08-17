import { describe, expect, it } from 'vitest'
import { assistantReadiness, describeOutcome, nextProgressPhase } from './agent-runtime'

describe('high-level progress (PRD 16)', () => {
  it('follows what the assistant actually did, in order', () => {
    let phase = nextProgressPhase(null, 'school_context')
    expect(phase).toBe('understanding')
    phase = nextProgressPhase(phase, 'standards_get')
    expect(phase).toBe('gathering')
    phase = nextProgressPhase(phase, 'state_history')
    expect(phase).toBe('comparing')
    phase = nextProgressPhase(phase, 'diagnosis_propose')
    expect(phase).toBe('drafting')
  })

  it('never appears to go backwards', () => {
    // An assistant re-reads the school half way through all the time; the
    // consultant should not watch the wording rewind.
    expect(nextProgressPhase('drafting', 'school_context')).toBeNull()
    expect(nextProgressPhase('comparing', 'standards_get')).toBeNull()
    expect(nextProgressPhase('gathering', 'stage_current')).toBeNull()
    expect(nextProgressPhase('gathering', 'evidence_list')).toBeNull()
  })

  it('ignores anything that is not a workbench tool', () => {
    for (const tool of ['shell', 'web_search', 'apply_patch', 'read_file', '']) {
      expect(nextProgressPhase(null, tool), tool).toBeNull()
    }
  })
})

describe('what the consultant is told happened', () => {
  it('reports a judgement whenever one was submitted', () => {
    expect(describeOutcome('completed', 'proposal')).toBe('proposal_ready')
    // Even a run that ended badly afterwards: the judgement is already recorded
    // and reviewable, so hiding it would lose real work.
    expect(describeOutcome('failed', 'proposal')).toBe('proposal_ready')
    expect(describeOutcome('cancelled', 'proposal')).toBe('proposal_ready')
  })

  it('keeps an explicit abstention distinct from silence', () => {
    expect(describeOutcome('completed', 'insufficient_evidence')).toBe('needs_more_evidence')
    expect(describeOutcome('completed', 'none')).toBe('no_new_judgment')
  })

  it('reports a failure only when nothing was submitted and the run did not finish', () => {
    expect(describeOutcome('failed', 'none')).toBe('failed')
    expect(describeOutcome('cancelled', 'none')).toBe('failed')
  })
})

describe('whether an assistant can start on this computer', () => {
  it('explains a missing runtime without naming a package', () => {
    const answer = assistantReadiness('/nowhere/out/main', {
      SWB_WORKBENCH_MCP_ENTRY: '/nowhere/missing.js',
    })
    expect(answer.ready).toBe(false)
    expect(answer.detail).not.toBeNull()
    for (const word of ['ACP', 'MCP', 'codex-acp', 'node_modules', 'stdio']) {
      expect(answer.detail ?? '', word).not.toContain(word)
    }
  })

  it('is ready when both spawned artifacts are present', () => {
    // The real repository layout: this is the same resolution the run itself
    // uses, so a "ready" here means a run gets at least as far as starting.
    expect(assistantReadiness('apps/desktop/out/main').ready).toBe(true)
  })
})
