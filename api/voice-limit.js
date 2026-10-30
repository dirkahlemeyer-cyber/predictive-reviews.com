import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// One script performs the rolling-window check and reservation atomically.
// Vercel supplies the current time; the check and reservation share one Redis operation.
export const RESERVE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local id = ARGV[2]
local six_hours = ${SIX_HOURS_MS}
local day = ${DAY_MS}
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - day)
local entries = redis.call('ZRANGE', key, 0, -1, 'WITHSCORES')
local wait = 0
if #entries >= 2 then
  wait = math.max(wait, six_hours - (now - tonumber(entries[#entries])))
end
if #entries >= 4 then
  wait = math.max(wait, day - (now - tonumber(entries[2])))
end
if wait > 0 then
  return {0, math.ceil(wait / 1000)}
end
redis.call('ZADD', key, now, id)
redis.call('PEXPIRE', key, day)
return {1, 0}
`;

export const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
return 1
`;

/** @param {{ [key: string]: string | string[] | undefined }} headers */
export function clientIp(headers) {
  const forwarded = headers["x-vercel-forwarded-for"];
  if (typeof forwarded !== "string") return undefined;
  const first = forwarded.split(",", 1)[0].trim();
  return isIP(first) ? first : undefined;
}

/** @param {NodeJS.ProcessEnv} env */
export function limitConfig(env) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  const hashSecret = env.VOICE_IP_HASH_SECRET;
  if (!url || !token || !hashSecret || hashSecret.length < 32) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".upstash.io") ||
        parsed.pathname !== "/" || parsed.search || parsed.hash) return undefined;
    return { url: parsed.origin, token, hashSecret };
  } catch {
    return undefined;
  }
}

/** @param {string} ip @param {string} secret */
export function limitKey(ip, secret) {
  return `voice-ip:v1:${createHmac("sha256", secret).update(ip).digest("hex")}`;
}

/**
 * @param {{ url: string, token: string, hashSecret: string }} config
 * @param {string} script
 * @param {string} key
 * @param {Array<string | number>} args
 */
async function evalScript(config, script, key, args) {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["EVAL", script, 1, key, ...args]),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Rate-limit storage unavailable");
  const payload = await response.json();
  if (payload.error || payload.result === undefined) throw new Error("Invalid rate-limit response");
  return payload.result;
}

/** @param {string} ip @param {NonNullable<ReturnType<typeof limitConfig>>} config */
export async function reserveVoiceSlot(ip, config) {
  const key = limitKey(ip, config.hashSecret);
  const id = randomUUID();
  const result = await evalScript(config, RESERVE_SCRIPT, key, [Date.now(), id]);
  if (!Array.isArray(result) || (result[0] !== 0 && result[0] !== 1) ||
      !Number.isSafeInteger(result[1]) || result[1] < 0) {
    throw new Error("Invalid rate-limit decision");
  }
  return { allowed: result[0] === 1, retryAfter: result[1], key, id };
}

/** @param {NonNullable<ReturnType<typeof limitConfig>>} config @param {{key: string, id: string}} slot */
export async function releaseVoiceSlot(config, slot) {
  const result = await evalScript(config, RELEASE_SCRIPT, slot.key, [slot.id]);
  if (result !== 1) throw new Error("Invalid release response");
}
