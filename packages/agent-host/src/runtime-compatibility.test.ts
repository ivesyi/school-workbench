import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assessRuntimeCompatibility } from './runtime-compatibility'

const initialized = {
  protocolVersion: 1,
  agentCapabilities: { loadSession: true },
  agentInfo: { name: 'codex-acp', version: '1.4.0' },
}

describe('runtime compatibility (SPEC 62)', () => {
  it('reports verified when handshake, capabilities and contract test all pass', () => {
    const assessment = assessRuntimeCompatibility({
      requestedProtocolVersion: 1,
      initializeResponse: initialized,
      contractTest: 'passed',
    })
    expect(assessment.compatibility).toBe('verified')
    expect(assessment.protocolVersion).toBe(1)
    expect(assessment.agentName).toBe('codex-acp')
    expect(assessment.agentVersion).toBe('1.4.0')
    expect(assessment.missingCapabilities).toEqual([])
  })

  it('reports compatible when no contract test was run', () => {
    expect(
      assessRuntimeCompatibility({
        requestedProtocolVersion: 1,
        initializeResponse: initialized,
        contractTest: 'skipped',
      }).compatibility,
    ).toBe('compatible')
  })

  it('reports unsupported for a protocol the workbench does not speak', () => {
    const assessment = assessRuntimeCompatibility({
      requestedProtocolVersion: 1,
      initializeResponse: { ...initialized, protocolVersion: 2 },
      contractTest: 'passed',
    })
    expect(assessment.compatibility).toBe('unsupported')
    expect(assessment.detail).toContain('protocol version 2')
  })

  it('reports unsupported when initialize answered nothing usable', () => {
    for (const response of [null, undefined, {}, 'nope', { protocolVersion: '1' }]) {
      expect(
        assessRuntimeCompatibility({
          requestedProtocolVersion: 1,
          initializeResponse: response,
          contractTest: 'passed',
        }).compatibility,
      ).toBe('unsupported')
    }
  })

  it('reports unsupported when the runtime disclaims MCP', () => {
    // SPEC 8: there is no compatibility mode for a runtime without MCP.
    const assessment = assessRuntimeCompatibility({
      requestedProtocolVersion: 1,
      initializeResponse: { protocolVersion: 1, agentCapabilities: { mcp: false } },
      contractTest: 'passed',
    })
    expect(assessment.compatibility).toBe('unsupported')
    expect(assessment.missingCapabilities).toEqual(['agentCapabilities.mcp'])
  })

  it('reports unsupported when the contract test failed', () => {
    expect(
      assessRuntimeCompatibility({
        requestedProtocolVersion: 1,
        initializeResponse: initialized,
        contractTest: 'failed',
      }).compatibility,
    ).toBe('unsupported')
  })

  it('does not branch on a hard-coded runtime version anywhere', () => {
    // SPEC 62: "不依赖硬编码版本". The verdict must come from the handshake and
    // a real capability probe, never from a version literal.
    const source = readFileSync(resolve('packages/agent-host/src/runtime-compatibility.ts'), 'utf8')
    expect(source).not.toMatch(/['"`]1\.4\.0['"`]/u)
    expect(source).not.toMatch(/agentVersion\s*===/u)
    expect(source).not.toMatch(/agentName\s*===/u)
  })
})
