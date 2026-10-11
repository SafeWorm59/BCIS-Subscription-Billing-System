import { argon2id, hash, verify, type HashOptions } from 'argon2'

const argon2Options: HashOptions = {
  type: argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, argon2Options)
}

export function verifyPassword(
  passwordHash: string,
  password: string
): Promise<boolean> {
  return verify(passwordHash, password)
}
