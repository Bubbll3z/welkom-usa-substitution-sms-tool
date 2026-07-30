const { checkRateLimit: checkExistingRateLimit } = require("../rate-limit");

async function checkRateLimit(key, maxRequests, windowMs) {
  return checkExistingRateLimit({
    key,
    limit: maxRequests,
    windowSeconds: Math.max(1, Math.ceil(Number(windowMs || 0) / 1000))
  });
}

module.exports = {
  checkRateLimit
};
