const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");

const RATE_LIMIT_STORE_NAME = "welkom-sms-rate-limits";
const SCHEMA_VERSION = 1;
const DEFAULT_CLEANUP_AFTER_WRITES = 50;

const memoryRateLimits = new Map();
let rateLimitStoreFactory = null;
let writeCount = 0;

function setRateLimitStoreFactory(factory) {
  rateLimitStoreFactory = factory;
}

function resetRateLimitStoreFactory() {
  rateLimitStoreFactory = null;
}

function clearRateLimitMemory() {
  memoryRateLimits.clear();
  writeCount = 0;
}

function provider(env = process.env) {
  if (env.NODE_ENV === "test") return "memory";
  return String(env.MESSAGE_STORAGE_PROVIDER || (env.NETLIFY === "true" ? "netlify-blobs" : "memory")).toLowerCase();
}

function memoryStore() {
  return {
    async get(key) {
      return memoryRateLimits.has(key) ? memoryRateLimits.get(key) : null;
    },
    async set(key, value) {
      memoryRateLimits.set(key, value);
    },
    async setJSON(key, value) {
      await this.set(key, JSON.stringify(value));
    },
    async delete(key) {
      memoryRateLimits.delete(key);
    },
    async list(options = {}) {
      const prefix = options.prefix || "";
      return {
        blobs: Array.from(memoryRateLimits.keys()).filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key }))
      };
    }
  };
}

function store(env = process.env) {
  if (rateLimitStoreFactory) return rateLimitStoreFactory(RATE_LIMIT_STORE_NAME);
  if (provider(env) === "netlify-blobs") return getStore(RATE_LIMIT_STORE_NAME);
  return memoryStore();
}

function safeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    return null;
  }
}

async function getJson(targetStore, key) {
  const raw = await targetStore.get(key, { type: "json", consistency: "strong" }).catch(() => null);
  return safeJson(raw);
}

async function setJson(targetStore, key, value) {
  if (typeof targetStore.setJSON === "function") return targetStore.setJSON(key, value);
  return targetStore.set(key, JSON.stringify(value));
}

async function deleteKey(targetStore, key) {
  if (typeof targetStore.delete === "function") {
    await targetStore.delete(key).catch(() => {});
    return;
  }
  if (typeof targetStore.set === "function") {
    await targetStore.set(key, "", { metadata: { deleted: "true" } }).catch(() => {});
  }
}

function hashLimitKey(key, env = process.env) {
  const pepper = String(env.RATE_LIMIT_KEY_PEPPER || env.SUBSTITUTION_TOKEN_PEPPER || "");
  return crypto.createHash("sha256").update(`${pepper}:${String(key || "")}`).digest("hex");
}

function normalizePositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function retryAfterSeconds(blockedUntil, resetAt, now) {
  const until = Math.max(Number(blockedUntil || 0), Number(resetAt || 0));
  return Math.max(1, Math.ceil((until - now) / 1000));
}

function rateLimitKey(key, env = process.env) {
  return `limits/${hashLimitKey(key, env)}`;
}

async function cleanupRateLimitRecords({ olderThan = Date.now(), max = 100, env = process.env } = {}) {
  const targetStore = store(env);
  const listed = await targetStore.list({ prefix: "limits/" }).catch(() => ({ blobs: [] }));
  let removed = 0;
  for (const blob of listed.blobs || []) {
    if (removed >= max) break;
    const record = await getJson(targetStore, blob.key);
    if (!record || Math.max(Number(record.resetAt || 0), Number(record.blockedUntil || 0)) < olderThan) {
      await deleteKey(targetStore, blob.key);
      removed += 1;
    }
  }
  return { removed };
}

async function checkRateLimit({
  key,
  limit,
  windowSeconds,
  blockSeconds,
  increment = true,
  cleanup = true,
  now = Date.now(),
  env = process.env
}) {
  const safeLimit = normalizePositiveInt(limit, 1);
  const windowMs = normalizePositiveInt(windowSeconds, 60) * 1000;
  const blockMs = normalizePositiveInt(blockSeconds, windowSeconds || 60) * 1000;
  const targetStore = store(env);
  const storageKey = rateLimitKey(key, env);
  const existing = await getJson(targetStore, storageKey);
  let record = existing?.schemaVersion === SCHEMA_VERSION ? existing : null;

  if (!record || Number(record.resetAt || 0) <= now) {
    record = {
      schemaVersion: SCHEMA_VERSION,
      keyHash: hashLimitKey(key, env),
      count: 0,
      limit: safeLimit,
      resetAt: now + windowMs,
      blockedUntil: null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    };
  }

  if (record.blockedUntil && Number(record.blockedUntil) > now) {
    return {
      ok: false,
      limited: true,
      retryAfter: retryAfterSeconds(record.blockedUntil, record.resetAt, now),
      resetAt: new Date(Number(record.resetAt)).toISOString()
    };
  }

  if (increment) {
    record.count = Number(record.count || 0) + 1;
    record.limit = safeLimit;
    record.updatedAt = new Date(now).toISOString();
    if (record.count > safeLimit) {
      record.blockedUntil = now + blockMs;
    }
    await setJson(targetStore, storageKey, record);
    writeCount += 1;
    if (cleanup && writeCount % DEFAULT_CLEANUP_AFTER_WRITES === 0) {
      await cleanupRateLimitRecords({ olderThan: now - windowMs, max: 25, env }).catch(() => {});
    }
  }

  if (record.count > safeLimit) {
    return {
      ok: false,
      limited: true,
      retryAfter: retryAfterSeconds(record.blockedUntil, record.resetAt, now),
      resetAt: new Date(Number(record.resetAt)).toISOString()
    };
  }

  return {
    ok: true,
    limited: false,
    remaining: Math.max(safeLimit - Number(record.count || 0), 0),
    resetAt: new Date(Number(record.resetAt)).toISOString()
  };
}

module.exports = {
  RATE_LIMIT_STORE_NAME,
  checkRateLimit,
  cleanupRateLimitRecords,
  clearRateLimitMemory,
  hashLimitKey,
  resetRateLimitStoreFactory,
  setRateLimitStoreFactory
};
