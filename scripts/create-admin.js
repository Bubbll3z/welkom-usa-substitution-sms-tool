#!/usr/bin/env node
require("dotenv").config();

const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { createUser } = require("../src/auth");

async function promptHidden(rl, question) {
  const mutable = output;
  const originalWrite = mutable.write;
  mutable.write = function writeHidden(chunk, encoding, callback) {
    if (String(chunk).includes(question)) return originalWrite.call(this, chunk, encoding, callback);
    return originalWrite.call(this, "*".repeat(String(chunk).length), encoding, callback);
  };
  try {
    return await rl.question(question);
  } finally {
    mutable.write = originalWrite;
    output.write("\n");
  }
}

async function main() {
  const rl = readline.createInterface({ input, output });
  try {
    const username = process.env.ADMIN_USERNAME || await rl.question("Admin username: ");
    const displayName = process.env.ADMIN_DISPLAY_NAME || await rl.question("Admin display name: ");
    const password = process.env.ADMIN_PASSWORD || await promptHidden(rl, "Admin password: ");
    if (!process.env.ADMIN_PASSWORD) {
      const confirm = await promptHidden(rl, "Confirm admin password: ");
      if (password !== confirm) {
        console.error("Passwords do not match.");
        process.exitCode = 1;
        return;
      }
    }
    const result = await createUser({ username, displayName, password, role: "admin", isActive: true });
    if (!result.ok) {
      console.error(result.error || "Admin user could not be created.");
      process.exitCode = 1;
      return;
    }
    console.log(`Admin user created: ${result.user.username}`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error?.message || "Admin user could not be created.");
  process.exitCode = 1;
});
