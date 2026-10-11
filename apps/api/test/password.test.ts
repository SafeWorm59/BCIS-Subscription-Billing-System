import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../src/auth/password.js'

describe('password hashing', () => {
  it('stores Argon2id hashes and verifies the original password', async () => {
    const password = 'test-only password'
    const passwordHash = await hashPassword(password)

    expect(passwordHash).toContain('$argon2id$')
    expect(passwordHash).not.toContain(password)
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true)
    await expect(verifyPassword(passwordHash, 'incorrect')).resolves.toBe(false)
  })

  it('uses a fresh salt for each hash', async () => {
    const [firstHash, secondHash] = await Promise.all([
      hashPassword('same test-only password'),
      hashPassword('same test-only password')
    ])

    expect(firstHash).not.toBe(secondHash)
  })
})
