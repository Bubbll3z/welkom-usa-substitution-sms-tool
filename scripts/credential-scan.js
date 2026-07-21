const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.endsWith("package-lock.json"));

const patterns = [
  { name: "Shopify Admin token", regex: /shpat_[A-Za-z0-9]{10,}/ },
  { name: "Twilio Account SID", regex: /\bAC[a-fA-F0-9]{32}\b/ },
  { name: "Twilio API Key SID", regex: /\bSK[a-fA-F0-9]{32}\b/ },
  { name: "Bearer token", regex: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { name: "Private key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ }
];

const findings = [];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const body = fs.readFileSync(file, "utf8");
  for (const pattern of patterns) {
    if (pattern.regex.test(body)) findings.push(`${pattern.name}: ${file}`);
  }
}

if (findings.length) {
  console.error("Potential credentials found:");
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log("Credential scan passed.");
