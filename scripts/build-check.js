const fs = require("fs");
const path = require("path");

const requiredFiles = [
  "public/index.html",
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

console.log("Build check passed.");
