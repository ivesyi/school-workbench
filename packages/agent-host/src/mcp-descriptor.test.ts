import { readScopes } from '@school-workbench/workbench-read-plane'
import { describe, expect, it } from 'vitest'
import { forbiddenAgentToolNames, readOnlyCapabilityScopes } from './contracts'
import {
  buildWorkbenchMcpDescriptor,
  descriptorEnvRecord,
  workbenchMcpServerName,
  type WorkbenchMcpDescriptorInput,
} from './mcp-descriptor'

const validInput: WorkbenchMcpDescriptorInput = {
  command: '/usr/local/bin/node',
  entryPath: '/repo/packages/workbench-mcp/dist/stdio.js',
  endpoint: 'http://127.0.0.1:52341/internal/v1',
  token: 'a'.repeat(43),
  schoolId: 'school-1',
  agentRunId: 'run-1',
}

describe('workbench MCP descriptor', () => {
  it('produces the stdio shape ACP expects with absolute paths', () => {
    const descriptor = buildWorkbenchMcpDescriptor(validInput)

    expect(descriptor.name).toBe(workbenchMcpServerName)
    expect(descriptor.command).toBe('/usr/local/bin/node')
    expect(descriptor.args).toEqual(['/repo/packages/workbench-mcp/dist/stdio.js'])
    expect(descriptorEnvRecord(descriptor)).toEqual({
      SWB_ENDPOINT: 'http://127.0.0.1:52341/internal/v1',
      SWB_TOKEN: 'a'.repeat(43),
      SWB_SCHOOL_ID: 'school-1',
      SWB_AGENT_RUN_ID: 'run-1',
    })
  })

  it('keeps the server name collision-proof and whitespace free', () => {
    // codex-acp only replaces whitespace when sanitising, and silently drops a
    // requested server whose sanitised name already exists in a Codex config
    // layer. A name that survives sanitising unchanged is the whole defence.
    expect(workbenchMcpServerName).not.toMatch(/\s/u)
    expect(workbenchMcpServerName.replace(/\s/gu, '_')).toBe(workbenchMcpServerName)
    expect(workbenchMcpServerName.length).toBeGreaterThan(24)
    expect(workbenchMcpServerName).toMatch(/^[A-Za-z0-9_-]+$/u)
    for (const plausible of ['codex', 'workbench', 'school-workbench', 'mcp', 'filesystem']) {
      expect(workbenchMcpServerName).not.toBe(plausible)
    }
  })

  it('carries extra environment before the bootstrap variables', () => {
    const descriptor = buildWorkbenchMcpDescriptor({
      ...validInput,
      extraEnv: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
    })
    expect(descriptor.env[0]).toEqual({ name: 'ELECTRON_RUN_AS_NODE', value: '1' })
    expect(descriptorEnvRecord(descriptor).ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it.each([
    ['relative command', { command: 'node' }],
    ['relative entry', { entryPath: 'dist/stdio.js' }],
    ['non loopback host', { endpoint: 'http://localhost:52341/internal/v1' }],
    ['https endpoint', { endpoint: 'https://127.0.0.1:52341/internal/v1' }],
    ['missing port', { endpoint: 'http://127.0.0.1/internal/v1' }],
    ['wrong path', { endpoint: 'http://127.0.0.1:52341/internal/v2' }],
    ['query string', { endpoint: 'http://127.0.0.1:52341/internal/v1?a=1' }],
    ['fragment', { endpoint: 'http://127.0.0.1:52341/internal/v1#x' }],
    ['credentials', { endpoint: 'http://u:p@127.0.0.1:52341/internal/v1' }],
    ['short token', { token: 'a'.repeat(31) }],
    ['token with punctuation', { token: `${'a'.repeat(42)}!` }],
    ['empty school', { schoolId: '   ' }],
    ['oversized run id', { agentRunId: 'r'.repeat(161) }],
    ['newline in run id', { agentRunId: 'run\n1' }],
  ])('fails closed on %s', (_label, override) => {
    expect(() => buildWorkbenchMcpDescriptor({ ...validInput, ...override })).toThrowError(
      /MCP|SWB_/u,
    )
  })

  it('only ever describes the frozen read scopes', () => {
    // SPEC 17 allows write scopes, but this slice must not be able to issue
    // them: the descriptor's scope vocabulary is the read set exactly.
    expect([...readOnlyCapabilityScopes]).toEqual([...readScopes])
    expect(readOnlyCapabilityScopes).not.toContain('evidence.register')
    expect(readOnlyCapabilityScopes).not.toContain('diagnosis.propose')
  })

  it('names the SPEC 25 tools that must never be reachable', () => {
    expect([...forbiddenAgentToolNames]).toEqual([
      'diagnosis_accept',
      'diagnosis_reject',
      'state_commit',
      'stage_activate',
    ])
  })
})
