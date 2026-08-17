import { Client } from '@modelcontextprotocol/client'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { GroundedDiagnosisService } from '@school-workbench/application'
import {
  loadMethodologyRegistry,
  MethodologyRegistry,
  type MethodologyPack,
} from '@school-workbench/methodology'
import {
  capabilityScopes,
  createWorkbenchReadPlaneBootstrap,
  WorkbenchReadCapabilityService,
  WorkbenchWriteCapabilityService,
} from '@school-workbench/workbench-read-plane'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, type WorkbenchDatabase } from './database'
import { SqliteGroundedDiagnosisRepository } from './sqlite-grounded-diagnosis-repository'
import { SqliteMethodologyRepository } from './sqlite-methodology-repository'
import { SqliteReadPlaneRepository } from './sqlite-read-plane-repository'
import { SqliteWritePlaneRepository } from './sqlite-write-plane-repository'

/**
 * The full workbench side of the chain, with nothing stubbed: the real MCP
 * server binary over real stdio, the real loopback with real capability tokens,
 * the real assessment gate, and a real SQLite database.
 *
 * The only thing missing is Codex itself, which cannot be exercised without
 * credentials and money. This test is what says "everything up to the agent
 * works"; it is not a substitute for the manual Codex verification.
 */
const migrationsFolder = resolve('packages/db/drizzle')
const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')
const NOW = '2026-08-18T00:00:00.000Z'
const SCHOOL = 'school-1'
const RUN = 'run-1'

let bundleDirectory = ''
let serverEntry = ''

beforeAll(async () => {
  bundleDirectory = mkdtempSync(join(tmpdir(), 'workbench-write-mcp-'))
  serverEntry = join(bundleDirectory, 'stdio.js')
  await build({
    entryPoints: [resolve('packages/workbench-mcp/src/stdio.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: serverEntry,
    logLevel: 'silent',
  })
}, 60_000)

afterAll(() => {
  if (bundleDirectory) rmSync(bundleDirectory, { recursive: true, force: true })
})

function activeRegistry(): MethodologyRegistry {
  const base = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
  return new MethodologyRegistry(
    base.listPacks().map((pack) => ({ ...pack, status: 'active' }) as MethodologyPack),
  )
}

function seed(database: WorkbenchDatabase): void {
  database.client
    .prepare('INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)')
    .run(SCHOOL, '南山实验学校', NOW)
  database.client
    .prepare(
      `INSERT INTO stages (id, school_id, title, summary, focus, sequence, status, starts_at,
                           ends_at, adjustment_feedback, created_at, updated_at)
       VALUES ('stage-1', ?, '阶段一', '建立共同推动改进的组织基础', '结构与机制', 1, 'active', ?, NULL, NULL, ?, ?)`,
    )
    .run(SCHOOL, NOW, NOW, NOW)
  database.client
    .prepare(
      `INSERT INTO stage_targets (id, stage_id, school_id, dimension_key, title, description,
                                  status, sequence, created_at, updated_at)
       VALUES ('target-1', 'stage-1', ?, 'structure', '让改进实践变得可见',
               '教研与课堂实践能够被同伴看见。', 'confirmed', 1, ?, ?)`,
    )
    .run(SCHOOL, NOW, NOW)
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const block = result.content.find((item) => item.type === 'text')
  if (!block || block.type !== 'text') throw new Error('expected a text tool result')
  return block.text
}

describe('workbench write plane over real MCP stdio', () => {
  it('registers grounds and turns them into a proposal awaiting human review', async () => {
    const database = openWorkbenchDatabase(':memory:', migrationsFolder)
    const registry = activeRegistry()
    await new SqliteMethodologyRepository(database.db).syncRegistry(registry)
    seed(database)

    const plane = createWorkbenchReadPlaneBootstrap(
      new WorkbenchReadCapabilityService(
        new SqliteReadPlaneRepository(database),
        registry,
        new SqliteMethodologyRepository(database.db),
      ),
      {
        writeService: new WorkbenchWriteCapabilityService(
          new SqliteWritePlaneRepository(database, registry),
          new GroundedDiagnosisService(
            registry,
            new SqliteGroundedDiagnosisRepository(database.db),
          ),
        ),
      },
    )
    const endpoint = await plane.start()
    const grant = plane.issueToken({
      schoolId: SCHOOL,
      agentRunId: RUN,
      scopes: capabilityScopes,
    })

    const client = new Client({ name: 'write-plane-test', version: '1.0.0' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: {
        ...getDefaultEnvironment(),
        SWB_ENDPOINT: endpoint,
        SWB_TOKEN: grant.token,
        SWB_SCHOOL_ID: SCHOOL,
        SWB_AGENT_RUN_ID: RUN,
      },
      stderr: 'pipe',
    })
    await client.connect(transport)

    try {
      const registered = await client.callTool({
        name: 'evidence_register',
        arguments: {
          sourceType: 'observation',
          title: '九月教研观察记录',
          inlineText: '教研组把三节课的课堂记录贴到了公共墙上。\n其他年级也来看。',
          locator: 'p.1',
          observationFacts: [
            {
              ref: 'f1',
              factType: 'organization',
              text: '教研组把三节课的课堂记录贴到公共墙上。',
              locator: 'p.1 段2',
              directness: 'high',
            },
          ],
          claims: [
            {
              ref: 'c1',
              statement: '这所学校的改进实践已经开始在公共空间被同伴看见。',
              facts: [{ factRef: 'f1', stance: 'supporting' }],
            },
          ],
        },
      })
      expect(registered.isError).not.toBe(true)
      const registration = JSON.parse(textOf(registered)) as {
        evidenceId: string
        observationFacts: Array<{ ref: string; id: string }>
        claims: Array<{ ref: string; id: string }>
      }
      const factId = registration.observationFacts[0]?.id ?? ''
      const claimId = registration.claims[0]?.id ?? ''
      expect(factId).not.toBe('')
      expect(claimId).not.toBe('')

      const proposed = await client.callTool({
        name: 'diagnosis_propose',
        arguments: {
          type: 'state',
          title: '改进实践开始可见',
          candidate: {
            protocolVersion: 1,
            claimRefs: [claimId],
            criterionMappings: [
              {
                packKey: 'data-wise',
                version: '3',
                criterionId: 'DW.C2.PRACTICE_VISIBILITY',
                reason: '公共墙上的课堂记录正对应实践可见性这条准则。',
              },
            ],
            stageTargetRefs: ['target-1'],
            supportingFactRefs: [factId],
            counterFactRefs: [],
            counterEvidenceSearch: {
              completed: true,
              summary: '查了同一份记录里是否有相反迹象，没有发现。',
              searchedEvidenceRefs: [registration.evidenceId],
              searchedFactRefs: [factId],
            },
            interpretations: [
              {
                kind: 'interpretation',
                id: 'i1',
                summary: '贴到公共空间意味着实践开始可被同伴检视。',
                factRefs: [factId],
              },
            ],
            provisionalJudgment: '改进实践已经开始可见，但还只发生在一个教研组。',
            mechanism: null,
            alternativeHypotheses: ['也可能只是这一次公开课的临时安排。'],
            unresolvedQuestions: [],
            recommendedActions: [],
            nextObservations: ['下月再看一次公共墙是否仍在更新。'],
            impactEvidencePlan: [],
            evidenceQuality: {
              directness: 'high',
              triangulation: 'single_source',
              limitations: ['只有一份观察记录。'],
            },
            confidence: 'medium',
            status: 'proposed',
          },
        },
      })
      expect(proposed.isError).not.toBe(true)
      const proposal = JSON.parse(textOf(proposed)) as { proposalId: string; status: string }
      expect(proposal.status).toBe('proposed')

      const stored = database.client
        .prepare('SELECT status, agent_run_id, school_id FROM diagnosis_proposals WHERE id = ?')
        .get(proposal.proposalId) as {
        status: string
        agent_run_id: string
        school_id: string
      }
      expect(stored).toEqual({ status: 'proposed', agent_run_id: RUN, school_id: SCHOOL })

      // It is a proposal, not a judgement: only a human review can make it one.
      const accepted = database.client
        .prepare('SELECT count(*) AS count FROM accepted_judgments')
        .get() as { count: number }
      expect(accepted.count).toBe(0)
    } finally {
      await client.close()
      await plane.stop()
      database.close()
    }
  }, 30_000)

  it('hands a refused candidate back as a list of findings, and writes nothing', async () => {
    const database = openWorkbenchDatabase(':memory:', migrationsFolder)
    const registry = activeRegistry()
    await new SqliteMethodologyRepository(database.db).syncRegistry(registry)
    seed(database)

    const writeService = new WorkbenchWriteCapabilityService(
      new SqliteWritePlaneRepository(database, registry),
      new GroundedDiagnosisService(registry, new SqliteGroundedDiagnosisRepository(database.db)),
    )
    const plane = createWorkbenchReadPlaneBootstrap(
      new WorkbenchReadCapabilityService(
        new SqliteReadPlaneRepository(database),
        registry,
        new SqliteMethodologyRepository(database.db),
      ),
      { writeService },
    )
    const endpoint = await plane.start()
    const grant = plane.issueToken({
      schoolId: SCHOOL,
      agentRunId: RUN,
      scopes: capabilityScopes,
    })

    const client = new Client({ name: 'write-plane-test', version: '1.0.0' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: {
        ...getDefaultEnvironment(),
        SWB_ENDPOINT: endpoint,
        SWB_TOKEN: grant.token,
        SWB_SCHOOL_ID: SCHOOL,
        SWB_AGENT_RUN_ID: RUN,
      },
      stderr: 'pipe',
    })
    await client.connect(transport)

    try {
      // A judgement with no grounds at all: nothing registered, nothing cited.
      const refused = await client.callTool({
        name: 'diagnosis_propose',
        arguments: {
          type: 'state',
          title: '凭印象下的判断',
          candidate: {
            protocolVersion: 1,
            claimRefs: [],
            criterionMappings: [],
            stageTargetRefs: [],
            supportingFactRefs: [],
            counterFactRefs: [],
            counterEvidenceSearch: {
              completed: true,
              summary: '看了一下。',
              searchedEvidenceRefs: [],
              searchedFactRefs: [],
            },
            interpretations: [],
            provisionalJudgment: '这所学校的改进实践已经很可见了。',
            mechanism: null,
            alternativeHypotheses: [],
            unresolvedQuestions: [],
            recommendedActions: [],
            nextObservations: [],
            impactEvidencePlan: [],
            evidenceQuality: {
              directness: 'low',
              triangulation: 'single_source',
              limitations: [],
            },
            confidence: 'high',
            status: 'proposed',
          },
        },
      })

      expect(refused.isError).toBe(true)
      const payload = JSON.parse(textOf(refused)) as {
        code: string
        errors?: Array<{ code: string; path: string; message: string }>
      }
      expect(payload.code).toBe('ASSESSMENT_PROTOCOL_REJECTED')
      // Decision L5: the findings reach the Agent intact, not folded into one line.
      expect(payload.errors?.length ?? 0).toBeGreaterThan(1)
      const codes = payload.errors?.map((item) => item.code) ?? []
      expect(codes).toContain('ASSESSMENT_PROPOSED_CLAIM_REQUIRED')
      expect(codes).toContain('ASSESSMENT_PROPOSED_CRITERION_REQUIRED')
      expect(codes).toContain('ASSESSMENT_ABSTENTION_REQUIRED')
      expect(payload.errors?.every((item) => item.path.length > 0)).toBe(true)

      const proposals = database.client
        .prepare('SELECT count(*) AS count FROM diagnosis_proposals')
        .get() as { count: number }
      expect(proposals.count).toBe(0)
      expect(writeService.selfCorrectionRounds(RUN)).toBe(1)
    } finally {
      await client.close()
      await plane.stop()
      database.close()
    }
  }, 30_000)
})
