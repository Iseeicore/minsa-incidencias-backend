import { beforeEach, describe, expect, it } from "vitest";
import { TokenBucketLimiter, type BucketPolicy } from "@/utils/token-bucket.js";

const POLICY: BucketPolicy = { capacity: 300, windowSeconds: 300 };

describe("TokenBucketLimiter", () => {
  let now: number;
  let limiter: TokenBucketLimiter;

  beforeEach(() => {
    now = 1_000_000;
    limiter = new TokenBucketLimiter(() => now);
  });

  function drain(key: string, policy: BucketPolicy, times: number): void {
    for (let i = 0; i < times; i += 1) limiter.take(key, policy);
  }

  it("permite una ráfaga de hasta la capacidad y luego rechaza", () => {
    drain("a", POLICY, 300);
    const result = limiter.take("a", POLICY);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.limit).toBe(300);
  });

  it("informa los tokens restantes", () => {
    expect(limiter.take("a", POLICY).remaining).toBe(299);
    expect(limiter.take("a", POLICY).remaining).toBe(298);
  });

  it("rellena de forma continua: 300 por 5 minutos son 1 por segundo", () => {
    drain("a", POLICY, 300);
    expect(limiter.take("a", POLICY).retryAfterSeconds).toBe(1);

    now += 1_000;
    expect(limiter.take("a", POLICY).allowed).toBe(true);
    expect(limiter.take("a", POLICY).allowed).toBe(false);

    now += 10_000;
    drain("a", POLICY, 10);
    expect(limiter.take("a", POLICY).allowed).toBe(false);
  });

  it("no acumula más que la capacidad aunque pase mucho tiempo", () => {
    drain("a", POLICY, 300);
    now += 24 * 60 * 60 * 1_000;
    expect(limiter.take("a", POLICY).remaining).toBe(299);
  });

  it("calcula cuánto esperar cuando el relleno es lento", () => {
    const slow: BucketPolicy = { capacity: 5, windowSeconds: 900 };
    drain("login", slow, 5);
    expect(limiter.take("login", slow).retryAfterSeconds).toBe(180);
  });

  it("mantiene cubetas independientes por clave", () => {
    drain("a", POLICY, 300);
    expect(limiter.take("a", POLICY).allowed).toBe(false);
    expect(limiter.take("b", POLICY).allowed).toBe(true);
  });

  it("sweep elimina las cubetas ya llenas y conserva las activas", () => {
    drain("activa", POLICY, 300);
    limiter.take("ociosa", POLICY);
    now += 2_000;
    expect(limiter.sweep()).toBe(1);
    expect(limiter.size).toBe(1);
    now += 400_000;
    expect(limiter.sweep()).toBe(1);
    expect(limiter.size).toBe(0);
  });
});
