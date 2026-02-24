import { hash, verify } from '@node-rs/argon2';

const ARGON2_OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hashedPassword: string,
  plainPassword: string
): Promise<boolean> {
  try {
    return await verify(hashedPassword, plainPassword, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
