import { describe, expect, it } from 'vitest'
import {
  capabilityNames,
  capabilityScope,
  capabilityScopes,
  forbiddenCapabilityNames,
  forbiddenScopes,
} from './contracts'

/**
 * What an Agent must never be able to reach, named one by one.
 *
 * The four capabilities and `human.review` are the acts that turn a proposal
 * into part of a school's formal record. They belong to a person. Other tests
 * check the routing and the live MCP surface; this one is the plain statement
 * that each of these five names is on the forbidden side and on no other.
 */
const NEVER_REACHABLE = [
  { capability: 'diagnosis_accept', scope: 'diagnosis.approve' },
  { capability: 'diagnosis_reject', scope: 'diagnosis.reject' },
  { capability: 'state_commit', scope: 'state.commit' },
  { capability: 'stage_activate', scope: 'stage.activate' },
  { capability: null, scope: 'human.review' },
] as const

describe('acts an agent may never perform', () => {
  it.each(NEVER_REACHABLE)('keeps $scope out of reach', ({ capability, scope }) => {
    expect((forbiddenScopes as readonly string[]).includes(scope)).toBe(true)
    expect((capabilityScopes as readonly string[]).includes(scope)).toBe(false)
    expect(Object.values(capabilityScope)).not.toContain(scope)

    if (capability === null) return
    expect((forbiddenCapabilityNames as readonly string[]).includes(capability)).toBe(true)
    expect((capabilityNames as readonly string[]).includes(capability)).toBe(false)
    expect(Object.hasOwn(capabilityScope, capability)).toBe(false)
  })

  it('lists no other forbidden name, so the set stays reviewable', () => {
    expect([...forbiddenCapabilityNames].sort()).toEqual([
      'diagnosis_accept',
      'diagnosis_reject',
      'stage_activate',
      'state_commit',
    ])
    expect([...forbiddenScopes].sort()).toEqual([
      'diagnosis.approve',
      'diagnosis.reject',
      'human.review',
      'stage.activate',
      'state.commit',
    ])
  })
})
