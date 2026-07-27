const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");
const { redactObject } = require("./safe-logger");

const USER_STORE_NAME = "welkom-sms-users";
const SESSION_STORE_NAME = "welkom-sms-sessions";
const SESSION_COOKIE = "welkom_sms_session";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

const memoryStores = {
  users: new Map(),
  sessions: new Map()
};

let authStoreFactory = null;

function setAuthStoreFactory(factory) {
  authStoreFactory = factory;
}

function resetAuthStoreFactory() {
  authStoreFactory = null;
}

function clearAuthMemory() {
  memoryStores.users.clear();
  memoryStores.sessions.clear();
}

function provider(env = process.env) {
  if (env.NODE_ENV === "test") return "memory";
  return String(env.MESSAGE_STORAGE_PROVIDER || (env.NETLIFY === "true" ? "netlify-blobs" : "memory")).toLowerCase();
}

function memoryStore(kind) {
  const backing = memoryStores[kind];
  return {
    async get(key) {
      return backing.has(key) ? backing.get(key) : null;
    },
    async set(key, value, options = {}) {
      if (options.onlyIfNew && backing.has(key)) {
        const error = new Error("Blob already exists.");
        error.code = "BLOB_ALREADY_EXISTS";
        throw error;
      }
      backing.set(key, value);
    },
    async setJSON(key, value, options = {}) {
      await this.set(key, JSON.stringify(value), options);
    },
    async delete(key) {
      backing.delete(key);
    },
    async list(options = {}) {
      const prefix = options.prefix || "";
      return { blobs: Array.from(backing.keys()).filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key })) };
    }
  };
}

function store(kind, env = process.env) {
  const name = kind === "users" ? USER_STORE_NAME : SESSION_STORE_NAME;
  if (authStoreFactory) return authStoreFactory(name, kind);
  if (provider(env) === "netlify-blobs") return getStore(name);
  return memoryStore(kind);
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
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

async function setJson(targetStore, key, value, options = {}) {
  if (typeof targetStore.setJSON === "function") return targetStore.setJSON(key, value, options);
  return targetStore.set(key, JSON.stringify(value), options);
}

async function deleteKey(targetStore, key) {
  if (typeof targetStore.delete === "function") {
    await targetStore.delete(key).catch(() => {});
    return true;
  }
  return false;
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function validateUsername(username) {
  return /^[a-z0-9._@-]{2,80}$/.test(normalizeUsername(username));
}

function hashSessionId(sessionId) {
  return crypto.createHash("sha256").update(String(sessionId || "")).digest("hex");
}

function timingSafeEqualHex(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "hex");
  const rightBuffer = Buffer.from(String(right || ""), "hex");
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) {
    crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password || ""), salt, SCRYPT_KEY_LENGTH, SCRYPT_PARAMS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  if (!password || String(password).length < 8) {
    return { ok: false, code: "PASSWORD_WEAK", error: "Password must be at least 8 characters." };
  }
  const derived = await scryptAsync(password, salt);
  return {
    ok: true,
    passwordHash: derived.toString("hex"),
    passwordSalt: salt
  };
}

async function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) return false;
  const derived = await scryptAsync(password, user.passwordSalt);
  return timingSafeEqualHex(derived.toString("hex"), user.passwordHash);
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: Boolean(user.isActive),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt || null,
    failedLoginCount: Number(user.failedLoginCount || 0),
    lockedUntil: user.lockedUntil || null
  };
}

async function getUserByUsername(username, env = process.env) {
  const normalized = normalizeUsername(username);
  if (!validateUsername(normalized)) return null;
  const user = await getJson(store("users", env), `users/by-username/${normalized}`);
  return user?.id ? user : null;
}

async function getUserById(id, env = process.env) {
  if (!id || !/^[A-Za-z0-9_-]+$/.test(String(id))) return null;
  const user = await getJson(store("users", env), `users/by-id/${id}`);
  return user?.id ? user : null;
}

async function saveUser(user, env = process.env) {
  const normalized = normalizeUsername(user.username);
  const record = {
    ...user,
    username: normalized,
    updatedAt: nowIso()
  };
  const targetStore = store("users", env);
  await setJson(targetStore, `users/by-id/${record.id}`, record);
  await setJson(targetStore, `users/by-username/${normalized}`, record);
  return record;
}

async function createUser({ username, displayName, password, role = "staff", isActive = true }, env = process.env) {
  const normalized = normalizeUsername(username);
  if (!validateUsername(normalized)) return { ok: false, status: 400, code: "USER_INVALID", error: "Username is invalid." };
  if (!["admin", "staff"].includes(role)) return { ok: false, status: 400, code: "ROLE_INVALID", error: "Role must be admin or staff." };
  const existing = await getUserByUsername(normalized, env);
  if (existing) return { ok: false, status: 409, code: "USER_EXISTS", error: "User already exists." };
  const hashed = await hashPassword(password);
  if (!hashed.ok) return { ...hashed, status: 400 };
  const now = nowIso();
  const user = {
    id: crypto.randomUUID(),
    username: normalized,
    displayName: String(displayName || username || "").trim().slice(0, 120) || normalized,
    passwordHash: hashed.passwordHash,
    passwordSalt: hashed.passwordSalt,
    role,
    isActive: Boolean(isActive),
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null
  };
  await saveUser(user, env);
  await recordSecurityEvent("user_created", { userId: user.id, username: user.username, role }, env);
  return { ok: true, user: sanitizeUser(user), rawUser: user };
}

async function listUsers(env = process.env) {
  const targetStore = store("users", env);
  const listed = await targetStore.list({ prefix: "users/by-id/" });
  const users = await Promise.all((listed.blobs || []).map((blob) => getJson(targetStore, blob.key)));
  return users.filter((user) => user?.id).sort((a, b) => String(a.username).localeCompare(String(b.username))).map(sanitizeUser);
}

async function disableUser(userId, env = process.env) {
  const user = await getUserById(userId, env);
  if (!user) return { ok: false, status: 404, code: "USER_NOT_FOUND", error: "User was not found." };
  const saved = await saveUser({ ...user, isActive: false }, env);
  await recordSecurityEvent("user_disabled", { userId: saved.id, username: saved.username }, env);
  return { ok: true, user: sanitizeUser(saved) };
}

async function resetUserPassword({ userId, password }, env = process.env) {
  const user = await getUserById(userId, env);
  if (!user) return { ok: false, status: 404, code: "USER_NOT_FOUND", error: "User was not found." };
  const hashed = await hashPassword(password);
  if (!hashed.ok) return { ...hashed, status: 400 };
  const saved = await saveUser({
    ...user,
    passwordHash: hashed.passwordHash,
    passwordSalt: hashed.passwordSalt,
    failedLoginCount: 0,
    lockedUntil: null
  }, env);
  await recordSecurityEvent("user_password_reset", { userId: saved.id, username: saved.username }, env);
  return { ok: true, user: sanitizeUser(saved) };
}

function cookieForSession(sessionId, event, session, env = process.env) {
  const proto = event.headers?.["x-forwarded-proto"] || event.headers?.["X-Forwarded-Proto"] || "";
  const secure = proto === "https" || env.NETLIFY === "true";
  const maxAge = Math.max(Math.floor((new Date(session.absoluteExpiresAt).getTime() - Date.now()) / 1000), 0);
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

function parseCookies(header) {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index > -1) cookies[part.slice(0, index)] = decodeURIComponent(part.slice(index + 1));
      return cookies;
    }, {});
}

async function createSession({ user, event, env = process.env, now = Date.now() }) {
  const sessionId = crypto.randomBytes(32).toString("base64url");
  const session = {
    sessionIdHash: hashSessionId(sessionId),
    userId: user.id,
    role: user.role,
    createdAt: nowIso(now),
    lastSeenAt: nowIso(now),
    expiresAt: nowIso(now + IDLE_TIMEOUT_MS),
    absoluteExpiresAt: nowIso(now + ABSOLUTE_TIMEOUT_MS),
    revokedAt: null
  };
  await setJson(store("sessions", env), `sessions/${session.sessionIdHash}`, session);
  return {
    ok: true,
    sessionId,
    session,
    cookie: event ? cookieForSession(sessionId, event, session, env) : ""
  };
}

async function getSession(event, env = process.env, now = Date.now()) {
  const cookies = parseCookies(event.headers?.cookie || event.headers?.Cookie || "");
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Please log in again." };
  const sessionIdHash = hashSessionId(sessionId);
  const session = await getJson(store("sessions", env), `sessions/${sessionIdHash}`);
  if (!session?.sessionIdHash || !timingSafeEqualHex(session.sessionIdHash, sessionIdHash)) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Please log in again." };
  }
  if (session.revokedAt) return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Please log in again." };
  if (new Date(session.absoluteExpiresAt).getTime() <= now) return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Session expired. Please log in again." };
  if (new Date(session.expiresAt).getTime() <= now) return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Session expired. Please log in again." };
  const user = await getUserById(session.userId, env);
  if (!user?.isActive) return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Please log in again." };
  const lastSeenAt = new Date(session.lastSeenAt).getTime();
  let nextSession = session;
  if (now - lastSeenAt >= LAST_SEEN_REFRESH_MS) {
    nextSession = {
      ...session,
      lastSeenAt: nowIso(now),
      expiresAt: nowIso(Math.min(now + IDLE_TIMEOUT_MS, new Date(session.absoluteExpiresAt).getTime()))
    };
    await setJson(store("sessions", env), `sessions/${sessionIdHash}`, nextSession);
  }
  return {
    ok: true,
    session: nextSession,
    user: sanitizeUser(user),
    staffName: user.displayName,
    role: user.role,
    payload: {
      staffName: user.displayName,
      exp: new Date(nextSession.expiresAt).getTime(),
      role: user.role,
      userId: user.id
    }
  };
}

async function revokeSession(event, env = process.env) {
  const cookies = parseCookies(event.headers?.cookie || event.headers?.Cookie || "");
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return { ok: true };
  const sessionIdHash = hashSessionId(sessionId);
  const session = await getJson(store("sessions", env), `sessions/${sessionIdHash}`);
  if (session?.sessionIdHash) {
    await setJson(store("sessions", env), `sessions/${sessionIdHash}`, { ...session, revokedAt: nowIso() });
    await recordSecurityEvent("logout", { userId: session.userId, role: session.role }, env);
  }
  return { ok: true };
}

async function requireAuth(event, env = process.env) {
  const session = await getSession(event, env);
  if (!session.ok) return session;
  return session;
}

async function requireRole(event, role, env = process.env) {
  const auth = await requireAuth(event, env);
  if (!auth.ok) return auth;
  const allowed = Array.isArray(role) ? role : [role];
  if (!allowed.includes(auth.role)) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "You do not have permission to perform this action." };
  }
  return auth;
}

async function recordSecurityEvent(type, details = {}, env = process.env) {
  const targetStore = store("users", env);
  const record = {
    id: crypto.randomUUID(),
    type: String(type || "security_event").slice(0, 80),
    details: redactObject(details),
    createdAt: nowIso()
  };
  await setJson(targetStore, `security-events/${record.createdAt}_${record.id}`, record).catch(() => {});
  try {
    const { createAuditRecord } = require("./data-store");
    await createAuditRecord({ type, details: record.details }, env);
  } catch (error) {
    // Audit writes must not block login/logout flows.
  }
  return record;
}

async function delayForFailures(count) {
  const delayMs = Math.min(Math.max(Number(count || 0) - 1, 0) * 200, 1200);
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function authenticateUser({ username, password, event, env = process.env, now = Date.now() }) {
  const generic = { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Invalid username or password." };
  const normalized = normalizeUsername(username);
  const user = await getUserByUsername(normalized, env);
  if (!user) {
    await delayForFailures(2);
    await recordSecurityEvent("login_failed", { username: normalized || "[missing]", reason: "generic" }, env);
    return generic;
  }
  if (!user.isActive) {
    await recordSecurityEvent("login_failed", { userId: user.id, username: user.username, reason: "disabled" }, env);
    return generic;
  }
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > now) {
    await recordSecurityEvent("login_failed", { userId: user.id, username: user.username, reason: "locked" }, env);
    return generic;
  }
  await delayForFailures(user.failedLoginCount || 0);
  const verified = await verifyPassword(password, user);
  if (!verified) {
    const failedLoginCount = Number(user.failedLoginCount || 0) + 1;
    const lockedUntil = failedLoginCount >= MAX_FAILED_ATTEMPTS ? nowIso(now + LOCKOUT_MS) : null;
    await saveUser({ ...user, failedLoginCount, lockedUntil }, env);
    await recordSecurityEvent("login_failed", { userId: user.id, username: user.username, reason: lockedUntil ? "locked" : "generic" }, env);
    if (lockedUntil) await recordSecurityEvent("account_lockout", { userId: user.id, username: user.username }, env);
    return generic;
  }
  const saved = await saveUser({ ...user, failedLoginCount: 0, lockedUntil: null, lastLoginAt: nowIso(now) }, env);
  const session = await createSession({ user: saved, event, env, now });
  await recordSecurityEvent("login_success", { userId: saved.id, username: saved.username }, env);
  return {
    ok: true,
    user: sanitizeUser(saved),
    session: session.session,
    cookie: session.cookie
  };
}

async function changePassword({ event, currentPassword, newPassword, env = process.env }) {
  const auth = await requireAuth(event, env);
  if (!auth.ok) return auth;
  const user = await getUserById(auth.user.id, env);
  const verified = await verifyPassword(currentPassword, user);
  if (!verified) return { ok: false, status: 400, code: "PASSWORD_INVALID", error: "Password could not be changed." };
  const hashed = await hashPassword(newPassword);
  if (!hashed.ok) return { ...hashed, status: 400 };
  const saved = await saveUser({ ...user, passwordHash: hashed.passwordHash, passwordSalt: hashed.passwordSalt }, env);
  await recordSecurityEvent("password_changed", { userId: saved.id, username: saved.username }, env);
  return { ok: true, user: sanitizeUser(saved) };
}

function authRequired() {
  return true;
}

async function getSessionFromEvent(event, env = process.env) {
  return getSession(event, env);
}

async function verifySession(token, env = process.env, now = Date.now()) {
  return getSession({ headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` } }, env, now);
}

async function checkStaffPassword() {
  return { ok: false, status: 410, code: "AUTH_REPLACED", error: "Password-only login has been replaced by staff user login." };
}

function rateLimitLogin() {
  return { ok: true };
}

function resetLoginAttempts() {}

async function cleanupExpiredSessions({ now = Date.now(), max = 100, env = process.env } = {}) {
  const targetStore = store("sessions", env);
  const listed = await targetStore.list({ prefix: "sessions/" }).catch(() => ({ blobs: [] }));
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const blob of listed.blobs || []) {
    if (removed >= max) break;
    const session = await getJson(targetStore, blob.key);
    const terminalAt = session?.revokedAt || session?.absoluteExpiresAt || session?.expiresAt || "";
    if (!session || new Date(terminalAt).getTime() < cutoff) {
      if (await deleteKey(targetStore, blob.key)) removed += 1;
    }
  }
  if (removed) await recordSecurityEvent("expired_sessions_cleaned", { removed }, env);
  return { removed };
}

module.exports = {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  SESSION_COOKIE,
  SESSION_STORE_NAME,
  USER_STORE_NAME,
  authRequired,
  authenticateUser,
  changePassword,
  checkStaffPassword,
  clearAuthMemory,
  cleanupExpiredSessions,
  clearSessionCookie,
  cookieForSession,
  createSession,
  createUser,
  disableUser,
  getSession,
  getSessionFromEvent,
  getUserById,
  getUserByUsername,
  hashPassword,
  hashSessionId,
  listUsers,
  parseCookies,
  rateLimitLogin,
  recordSecurityEvent,
  requireAuth,
  requireRole,
  resetAuthStoreFactory,
  resetLoginAttempts,
  resetUserPassword,
  revokeSession,
  sanitizeUser,
  saveUser,
  setAuthStoreFactory,
  verifyPassword,
  verifySession
};
