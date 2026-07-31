const fs = require("fs");
const path = require("path");

const requiredFiles = [
  "public/index.html",
  "public/styles.css",
  "public/app.js",
  "netlify/functions/api.js",
  "src/sms.js",
  "src/shopify.js"
];

for (const file of requiredFiles) {
  const fullPath = path.join(__dirname, "..", file);
  if (!fs.existsSync(fullPath)) {
    console.error(`Missing required file: ${file}`);
    process.exit(1);
  }
}

const indexHtml = fs.readFileSync(path.join(__dirname, "..", "public/index.html"), "utf8");
const netlifyToml = fs.readFileSync(path.join(__dirname, "..", "netlify.toml"), "utf8");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!indexHtml.includes('<link rel="stylesheet" href="/styles.css">')) {
  fail("index.html must load /styles.css as an external same-origin stylesheet.");
}

if (!indexHtml.includes('<script src="/app.js" defer></script>')) {
  fail("index.html must load /app.js as an external same-origin deferred script.");
}

if (!/publish\s*=\s*"public"/.test(netlifyToml)) {
  fail("netlify.toml must publish the current public/ frontend.");
}

if (!/from\s*=\s*"\/\*"\s*\n\s*to\s*=\s*"\/index\.html"\s*\n\s*status\s*=\s*200/.test(netlifyToml)) {
  fail("netlify.toml must rewrite SPA routes to /index.html.");
}

if (/<style[\s>]/i.test(indexHtml) || /<script(?!\s+src=)[^>]*>/i.test(indexHtml) || /\sstyle\s*=/i.test(indexHtml)) {
  fail("index.html must not contain inline styles, inline scripts, or style attributes.");
}

if (/sha256-|unsafe-eval|script-src\s+\*|style-src\s+\*|connect-src\s+\*/i.test(netlifyToml)) {
  fail("netlify.toml CSP must not contain stale hashes, unsafe-eval, or wildcard script/style/connect sources.");
}

console.log("Build check passed.");
