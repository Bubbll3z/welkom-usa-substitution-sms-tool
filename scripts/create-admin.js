#!/usr/bin/env node
require("dotenv").config();

const readline = require("node:readline");
const { stdin: input, stdout: output } = require("node:process");
const { createUser } = require("../src/auth");

function question(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function promptHidden(rl, prompt) {
  return new Promise((resolve) => {
    rl.stdoutMuted = true;
    rl.question(prompt, (answer) => {
      rl.stdoutMuted = false;
      output.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const rl = readline.createInterface({
    input,
    output,
    terminal: true,
  });
  const originalWriteToOutput = rl._writeToOutput;
  rl._writeToOutput = function writeToOutput(stringToWrite) {
    if (rl.stdoutMuted) {
      rl.output.write("*");
      return;
    }
    originalWriteToOutput.call(rl, stringToWrite);
  };
  try {
    const username = process.env.ADMIN_USERNAME || await question(rl, "Admin username: ");
    const displayName = process.env.ADMIN_DISPLAY_NAME || await question(rl, "Admin display name: ");
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
