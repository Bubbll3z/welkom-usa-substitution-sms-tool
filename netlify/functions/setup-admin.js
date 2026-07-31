require("dotenv").config();

const crypto = require("node:crypto");
const { connectLambda } = require("@netlify/blobs");
const { createUser } = require("../../src/auth");

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

function response(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...headers, ...extraHeaders },
    body: JSON.stringify(body)
  };
}

function getHeader(event, name) {
  const headers = event?.headers || {};
  const expected = String(name).toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === expected);
  return key ? String(headers[key] || "") : "";
}

function secretMatches(received, expected) {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(String(received));
  const expectedBuffer = Buffer.from(String(expected));
  if (!receivedBuffer.length || receivedBuffer.length !== expectedBuffer.length) {
    crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }
  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

exports.handler = async (event) => {
  if (event?.blobs) connectLambda(event);

  if (event.httpMethod !== "POST") {
    return response(405, { success: false, error: "Method not allowed." }, { Allow: "POST" });
  }

  const setupSecret = process.env.ADMIN_SETUP_SECRET || "";
  const requestSecret = getHeader(event, "X-Admin-Setup-Secret");
  if (!secretMatches(requestSecret, setupSecret)) {
    return response(401, { success: false, error: "Unauthorized." });
  }

  const username = process.env.PERMANENT_ADMIN_USERNAME || "";
  const displayName = process.env.PERMANENT_ADMIN_DISPLAY_NAME || "";
  const password = process.env.PERMANENT_ADMIN_PASSWORD || "";
  if (!username || !displayName || !password) {
    return response(500, { success: false, error: "Permanent admin setup is not configured." });
  }

  try {
    const result = await createUser(
      {
        username,
        displayName,
        password,
        role: "admin",
        isActive: true
      },
      process.env
    );

    if (!result.ok) {
      const status = result.status === 409 ? 409 : 400;
      return response(status, {
        success: false,
        code: result.code || "SETUP_ADMIN_FAILED",
        error: status === 409 ? "Admin username already exists." : "Admin user could not be created."
      });
    }

    return response(201, { success: true, user: result.user });
  } catch (error) {
    console.error("Setup admin failed", { error: error?.message || "Unknown setup error" });
    return response(500, { success: false, error: "Admin user could not be created." });
  }
};
