import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { checkBasicAuth } from "../lib/auth";
import { verifyOutstandWebhook } from "../lib/outstand";

function basicHeader(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

afterEach(() => {
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.OUTSTAND_WEBHOOK_SECRET;
});

describe("checkBasicAuth", () => {
  it("accepts the configured credentials", () => {
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD = "s3cret";
    expect(checkBasicAuth(basicHeader("admin", "s3cret"))).toBe(true);
  });

  it("rejects a wrong password", () => {
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD = "s3cret";
    expect(checkBasicAuth(basicHeader("admin", "nope"))).toBe(false);
  });

  it("rejects when no credentials are configured", () => {
    expect(checkBasicAuth(basicHeader("admin", "s3cret"))).toBe(false);
  });

  it("rejects malformed headers", () => {
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD = "s3cret";
    expect(checkBasicAuth(null)).toBe(false);
    expect(checkBasicAuth("Bearer abc")).toBe(false);
  });
});

describe("verifyOutstandWebhook", () => {
  it("accepts a valid HMAC signature", () => {
    process.env.OUTSTAND_WEBHOOK_SECRET = "whsec";
    const body = JSON.stringify({ postId: "p_1", outcome: "success" });
    const sig = createHmac("sha256", "whsec").update(body).digest("hex");
    expect(verifyOutstandWebhook(body, sig)).toBe(true);
  });

  it("accepts a valid static token", () => {
    process.env.OUTSTAND_WEBHOOK_SECRET = "whsec";
    expect(verifyOutstandWebhook("{}", "whsec")).toBe(true);
  });

  it("rejects an invalid signature", () => {
    process.env.OUTSTAND_WEBHOOK_SECRET = "whsec";
    expect(verifyOutstandWebhook("{}", "wrong")).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    expect(verifyOutstandWebhook("{}", "anything")).toBe(false);
  });
});
