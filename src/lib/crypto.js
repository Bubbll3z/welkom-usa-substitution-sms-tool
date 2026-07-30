const crypto = require("node:crypto");
const { hashPassword, verifyPassword } = require("../auth");

function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token, pepper = process.env.SUBSTITUTION_TOKEN_PEPPER || "") {
  return crypto.createHmac("sha256", pepper || "local-dev-token-pepper").update(String(token || "")).digest("hex");
}

module.exports = {
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword
};
