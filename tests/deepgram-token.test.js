import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/deepgram-token.js";
import { clientIp, limitConfig, limitKey, RESERVE_SCRIPT, RELEASE_SCRIPT } from "../api/voice-limit.js";

const request = (ip = "203.0.113.7") => ({
  method: "POST",
  headers: { host: "example.com", origin: "https://example.com", "x-vercel-forwarded-for": ip },
});

function recorder() {
  const result = { code: 0, body: "", headers: {} };
  return {
    result,
    setHeader(name, value) { result.headers[name] = value; },
    status(code) {
      result.code = code;
      return { send(body) { result.body = body; } };
    },
  };
}

async function configured(callback) {
  const names = ["DEEPGRAM_API_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "VOICE_IP_HASH_SECRET"];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const oldFetch = globalThis.fetch;
  process.env.DEEPGRAM_API_KEY = "test-key";
  process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-storage-key";
  process.env.VOICE_IP_HASH_SECRET = "s".repeat(32);
  try { await callback(); } finally {
    globalThis.fetch = oldFetch;
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
}

test("rejects invalid requests before contacting providers", async () => configured(async () => {
  globalThis.fetch = async () => { throw new Error("Provider must not be called"); };
  const method = recorder();
  await handler({ method: "GET" }, method);
  assert.equal(method.result.code, 405);
  assert.equal(method.result.headers.Allow, "POST");
  const origin = recorder();
  await handler({ method: "POST", headers: { host: "example.com", origin: "https://other.example" } }, origin);
  assert.equal(origin.result.code, 403);
  const noIp = recorder();
  await handler(request("invalid"), noIp);
  assert.equal(noIp.result.code, 503);
  assert.equal(noIp.result.headers["Cache-Control"], "no-store");
}));

test("fails closed without a durable store", async () => configured(async () => {
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  globalThis.fetch = async () => { throw new Error("Provider must not be called"); };
  const response = recorder();
  await handler(request(), response);
  assert.equal(response.result.code, 503);
}));

test("reserves an HMAC IP key before granting one short-lived token", async () => configured(async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === "https://example.upstash.io") return { ok: true, json: async () => ({ result: [1, 0] }) };
    assert.equal(url, "https://api.deepgram.com/v1/auth/grant");
    assert.equal(JSON.parse(options.body).ttl_seconds, 60);
    return { ok: true, status: 200, json: async () => ({ access_token: "test-token" }) };
  };
  const response = recorder();
  await handler(request(), response);
  assert.equal(response.result.code, 200);
  assert.equal(response.result.body, "test-token");
  assert.equal(calls.length, 2);
  const command = JSON.parse(calls[0].options.body);
  assert.equal(command[0], "EVAL");
  assert.equal(command[1], RESERVE_SCRIPT);
  assert.match(command[3], /^voice-ip:v1:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(command).includes("203.0.113.7"), false);
  assert.equal(response.result.headers["Cache-Control"], "no-store");
}));

test("returns Retry-After and does not contact Deepgram when denied", async () => configured(async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ result: [0, 72000] }) }; };
  const response = recorder();
  await handler(request(), response);
  assert.equal(response.result.code, 429);
  assert.equal(response.result.headers["Retry-After"], "72000");
  assert.equal(calls, 1);
}));

test("refunds a reservation when Deepgram does not grant a token", async () => configured(async () => {
  const commands = [];
  globalThis.fetch = async (url, options) => {
    if (url.includes("upstash")) {
      const command = JSON.parse(options.body);
      commands.push(command);
      return { ok: true, json: async () => ({ result: command[1] === RELEASE_SCRIPT ? 1 : [1, 0] }) };
    }
    return { ok: false, status: 503, json: async () => ({}) };
  };
  const response = recorder();
  await handler(request(), response);
  assert.equal(response.result.code, 502);
  assert.equal(commands.length, 2);
  assert.equal(commands[1][1], RELEASE_SCRIPT);
  assert.equal(commands[1][3], commands[0][3]);
}));

test("keeps raw IPs out of storage keys and rejects malformed configuration", () => {
  assert.equal(clientIp({ "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1" }), "203.0.113.7");
  assert.equal(clientIp({ "x-vercel-forwarded-for": "not-an-ip" }), undefined);
  assert.notEqual(limitKey("203.0.113.7", "s".repeat(32)), limitKey("203.0.113.8", "s".repeat(32)));
  assert.equal(limitConfig({ UPSTASH_REDIS_REST_URL: "http://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "x", VOICE_IP_HASH_SECRET: "s".repeat(32) }), undefined);
});
