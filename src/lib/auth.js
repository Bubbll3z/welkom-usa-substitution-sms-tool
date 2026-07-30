const {
  createSession,
  getSession,
  requireAuth,
  requireRole,
  hashPassword,
  verifyPassword
} = require("../auth");
const { validateCsrf } = require("../security");

async function validateSession(event) {
  const session = await getSession(event);
  return session.ok ? session.user : null;
}

function csrfProtection(event, auth) {
  return validateCsrf({ event, auth });
}

module.exports = {
  createSession,
  csrfProtection,
  hashPassword,
  requireAuth,
  requireRole,
  validateSession,
  verifyPassword
};
