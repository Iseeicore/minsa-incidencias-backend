import { RATE_LIMIT_MAX_KEYS } from "@/constants/limits.js";

export interface BucketPolicy {
  capacity: number;
  windowSeconds: number;
}

export interface TakeResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
  fullAt: number;
}

const MS_PER_SECOND = 1000;

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.buckets.size;
  }

  take(key: string, policy: BucketPolicy): TakeResult {
    const refillPerMs = policy.capacity / (policy.windowSeconds * MS_PER_SECOND);
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: policy.capacity, updatedAt: now, fullAt: now };

    bucket.tokens = Math.min(policy.capacity, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;

    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    bucket.fullAt = now + (policy.capacity - bucket.tokens) / refillPerMs;

    if (!this.buckets.has(key) && this.buckets.size >= RATE_LIMIT_MAX_KEYS) this.sweep();
    this.buckets.set(key, bucket);

    return {
      allowed,
      limit: policy.capacity,
      remaining: Math.floor(bucket.tokens),
      retryAfterSeconds: allowed ? 0 : Math.ceil((1 - bucket.tokens) / refillPerMs / MS_PER_SECOND),
    };
  }

  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.fullAt <= now) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
