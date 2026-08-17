import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { AgentHostError } from './contracts'

export type AcpRuntimeConnection = Readonly<{
  /** Bidirectional ACP message stream. */
  stream: Stream
  /** Human readable description used in diagnostics. Never contains secrets. */
  describe: string
  /** Most recent stderr output from the runtime, bounded. */
  recentStderr(): string
  close(): Promise<void>
}>

/**
 * Seam between the Agent Host lifecycle and the process that actually speaks
 * ACP. Production uses {@link CodexAcpRuntimeLauncher}; tests connect the host
 * to an in-process ACP agent through the same interface.
 */
export interface AcpRuntimeLauncher {
  readonly describe: string
  launch(): Promise<AcpRuntimeConnection>
}

const STDERR_BUFFER_LIMIT = 8 * 1024

export type CodexAcpLauncherInput = Readonly<{
  /** Absolute path to the `codex-acp` entry point. */
  entryPath: string
  /**
   * Executable used to run it. In Electron this is `process.execPath` together
   * with `ELECTRON_RUN_AS_NODE=1`, so no separate Node install is required.
   */
  execPath: string
  /**
   * Absolute path to the consultant's own `codex` binary, if one was found.
   * SPEC 12 prefers the system Codex; when this is null, codex-acp falls back
   * to the copy it vendors.
   */
  systemCodexPath: string | null
  /** Base environment for the child process. */
  environment: NodeJS.ProcessEnv
  /** Working directory for the bridge process. */
  cwd: string
}>

/**
 * Builds the child environment.
 *
 * The workbench never touches the Codex authorization surface: it does not read
 * or write `~/.codex/auth.json`, never rewrites `~/.codex/config.toml`, and
 * never sets `CODEX_API_KEY` / `OPENAI_API_KEY`. The only Codex-facing variable
 * it sets is `CODEX_PATH`, which selects *which* already-installed binary to
 * drive.
 */
export function buildCodexAcpEnvironment(
  input: Readonly<{ environment: NodeJS.ProcessEnv; systemCodexPath: string | null }>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...input.environment, ELECTRON_RUN_AS_NODE: '1' }
  if (input.systemCodexPath) environment.CODEX_PATH = input.systemCodexPath
  return environment
}

export class CodexAcpRuntimeLauncher implements AcpRuntimeLauncher {
  constructor(private readonly input: CodexAcpLauncherInput) {}

  get describe(): string {
    return `codex-acp (${this.input.entryPath})`
  }

  async launch(): Promise<AcpRuntimeConnection> {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(this.input.execPath, [this.input.entryPath], {
        cwd: this.input.cwd,
        env: buildCodexAcpEnvironment({
          environment: this.input.environment,
          systemCodexPath: this.input.systemCodexPath,
        }),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new AgentHostError('RUNTIME_SPAWN_FAILED', `codex-acp could not be started: ${detail}`)
    }

    let stderrBuffer = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer = `${stderrBuffer}${chunk}`.slice(-STDERR_BUFFER_LIMIT)
    })

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    )

    let closed = false
    return Object.freeze({
      stream,
      describe: this.describe,
      recentStderr: () => stderrBuffer,
      close: async () => {
        if (closed) return
        closed = true
        await new Promise<void>((resolvePromise) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolvePromise()
          const finish = () => resolvePromise()
          child.once('exit', finish)
          child.kill('SIGTERM')
          setTimeout(() => {
            child.kill('SIGKILL')
            resolvePromise()
          }, 2_000).unref?.()
        })
      },
    })
  }
}

/**
 * Passes every inbound ACP message to `observe` before it reaches the SDK.
 *
 * The SDK validates `session/update` payloads against the ACP schema it was
 * generated from, so an update kind added by a newer codex-acp is dropped
 * before any typed handler sees it. That is already fail-open at the transport
 * level — the connection and the prompt turn survive — but the workbench would
 * be blind to it. Observing the raw message first keeps the host aware of
 * everything the runtime sent while leaving the typed path untouched.
 *
 * `observe` never affects delivery: it is called inside a guard so an
 * observation bug cannot break the transport.
 */
export function observeInboundMessages(
  stream: Stream,
  observe: (message: unknown) => void,
): Stream {
  const tap = new TransformStream<unknown, unknown>({
    transform(chunk, controller) {
      try {
        observe(chunk)
      } catch {
        // Observation is diagnostics only and must never break the connection.
      }
      controller.enqueue(chunk)
    },
  })

  return {
    writable: stream.writable,
    readable: stream.readable.pipeThrough(tap) as Stream['readable'],
  }
}
