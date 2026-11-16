// Prints an AUTH_PASSWORD_HASH value. The password is read from stdin and never echoed,
// so it does not end up in shell history or terminal scrollback.
import { stdin, stderr, stdout } from "node:process";
import { hashPassword } from "../shared/password.ts";

function readHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk: string) => (data += chunk));
      stdin.on("end", () => {
        resolve(data.replace(/\r?\n$/, ""));
      });
      stdin.on("error", reject);
    });
  }

  stderr.write(prompt);
  return new Promise((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stderr.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          stderr.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

const password = await readHidden("Password: ");
if (password.length < 12) {
  stderr.write("Password must be at least 12 characters.\n");
  process.exit(1);
}
if (stdin.isTTY) {
  const confirm = await readHidden("Confirm:  ");
  if (confirm !== password) {
    stderr.write("Passwords do not match.\n");
    process.exit(1);
  }
}
stdout.write(`${await hashPassword(password)}\n`);
