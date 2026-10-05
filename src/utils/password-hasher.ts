import { argon2id, hash, verify } from "argon2";

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hashed: string, plain: string): Promise<boolean>;
}

export class ArgonPasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return hash(plain, { type: argon2id });
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      return false;
    }
  }
}
