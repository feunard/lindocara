import { describe, expect, it } from "vitest";
import { hashPassword, PBKDF2_ITERATIONS, verifyPassword } from "../src/server/password.js";

describe("password hashing", () => {
  it("round-trips a password", async () => {
    const record = await hashPassword("correct horse battery staple");
    expect(record.iterations).toBe(PBKDF2_ITERATIONS);
    expect(await verifyPassword("correct horse battery staple", record)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const record = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery stable", record)).toBe(false);
    expect(await verifyPassword("", record)).toBe(false);
  });

  it("salts every hash uniquely", async () => {
    const first = await hashPassword("same password");
    const second = await hashPassword("same password");
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it("verifies a record hashed with a legacy iteration count", async () => {
    // The count is stored per-row so it can be raised later without breaking old accounts.
    const legacy = await hashPassword("old password", 50_000);
    expect(legacy.iterations).toBe(50_000);
    expect(await verifyPassword("old password", legacy)).toBe(true);
  });
});
