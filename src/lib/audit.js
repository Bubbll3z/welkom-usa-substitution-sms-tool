const { createAuditRecord } = require("../history");

async function logAction({ staffId, action, details = {}, timestamp }) {
  return createAuditRecord({
    type: action,
    actor: staffId,
    details,
    createdAt: timestamp
  });
}

module.exports = {
  logAction
};
