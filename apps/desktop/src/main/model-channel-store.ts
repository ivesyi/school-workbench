import type { ModelChannelConfig } from '@school-workbench/agent-host'
import type { ModelChannelView } from '@school-workbench/shared'

/**
 * Where the built-in assistant's model connection lives.
 *
 * The endpoint and the model id are ordinary settings and are stored as
 * written. The API key is not, and the rule this module exists to enforce has
 * exactly one line in it:
 *
 *   **A key is either encrypted by the operating system's own secret store, or
 *   it is not stored.**
 *
 * There is no third branch. No obfuscation, no base64-as-if-that-were-a-secret,
 * no "just this once" plaintext when `safeStorage` says it cannot help. On
 * macOS that store is the login keychain, on Windows DPAPI, on Linux whichever
 * keyring the session exposes; when none of them is available — a Linux box
 * with no keyring, typically — saving fails and says so, and the built-in
 * assistant stays unusable. That is the honest outcome: an unusable assistant
 * is recoverable, a key sitting in a SQLite file the consultant thinks is safe
 * is not.
 *
 * Two more rules follow from the same reasoning:
 *
 *  - **The key is never read back to any surface.** `readView()` reports
 *    whether one exists, never what it is. The renderer cannot display it, and
 *    a bug in the renderer cannot leak it, because it never arrives there.
 *  - **The key never reaches a log or a diagnostic.** Nothing in this module
 *    writes one, and callers are handed a config object only at the moment a
 *    run needs it.
 */

/** The Electron surface this module needs, kept narrow so it can be tested. */
export type SecretStorage = Readonly<{
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}>

export type PreferenceStore = Readonly<{
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}>

export const MODEL_CHANNEL_BASE_URL_KEY = 'model_channel_base_url'
export const MODEL_CHANNEL_MODEL_KEY = 'model_channel_model'
export const MODEL_CHANNEL_API_KEY_KEY = 'model_channel_api_key'

/**
 * Marks a stored value as ciphertext produced by this build.
 *
 * Without it, a value that failed to decrypt would be indistinguishable from a
 * value that was never encrypted, and "try reading it as plain text" is exactly
 * the recovery path that must not exist.
 */
const CIPHERTEXT_PREFIX = 'swb-safe-storage-v1:'

function encode(secret: string, storage: SecretStorage): string {
  return `${CIPHERTEXT_PREFIX}${storage.encryptString(secret).toString('base64')}`
}

/**
 * Reads a stored key back, or returns null.
 *
 * Null covers every unhappy case on purpose — absent, not written by this
 * scheme, encrypted for a different user or machine, corrupt. Each of them
 * means "there is no usable key", and the workbench then behaves exactly as it
 * does when none was ever set, which is a state the product already handles
 * plainly.
 */
function decode(stored: string | null, storage: SecretStorage): string | null {
  if (!stored || !stored.startsWith(CIPHERTEXT_PREFIX)) return null
  if (!storage.isEncryptionAvailable()) return null
  try {
    const secret = storage.decryptString(
      Buffer.from(stored.slice(CIPHERTEXT_PREFIX.length), 'base64'),
    )
    return secret.length > 0 ? secret : null
  } catch {
    return null
  }
}

export type ModelChannelStore = Readonly<{
  /** What settings may display. Never contains the key. */
  readView(): Promise<ModelChannelView>
  /** The complete connection, or null when any part is missing. */
  readConfig(): Promise<ModelChannelConfig | null>
  save(input: ModelChannelConfig): Promise<Readonly<{ saved: boolean; problem: string | null }>>
  clear(): Promise<void>
}>

const NO_SECRET_STORAGE_PROBLEM =
  '这台电脑没有可用的系统密钥保管服务，工作台不会把密钥明文存下来。请先启用系统钥匙串后再填一次。'

export function createModelChannelStore(
  preferences: PreferenceStore,
  storage: SecretStorage,
): ModelChannelStore {
  async function parts(): Promise<
    Readonly<{ baseUrl: string | null; model: string | null; apiKey: string | null }>
  > {
    const [baseUrl, model, storedKey] = await Promise.all([
      preferences.get(MODEL_CHANNEL_BASE_URL_KEY),
      preferences.get(MODEL_CHANNEL_MODEL_KEY),
      preferences.get(MODEL_CHANNEL_API_KEY_KEY),
    ])
    return Object.freeze({
      baseUrl: baseUrl && baseUrl.length > 0 ? baseUrl : null,
      model: model && model.length > 0 ? model : null,
      apiKey: decode(storedKey, storage),
    })
  }

  return Object.freeze({
    async readView(): Promise<ModelChannelView> {
      const current = await parts()
      const secretStorageAvailable = storage.isEncryptionAvailable()
      const configured = Boolean(current.baseUrl && current.model && current.apiKey)
      return Object.freeze({
        baseUrl: current.baseUrl,
        model: current.model,
        hasApiKey: current.apiKey !== null,
        secretStorageAvailable,
        configured,
        detail: !secretStorageAvailable
          ? NO_SECRET_STORAGE_PROBLEM
          : configured
            ? '已填好，工作台自带助手可以直接使用。'
            : '还没填。填好模型地址、模型名称和密钥之后，工作台自带助手就能用了。',
      })
    },

    async readConfig(): Promise<ModelChannelConfig | null> {
      const current = await parts()
      if (!current.baseUrl || !current.model || !current.apiKey) return null
      return Object.freeze({
        baseUrl: current.baseUrl,
        model: current.model,
        apiKey: current.apiKey,
      })
    },

    async save(input) {
      // Checked before anything is written, so a machine that cannot keep the
      // key never ends up holding half a connection either.
      if (!storage.isEncryptionAvailable()) {
        return Object.freeze({ saved: false, problem: NO_SECRET_STORAGE_PROBLEM })
      }
      const encrypted = encode(input.apiKey, storage)
      await preferences.set(MODEL_CHANNEL_BASE_URL_KEY, input.baseUrl)
      await preferences.set(MODEL_CHANNEL_MODEL_KEY, input.model)
      await preferences.set(MODEL_CHANNEL_API_KEY_KEY, encrypted)
      return Object.freeze({ saved: true, problem: null })
    },

    async clear() {
      await preferences.set(MODEL_CHANNEL_BASE_URL_KEY, '')
      await preferences.set(MODEL_CHANNEL_MODEL_KEY, '')
      await preferences.set(MODEL_CHANNEL_API_KEY_KEY, '')
    },
  })
}
