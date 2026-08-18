import { describe, expect, it } from 'vitest'
import {
  createModelChannelStore,
  MODEL_CHANNEL_API_KEY_KEY,
  MODEL_CHANNEL_BASE_URL_KEY,
  MODEL_CHANNEL_MODEL_KEY,
  type SecretStorage,
} from './model-channel-store'

const SECRET = 'sk-a-real-looking-secret-value-0123456789'

function preferences(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

/**
 * Stands in for Electron's `safeStorage`.
 *
 * The fake "encryption" is a reversible transform on purpose: a test that
 * cannot distinguish ciphertext from plaintext would pass whether or not the
 * store actually encrypted anything. Reversing it here proves the round trip,
 * while the stored bytes are visibly not the secret.
 */
function secretStorage(available = true): SecretStorage & { calls: number } {
  return {
    calls: 0,
    isEncryptionAvailable: () => available,
    encryptString(plainText: string) {
      return Buffer.from([...Buffer.from(plainText, 'utf8')].map((byte) => byte ^ 0x5a))
    },
    decryptString(encrypted: Buffer) {
      return Buffer.from([...encrypted].map((byte) => byte ^ 0x5a)).toString('utf8')
    },
  }
}

describe('where the built-in assistant’s model key lives', () => {
  it('never writes the key into preferences in the clear', async () => {
    const backing = preferences()
    const store = createModelChannelStore(backing, secretStorage())

    const result = await store.save({
      baseUrl: 'https://example.test/v1',
      model: 'some-model',
      apiKey: SECRET,
    })

    expect(result.saved).toBe(true)
    // The endpoint and model id are ordinary settings and are stored as typed.
    expect(backing.values.get(MODEL_CHANNEL_BASE_URL_KEY)).toBe('https://example.test/v1')
    expect(backing.values.get(MODEL_CHANNEL_MODEL_KEY)).toBe('some-model')
    // The key is not. Nothing anywhere in the store holds it verbatim.
    const everythingStored = [...backing.values.values()].join('\n')
    expect(everythingStored).not.toContain(SECRET)
    expect(backing.values.get(MODEL_CHANNEL_API_KEY_KEY)).not.toBe(SECRET)
    expect(backing.values.get(MODEL_CHANNEL_API_KEY_KEY)).toMatch(/^swb-safe-storage-v1:/u)
  })

  it('gives the key back only to the code that needs to make a request', async () => {
    const backing = preferences()
    const store = createModelChannelStore(backing, secretStorage())
    await store.save({ baseUrl: 'https://example.test/v1', model: 'm', apiKey: SECRET })

    // The run path gets the real key…
    expect(await store.readConfig()).toEqual({
      baseUrl: 'https://example.test/v1',
      model: 'm',
      apiKey: SECRET,
    })

    // …and the surface that gets rendered does not, at all, in any field.
    const view = await store.readView()
    expect(JSON.stringify(view)).not.toContain(SECRET)
    expect(view.hasApiKey).toBe(true)
    expect(view.configured).toBe(true)
  })

  it('refuses to store a key at all when this computer cannot keep one', async () => {
    const backing = preferences()
    const store = createModelChannelStore(backing, secretStorage(false))

    const result = await store.save({
      baseUrl: 'https://example.test/v1',
      model: 'm',
      apiKey: SECRET,
    })

    expect(result.saved).toBe(false)
    expect(result.problem).toContain('不会把密钥明文存下来')
    // Nothing at all was written — not the key, and not the two harmless
    // fields either, so the workbench never holds half a connection.
    expect(backing.values.size).toBe(0)
    expect(await store.readConfig()).toBeNull()
  })

  it('treats an unreadable stored key as no key rather than trying something else', async () => {
    const store = createModelChannelStore(
      preferences({
        [MODEL_CHANNEL_BASE_URL_KEY]: 'https://example.test/v1',
        [MODEL_CHANNEL_MODEL_KEY]: 'm',
        // Written by some other scheme, or by another machine, or corrupt.
        [MODEL_CHANNEL_API_KEY_KEY]: SECRET,
      }),
      secretStorage(),
    )

    // The plaintext is right there and is deliberately not used: reading it
    // would be the fallback that makes plaintext storage viable.
    expect(await store.readConfig()).toBeNull()
    const view = await store.readView()
    expect(view.hasApiKey).toBe(false)
    expect(view.configured).toBe(false)
  })

  it('forgets everything when cleared', async () => {
    const backing = preferences()
    const store = createModelChannelStore(backing, secretStorage())
    await store.save({ baseUrl: 'https://example.test/v1', model: 'm', apiKey: SECRET })

    await store.clear()

    expect(await store.readConfig()).toBeNull()
    expect([...backing.values.values()].join('\n')).not.toContain(SECRET)
    const view = await store.readView()
    expect(view).toMatchObject({ baseUrl: null, model: null, hasApiKey: false, configured: false })
  })

  it('reports a machine without a secret store instead of pretending it is fine', async () => {
    const store = createModelChannelStore(preferences(), secretStorage(false))
    const view = await store.readView()
    expect(view.secretStorageAvailable).toBe(false)
    expect(view.detail).toContain('系统密钥保管服务')
  })
})
