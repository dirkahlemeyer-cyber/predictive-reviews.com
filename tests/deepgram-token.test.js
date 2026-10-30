import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/deepgram-token.js";

function responseRecorder() {
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

test("token endpoint rejects unauthorized requests and returns an uncached short-lived token", async () => {
  const originalKey = process.env.DEEPGRAM_API_KEY;
  const originalFetch = globalThis.fetch;
  try {
    process.env.DEEPGRAM_API_KEY = "test-key";
    globalThis.fetch = async () => {
      throw new Error("Provider must not be called");
    };

    const wrongMethod = responseRecorder();
    await handler({ method: "GET" }, wrongMethod);
    assert.equal(wrongMethod.result.code, 405);
    assert.equal(wrongMethod.result.headers.Allow, "POST");

    const crossSite = responseRecorder();
    await handler({ method: "POST", headers: { host: "example.com", origin: "https://another.example" } }, crossSite);
    assert.equal(crossSite.result.code, 403);

    let providerCalled = false;
    globalThis.fetch = async (url, options) => {
      providerCalled = true;
      assert.equal(url, "https://api.deepgram.com/v1/auth/grant");
      assert.equal(JSON.parse(options.body).ttl_seconds, 60);
      return { ok: true, status: 200, json: async () => ({ access_token: "test-token" }) };
    };
    const sameSite = responseRecorder();
    await handler({ method: "POST", headers: { host: "example.com", origin: "https://example.com" } }, sameSite);
    assert.equal(providerCalled, true);
    assert.equal(sameSite.result.code, 200);
    assert.equal(sameSite.result.body, "test-token");
    assert.equal(sameSite.result.headers["Cache-Control"], "no-store");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = originalKey;
  }
});
