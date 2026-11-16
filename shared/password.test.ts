import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the original password", async () => {
    const stored = await hashPassword("correct horse", 1_000);
    expect(stored).toMatch(/^pbkdf2-sha256\$1000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    await expect(verifyPassword("correct horse", stored)).resolves.toBe(true);
  });

  it("rejects a different password", async () => {
    const stored = await hashPassword("correct horse", 1_000);
    await expect(verifyPassword("wrong horse", stored)).resolves.toBe(false);
  });

  it("uses a fresh salt per hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same", 1_000), hashPassword("same", 1_000)]);
    expect(a).not.toBe(b);
  });

  it.each([
    ["empty", ""],
    ["wrong prefix", "bcrypt$1000$AAAA$AAAA"],
    ["iterations above Workers limit", "pbkdf2-sha256$100001$AAAA$AAAA"],
    ["non-numeric iterations", "pbkdf2-sha256$abc$AAAA$AAAA"],
    ["invalid base64", "pbkdf2-sha256$1000$!!!$AAAA"],
  ])("rejects malformed stored value: %s", async (_label, stored) => {
    await expect(verifyPassword("anything", stored)).resolves.toBe(false);
  });
});
