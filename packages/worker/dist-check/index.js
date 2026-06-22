var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../../node_modules/.pnpm/hono@4.12.25/node_modules/hono/dist/index.js
import { Hono } from "./a17579cac47ba7baddfbf012efdf0a572fb57106-hono.js";
import { Context } from "./23732f28a493ac7162b07c765bad9b77a6a57bd7-context.js";

// ../../node_modules/.pnpm/hono@4.12.25/node_modules/hono/dist/middleware/cors/index.js
var cors = /* @__PURE__ */ __name((options) => {
  const opts = {
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
    allowHeaders: [],
    exposeHeaders: [],
    ...options
  };
  const findAllowOrigin = ((optsOrigin) => {
    if (typeof optsOrigin === "string") {
      if (optsOrigin === "*") {
        return () => optsOrigin;
      } else {
        return (origin) => optsOrigin === origin ? origin : null;
      }
    } else if (typeof optsOrigin === "function") {
      return optsOrigin;
    } else {
      return (origin) => optsOrigin.includes(origin) ? origin : null;
    }
  })(opts.origin);
  const findAllowMethods = ((optsAllowMethods) => {
    if (typeof optsAllowMethods === "function") {
      return optsAllowMethods;
    } else if (Array.isArray(optsAllowMethods)) {
      return () => optsAllowMethods;
    } else {
      return () => [];
    }
  })(opts.allowMethods);
  return /* @__PURE__ */ __name(async function cors2(c, next) {
    function set(key, value) {
      c.res.headers.set(key, value);
    }
    __name(set, "set");
    const allowOrigin = await findAllowOrigin(c.req.header("origin") || "", c);
    if (allowOrigin) {
      set("Access-Control-Allow-Origin", allowOrigin);
    }
    if (opts.credentials) {
      set("Access-Control-Allow-Credentials", "true");
    }
    if (opts.exposeHeaders?.length) {
      set("Access-Control-Expose-Headers", opts.exposeHeaders.join(","));
    }
    if (c.req.method === "OPTIONS") {
      if (opts.origin !== "*") {
        set("Vary", "Origin");
      }
      if (opts.maxAge != null) {
        set("Access-Control-Max-Age", opts.maxAge.toString());
      }
      const allowMethods = await findAllowMethods(c.req.header("origin") || "", c);
      if (allowMethods.length) {
        set("Access-Control-Allow-Methods", allowMethods.join(","));
      }
      let headers = opts.allowHeaders;
      if (!headers?.length) {
        const requestHeaders = c.req.header("Access-Control-Request-Headers");
        if (requestHeaders) {
          headers = requestHeaders.split(/\s*,\s*/);
        }
      }
      if (headers?.length) {
        set("Access-Control-Allow-Headers", headers.join(","));
        c.res.headers.append("Vary", "Access-Control-Request-Headers");
      }
      c.res.headers.delete("Content-Length");
      c.res.headers.delete("Content-Type");
      return new Response(null, {
        headers: c.res.headers,
        status: 204,
        statusText: "No Content"
      });
    }
    await next();
    if (opts.origin !== "*") {
      c.header("Vary", "Origin", { append: true });
    }
  }, "cors2");
}, "cors");

// src/storage/kv.ts
var KVStorage = class {
  constructor(kv) {
    this.kv = kv;
  }
  static {
    __name(this, "KVStorage");
  }
  async get(key, validate) {
    const raw = await this.kv.get(key, "json");
    if (raw === null || raw === void 0) return null;
    if (validate) return validate(raw) ? raw : null;
    return raw;
  }
  async put(key, value) {
    await this.kv.put(key, JSON.stringify(value));
  }
  async delete(key) {
    await this.kv.delete(key);
  }
};

// src/image/store.ts
var R2ImageStore = class {
  constructor(r2) {
    this.r2 = r2;
  }
  static {
    __name(this, "R2ImageStore");
  }
  key(hash, file) {
    return `images/${hash}/${file}`;
  }
  async getOriginal(hash) {
    const obj = await this.r2.get(this.key(hash, "original"));
    if (!obj) return null;
    return {
      data: await obj.arrayBuffer(),
      contentType: obj.httpMetadata?.contentType || "image/jpeg"
    };
  }
  async putOriginal(hash, data, contentType) {
    await this.r2.put(this.key(hash, "original"), data, {
      httpMetadata: { contentType }
    });
  }
  async getVariant(hash, variant) {
    const obj = await this.r2.get(this.key(hash, variant));
    if (!obj) return null;
    return {
      data: await obj.arrayBuffer(),
      contentType: obj.httpMetadata?.contentType || "image/jpeg"
    };
  }
  async putVariant(hash, variant, data, contentType) {
    await this.r2.put(this.key(hash, variant), data, {
      httpMetadata: { contentType }
    });
  }
};

// src/api/collections.ts
var VALID_TYPES = ["want", "watched", "watching", "on_hold", "dropped"];
var BUCKETS = VALID_TYPES;
function parsePositiveInt(raw, fallback) {
  const n = parseInt(raw ?? "", 10);
  return Number.isNaN(n) || n < 1 ? fallback : n;
}
__name(parsePositiveInt, "parsePositiveInt");
async function handleCollections(storage, url, nsfwEnvShow) {
  const rawType = url.searchParams.get("type") || "watching";
  const type = VALID_TYPES.includes(rawType) ? rawType : "watching";
  const page = parsePositiveInt(url.searchParams.get("page"), 1);
  const limit = Math.min(parsePositiveInt(url.searchParams.get("limit"), 24), 100);
  const nsfwShow = nsfwEnvShow && url.searchParams.get("nsfw") !== "false";
  const merged = await storage.get("collections:merged");
  if (!merged) {
    return Response.json({ data: [], total: 0, page, limit, types: emptyTypes() });
  }
  const filteredBuckets = {
    want: [],
    watched: [],
    watching: [],
    on_hold: [],
    dropped: []
  };
  const types = emptyTypes();
  for (const key of BUCKETS) {
    const bucket = merged[key] ?? [];
    const filtered = nsfwShow ? bucket : bucket.filter((e) => !e.nsfw);
    filteredBuckets[key] = filtered;
    types[key] = filtered.length;
  }
  const list = filteredBuckets[type];
  const total = list.length;
  const start = (page - 1) * limit;
  const data = list.slice(start, start + limit);
  return Response.json({ data, total, page, limit, types });
}
__name(handleCollections, "handleCollections");
function emptyTypes() {
  return { want: 0, watched: 0, watching: 0, on_hold: 0, dropped: 0 };
}
__name(emptyTypes, "emptyTypes");

// src/api/calendar.ts
async function handleCalendar(storage, nsfwShow) {
  const calendar = await storage.get("calendar");
  if (!calendar) return Response.json([]);
  const filtered = calendar.map((d) => ({
    weekday: d.weekday,
    items: nsfwShow ? d.items : d.items.filter((item) => !item.nsfw)
  }));
  return Response.json(filtered);
}
__name(handleCalendar, "handleCalendar");

// src/api/config.ts
function handleConfig(url, env) {
  const key = url.searchParams.get("key");
  if (key === "nsfw") return Response.json({ nsfw: env.NSFW_SHOW === "true" });
  return Response.json({ error: "unknown key" }, { status: 400 });
}
__name(handleConfig, "handleConfig");

// ../shared/src/bgm-client.ts
var BGM_BASE = "https://api.bgm.tv";
var UA = "markd3ng/BangumiTV (https://github.com/markd3ng/BangumiTV)";
var BgmHttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "BgmHttpError";
  }
  static {
    __name(this, "BgmHttpError");
  }
};
var BgmTimeoutError = class extends Error {
  static {
    __name(this, "BgmTimeoutError");
  }
  constructor(message) {
    super(message);
    this.name = "BgmTimeoutError";
  }
};
var BgmNetworkError = class extends Error {
  static {
    __name(this, "BgmNetworkError");
  }
  constructor(message) {
    super(message);
    this.name = "BgmNetworkError";
  }
};
var BgmClient = class {
  constructor(token) {
    this.token = token;
  }
  static {
    __name(this, "BgmClient");
  }
  headers() {
    const h = { "User-Agent": UA };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }
  /** 统一 fetch 包装：按异常类型分类错误、返回中文错误消息。非 2xx 时附上响应体原文便于排障。 */
  async fetchJson(url, init) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        throw new BgmTimeoutError(`\u8BF7\u6C42 bgm.tv \u8D85\u65F6 (30s): ${url}`);
      }
      throw new BgmNetworkError(`\u65E0\u6CD5\u8FDE\u63A5 bgm.tv: ${err.message || String(err)}`);
    }
    if (res.status === 401) {
      const body = await res.text().catch(() => "");
      throw new BgmHttpError(401, `bgm.tv \u8BA4\u8BC1\u5931\u8D25\uFF1Atoken \u65E0\u6548\u6216\u5DF2\u8FC7\u671F (body: ${body.slice(0, 200)})`);
    }
    if (res.status === 403) {
      const body = await res.text().catch(() => "");
      throw new BgmHttpError(403, `bgm.tv \u62D2\u7EDD\u8BBF\u95EE\uFF1Atoken \u6743\u9650\u4E0D\u8DB3\u6216 scope \u7F3A\u5931 (body: ${body.slice(0, 200)})`);
    }
    if (res.status === 404) {
      throw new BgmHttpError(404, `bgm.tv \u8D44\u6E90\u4E0D\u5B58\u5728\uFF1A${url}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new BgmHttpError(res.status, `bgm.tv \u8FD4\u56DE\u9519\u8BEF (${res.status}): ${body.slice(0, 300)}`);
    }
    return res.json();
  }
  async getCollections(username, offset = 0, limit = 30) {
    const url = `${BGM_BASE}/v0/users/${username}/collections?subject_type=2&limit=${limit}&offset=${offset}`;
    return this.fetchJson(url, { headers: this.headers(), signal: AbortSignal.timeout(3e4) });
  }
  async getSubject(subjectId) {
    const url = `${BGM_BASE}/v0/subjects/${subjectId}`;
    try {
      return await this.fetchJson(url, { headers: this.headers(), signal: AbortSignal.timeout(3e4) });
    } catch (err) {
      if (err instanceof BgmHttpError && err.status === 404) return null;
      throw err;
    }
  }
  async getCalendar() {
    const url = `${BGM_BASE}/calendar`;
    return this.fetchJson(url, { headers: this.headers(), signal: AbortSignal.timeout(3e4) });
  }
  async downloadImage(url) {
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(3e4) });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    return {
      data: await res.arrayBuffer(),
      contentType: res.headers.get("content-type") || "image/jpeg"
    };
  }
  async oauthAccessToken(clientId, clientSecret, code, redirectUri) {
    const url = `https://bgm.tv/oauth/access_token`;
    return this.fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
      }),
      signal: AbortSignal.timeout(3e4)
    });
  }
  async refreshAccessToken(clientId, clientSecret, refreshToken) {
    const url = `https://bgm.tv/oauth/access_token`;
    return this.fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken
      }),
      signal: AbortSignal.timeout(3e4)
    });
  }
  /**
   * 查询 access token 状态（POST /oauth/token_status）。
   * 返回 token 是否有效及其过期 unix 时间戳；无效时 valid=false。
   * 这是唯一能可靠区分「token 过期(401)」与「资源不存在(404)」的探测方式。
   */
  async tokenStatus(token) {
    const url = `https://bgm.tv/oauth/token_status`;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
        body: new URLSearchParams({ access_token: token }).toString(),
        signal: AbortSignal.timeout(3e4)
      });
    } catch {
      return { valid: false };
    }
    if (res.status === 401 || res.status === 403) return { valid: false };
    if (!res.ok) throw new BgmHttpError(res.status, `token_status error: ${res.status}`);
    try {
      const data = await res.json();
      return { valid: true, expires: data.expires };
    } catch {
      return { valid: false };
    }
  }
  async patchCollection(token, subjectId, body) {
    const url = `${BGM_BASE}/v0/users/-/collections/${subjectId}`;
    return this.fetchJson(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3e4)
    });
  }
};

// ../shared/src/merger.ts
var TYPE_MAP = {
  1: "want",
  2: "watched",
  3: "watching",
  4: "on_hold",
  5: "dropped"
};
function toTimestamp(s) {
  if (!s) return 0;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? 0 : t;
}
__name(toTimestamp, "toTimestamp");
function toMergedEntry(c) {
  const subj = c.subject;
  return {
    subject_id: c.subject_id,
    name: subj?.name ?? "",
    name_cn: subj?.name_cn ?? "",
    summary: subj?.summary ?? "",
    images: { hash: "", w: 0, h: 0 },
    eps: subj?.eps ?? 0,
    total_episodes: subj?.total_episodes ?? 0,
    ep_status: c.ep_status,
    vol_status: c.vol_status,
    type: c.subject_type,
    collection_type: c.type,
    rate: c.rate,
    nsfw: subj?.nsfw ?? false,
    date: subj?.date ?? "",
    tags: c.tags ?? [],
    updated_at: c.updated_at
  };
}
__name(toMergedEntry, "toMergedEntry");
function merge(usersCollections) {
  const map = /* @__PURE__ */ new Map();
  for (const collections of usersCollections) {
    for (const c of collections) {
      const entry = toMergedEntry(c);
      const existing = map.get(c.subject_id);
      if (!existing || toTimestamp(c.updated_at) > toTimestamp(existing.updated_at)) {
        map.set(c.subject_id, entry);
      }
    }
  }
  const result = { want: [], watched: [], watching: [], on_hold: [], dropped: [], updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  for (const entry of map.values()) {
    const key = TYPE_MAP[entry.collection_type] ?? "want";
    result[key].push(entry);
  }
  return result;
}
__name(merge, "merge");
function primaryMerge(masterCollections) {
  return merge([masterCollections]);
}
__name(primaryMerge, "primaryMerge");

// ../shared/src/utils.ts
async function fetchAllCollections(client, username) {
  const all = [];
  const limit = 30;
  try {
    const first = await client.getCollections(username, 0, limit);
    const total = first.total;
    if (total === 0) return [];
    all.push(...first.data);
    const pages = Math.ceil(total / limit);
    let offset = limit;
    for (let p = 1; p < pages; p++) {
      const { data } = await client.getCollections(username, offset, limit);
      all.push(...data);
      offset += limit;
      await new Promise((r) => setTimeout(r, 200));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`\u83B7\u53D6\u7528\u6237 ${username} \u7684\u6536\u85CF\u65F6\u5931\u8D25\uFF1A${msg}`, { cause: err });
  }
  return all;
}
__name(fetchAllCollections, "fetchAllCollections");

// src/manage/security.ts
var STATE_TTL_SECONDS = 300;
var STATE_MAX_LENGTH = 1024;
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var purposes = /* @__PURE__ */ new Set(["account-a", "account-b", "cron"]);
var noncePattern = /^[A-Za-z0-9_-]{22}$/;
var safeErrorKinds = /* @__PURE__ */ new Set([
  "BgmHttpError",
  "BgmTimeoutError",
  "BgmNetworkError",
  "SyntaxError",
  "TypeError",
  "Error"
]);
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}
__name(asRecord, "asRecord");
function nonBlankString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
__name(nonBlankString, "nonBlankString");
function safeErrorKind(err) {
  return err instanceof Error && safeErrorKinds.has(err.name) ? err.name : "Unknown";
}
__name(safeErrorKind, "safeErrorKind");
function upstreamStatus(err) {
  return typeof err === "object" && err !== null && "status" in err && typeof err.status === "number" ? err.status : void 0;
}
__name(upstreamStatus, "upstreamStatus");
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
__name(base64url, "base64url");
function unbase64url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
__name(unbase64url, "unbase64url");
async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
__name(digest, "digest");
function fixedEqual(a, b) {
  if (a.length !== 32 || b.length !== 32) return false;
  let difference = 0;
  for (let index = 0; index < 32; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}
__name(fixedEqual, "fixedEqual");
async function stateKey(secret) {
  const material = await digest(`bangumi-tv:oauth-state:v1\0${secret}`);
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
__name(stateKey, "stateKey");
async function signState(secret, payload) {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await stateKey(secret), encoder.encode(payload)));
}
__name(signState, "signState");
var publicMessages = {
  MANAGE_NOT_CONFIGURED: "Management API not configured",
  OAUTH_NOT_CONFIGURED: "OAuth is not configured",
  UNAUTHORIZED: "Unauthorized",
  FORBIDDEN: "Forbidden",
  BGM_AUTH: "Upstream authorization failed",
  BGM_TIMEOUT: "Upstream request timed out",
  BGM_UPSTREAM: "Upstream request failed",
  INVALID_REQUEST: "Invalid request",
  INVALID_OAUTH_STATE: "Invalid OAuth state"
};
function publicError(status, code, _error) {
  return Response.json(
    { error: { code, message: publicMessages[code] || "Request failed" } },
    { status, headers: manageHeaders() }
  );
}
__name(publicError, "publicError");
async function createOAuthState(secret, purpose, now = Date.now()) {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = {
    v: 1,
    nonce,
    purpose,
    exp: Math.floor(now / 1e3) + STATE_TTL_SECONDS
  };
  const encoded = base64url(encoder.encode(JSON.stringify(payload)));
  return {
    state: `${encoded}.${base64url(await signState(secret, encoded))}`,
    nonce
  };
}
__name(createOAuthState, "createOAuthState");
async function verifyOAuthState(secret, state, now = Date.now()) {
  if (state.length > STATE_MAX_LENGTH) return null;
  try {
    const parts = state.split(".");
    if (parts.length !== 2) return null;
    const [encodedPayload, encodedSignature] = parts;
    const providedSignature = unbase64url(encodedSignature);
    const expectedSignature = await signState(secret, encodedPayload);
    if (!fixedEqual(providedSignature, expectedSignature)) return null;
    const payload = JSON.parse(decoder.decode(unbase64url(encodedPayload)));
    const nowSeconds = Math.floor(now / 1e3);
    if (payload.v !== 1) return null;
    if (!noncePattern.test(payload.nonce ?? "")) return null;
    if (!purposes.has(payload.purpose)) return null;
    if (!Number.isInteger(payload.exp) || payload.exp <= nowSeconds || payload.exp > nowSeconds + STATE_TTL_SECONDS) return null;
    return {
      v: 1,
      nonce: payload.nonce,
      purpose: payload.purpose,
      exp: payload.exp
    };
  } catch {
    return null;
  }
}
__name(verifyOAuthState, "verifyOAuthState");
function parseOAuthPurposeBody(value) {
  const body = asRecord(value);
  if (!body) return null;
  const purpose = nonBlankString(body.purpose);
  if (!purpose || !purposes.has(purpose)) {
    return null;
  }
  return purpose;
}
__name(parseOAuthPurposeBody, "parseOAuthPurposeBody");
function parseOAuthExchangeBody(value) {
  const body = asRecord(value);
  if (!body) return null;
  const code = nonBlankString(body.code);
  const state = nonBlankString(body.state);
  if (!code || !state) return null;
  return { code, state };
}
__name(parseOAuthExchangeBody, "parseOAuthExchangeBody");
async function authorizeManageRequest(request, secret) {
  if (!secret) {
    return publicError(503, "MANAGE_NOT_CONFIGURED");
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return publicError(403, "FORBIDDEN");
  }
  const providedSecret = request.headers.get("X-Manage-Secret");
  if (!providedSecret) {
    return publicError(401, "UNAUTHORIZED");
  }
  const [providedDigest, expectedDigest] = await Promise.all([digest(providedSecret), digest(secret)]);
  if (!fixedEqual(providedDigest, expectedDigest)) {
    return publicError(401, "UNAUTHORIZED");
  }
  return null;
}
__name(authorizeManageRequest, "authorizeManageRequest");
function manageHeaders(csp) {
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
  if (csp) {
    headers["Content-Security-Policy"] = csp;
  }
  return headers;
}
__name(manageHeaders, "manageHeaders");
function managePageCsp() {
  return "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' https: data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
}
__name(managePageCsp, "managePageCsp");
function callbackPageCsp() {
  return "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
}
__name(callbackPageCsp, "callbackPageCsp");
function createManageErrorLog(route, err, at = (/* @__PURE__ */ new Date()).toISOString()) {
  return {
    event: "manage_request_failed",
    route,
    kind: safeErrorKind(err),
    upstream_status: upstreamStatus(err),
    at
  };
}
__name(createManageErrorLog, "createManageErrorLog");
function createHealthFailureLog(err, at = (/* @__PURE__ */ new Date()).toISOString()) {
  return {
    event: "health_failed",
    kind: safeErrorKind(err),
    at
  };
}
__name(createHealthFailureLog, "createHealthFailureLog");
function createSyncFailureLog(phase, err, at = (/* @__PURE__ */ new Date()).toISOString()) {
  return {
    event: "sync_failed",
    phase,
    kind: safeErrorKind(err),
    upstream_status: upstreamStatus(err),
    at
  };
}
__name(createSyncFailureLog, "createSyncFailureLog");
function oauthCallbackHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>OAuth Callback</title>
  </head>
  <body>
    <p id="manual-copy" hidden>OAuth \u56DE\u8C03\u5DF2\u5B8C\u6210\u3002\u8BF7\u590D\u5236\u5730\u5740\u680F\u4E2D\u7684\u5B8C\u6574 URL\uFF0C\u8FD4\u56DE\u7BA1\u7406\u9875\u624B\u52A8\u7C98\u8D34\u3002</p>
    <script>
      const params = new URLSearchParams(location.search)
      const code = params.get('code')
      const state = params.get('state')
      if (window.opener) {
        window.opener.postMessage({ type: 'bgm-oauth', code, state }, location.origin)
        window.close()
      } else {
        document.getElementById('manual-copy').hidden = false
      }
    <\/script>
  </body>
</html>`;
}
__name(oauthCallbackHtml, "oauthCallbackHtml");

// src/cron.ts
var KV_TOKEN_KEY = "bgm:tokens";
var REFRESH_GRACE_SECONDS = 3600;
async function ensureFreshToken(storage, env) {
  const stored = await storage.get(KV_TOKEN_KEY);
  const current = stored ? { access_token: stored.access_token, refresh_token: stored.refresh_token } : env.BANGUMI_REFRESH_TOKEN ? { access_token: env.BANGUMI_TOKEN, refresh_token: env.BANGUMI_REFRESH_TOKEN } : env.BANGUMI_TOKEN ? { access_token: env.BANGUMI_TOKEN, refresh_token: "" } : null;
  if (!current) {
    throw new Error("No valid bgm.tv token: configure BANGUMI_TOKEN/BANGUMI_REFRESH_TOKEN or run /manage to authorize");
  }
  const probe = new BgmClient();
  const status = await probe.tokenStatus(current.access_token);
  const nowSec = Math.floor(Date.now() / 1e3);
  const needsRefresh = !status.valid || typeof status.expires === "number" && status.expires - nowSec < REFRESH_GRACE_SECONDS;
  if (!needsRefresh) return current.access_token;
  if (!env.BANGUMI_CLIENT_ID || !env.BANGUMI_CLIENT_SECRET || !current.refresh_token) {
    if (status.valid) return current.access_token;
    throw new Error("bgm.tv token expired and no refresh credentials configured");
  }
  const refreshed = await probe.refreshAccessToken(
    env.BANGUMI_CLIENT_ID,
    env.BANGUMI_CLIENT_SECRET,
    current.refresh_token
  );
  await storage.put(KV_TOKEN_KEY, {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token
  });
  return refreshed.access_token;
}
__name(ensureFreshToken, "ensureFreshToken");
function transformCalendar(raw) {
  return raw.map((d) => ({
    weekday: d.weekday,
    items: d.items.filter((item) => item.name_cn !== "" || item.name !== "").map((item) => {
      const { collection, rating, rank: _rank, ...rest } = item;
      return rest;
    })
  }));
}
__name(transformCalendar, "transformCalendar");
async function runSync(storage, _imageStore, env) {
  const token = await ensureFreshToken(storage, env);
  const client = new BgmClient(token);
  if (env.BANGUMI_USERS.length === 0) {
    throw new Error("sync: BANGUMI_USERS is empty \u2014 nothing to sync");
  }
  const settled = await Promise.allSettled(env.BANGUMI_USERS.map((u) => fetchAllCollections(client, u)));
  const allCollections = settled.map((s, i) => {
    if (s.status === "rejected") {
      const log = createSyncFailureLog("account", s.reason);
      console.warn(JSON.stringify(log));
      return [];
    }
    return s.value;
  });
  const anySuccess = settled.some((s) => s.status === "fulfilled");
  if (!anySuccess) {
    const details = settled.map((s, i) => {
      if (s.status === "rejected") {
        const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
        return `${env.BANGUMI_USERS[i]}: ${msg}`;
      }
      return null;
    }).filter(Boolean).join("; ");
    throw new Error(`sync: all users failed \u2014 ${details}`);
  }
  let merged;
  if (env.SYNC_MODE === "primary" && env.BANGUMI_PRIMARY_USER) {
    const idx = env.BANGUMI_USERS.indexOf(env.BANGUMI_PRIMARY_USER);
    if (idx === -1) throw new Error(`Primary user ${env.BANGUMI_PRIMARY_USER} not in users list`);
    merged = primaryMerge(allCollections[idx]);
  } else {
    merged = merge(allCollections);
  }
  const calendar = transformCalendar(await client.getCalendar());
  await storage.put("collections:merged", merged);
  await storage.put("calendar", calendar);
  return { merged, calendar };
}
__name(runSync, "runSync");

// src/manage/compare.ts
async function compareAccounts(tokenA, userA, tokenB, userB) {
  const [settledA, settledB] = await Promise.allSettled([
    fetchAllCollections(new BgmClient(tokenA), userA),
    fetchAllCollections(new BgmClient(tokenB), userB)
  ]);
  function unwrap(settled, name) {
    if (settled.status === "fulfilled") {
      return { name, collections: settled.value, total: settled.value.length };
    }
    return { name, collections: [], total: 0, error: "\u83B7\u53D6\u6536\u85CF\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5" };
  }
  __name(unwrap, "unwrap");
  const colA = unwrap(settledA, userA);
  const colB = unwrap(settledB, userB);
  if (colA.error && colB.error) {
    return { userA: colA, userB: colB, common: 0, differences: [] };
  }
  const mapA = new Map(colA.collections.map((c) => [c.subject_id, c]));
  const mapB = new Map(colB.collections.map((c) => [c.subject_id, c]));
  const differences = [];
  const allIds = /* @__PURE__ */ new Set([...mapA.keys(), ...mapB.keys()]);
  for (const id of allIds) {
    const a = mapA.get(id);
    const b = mapB.get(id);
    if (a && b) {
      if (a.type !== b.type || a.ep_status !== b.ep_status || a.vol_status !== b.vol_status || a.rate !== b.rate) {
        differences.push({
          subject_id: id,
          name: a.subject?.name ?? b.subject?.name ?? "",
          name_cn: a.subject?.name_cn ?? b.subject?.name_cn ?? "",
          images: a.subject?.images ?? b.subject?.images ?? { large: "", common: "", medium: "", small: "", grid: "" },
          typeA: a.type,
          typeB: b.type,
          epStatusA: a.ep_status,
          epStatusB: b.ep_status,
          volStatusA: a.vol_status,
          volStatusB: b.vol_status,
          rateA: a.rate,
          rateB: b.rate
        });
      }
    } else if (a && !b) {
      differences.push({
        subject_id: id,
        name: a.subject?.name ?? "",
        name_cn: a.subject?.name_cn ?? "",
        images: a.subject?.images ?? { large: "", common: "", medium: "", small: "", grid: "" },
        typeA: a.type,
        typeB: 0,
        epStatusA: a.ep_status,
        epStatusB: 0,
        volStatusA: a.vol_status,
        volStatusB: 0,
        rateA: a.rate,
        rateB: 0
      });
    } else if (!a && b) {
      differences.push({
        subject_id: id,
        name: b.subject?.name ?? "",
        name_cn: b.subject?.name_cn ?? "",
        images: b.subject?.images ?? { large: "", common: "", medium: "", small: "", grid: "" },
        typeA: 0,
        typeB: b.type,
        epStatusA: 0,
        epStatusB: b.ep_status,
        volStatusA: 0,
        volStatusB: b.vol_status,
        rateA: 0,
        rateB: b.rate
      });
    }
  }
  return {
    userA: colA,
    userB: colB,
    common: [...allIds].filter((id) => mapA.has(id) && mapB.has(id)).length,
    differences
  };
}
__name(compareAccounts, "compareAccounts");

// src/manage/sync-write.ts
async function executeSync(fromToken, fromUser, toToken, toUser, request) {
  const fromCol = await fetchAllCollections(new BgmClient(fromToken), fromUser);
  let targets;
  if (request.mode === "full") {
    targets = fromCol;
  } else {
    const ids = new Set(request.subject_ids || []);
    targets = fromCol.filter((c) => ids.has(c.subject_id));
  }
  const client = new BgmClient();
  const results = [];
  for (const entry of targets) {
    try {
      const body = {
        type: entry.type,
        rate: entry.rate,
        ep_status: entry.ep_status,
        vol_status: entry.vol_status,
        tags: entry.tags || [],
        comment: entry.comment || ""
      };
      await client.patchCollection(toToken, entry.subject_id, body);
      results.push({ subject_id: entry.subject_id, name: entry.subject?.name_cn || entry.subject?.name || String(entry.subject_id), status: "ok" });
    } catch {
      results.push({
        subject_id: entry.subject_id,
        name: entry.subject?.name_cn || entry.subject?.name || String(entry.subject_id),
        status: "error",
        error: "\u540C\u6B65\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"
      });
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}
__name(executeSync, "executeSync");

// src/manage/oauth.ts
function getOAuthRedirectUrl(clientId, redirectUri, state) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    state
  });
  return `https://bgm.tv/oauth/authorize?${params.toString()}`;
}
__name(getOAuthRedirectUrl, "getOAuthRedirectUrl");
async function exchangeCode(clientId, clientSecret, code, redirectUri) {
  const client = new BgmClient();
  return client.oauthAccessToken(clientId, clientSecret, code, redirectUri);
}
__name(exchangeCode, "exchangeCode");

// src/image/proxy.ts
var CACHE_HEADERS = { "Cache-Control": "public, max-age=31536000, immutable" };
async function handleImage(env, request) {
  const url = new URL(request.url);
  const hash = url.pathname.split("/").pop() || "";
  if (!hash || hash.length !== 64) {
    return new Response("Invalid hash", { status: 400 });
  }
  const store = new R2ImageStore(env.BANGUMI_R2);
  const original = await store.getOriginal(hash);
  if (!original) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(original.data, {
    headers: { ...CACHE_HEADERS, "Content-Type": original.contentType }
  });
}
__name(handleImage, "handleImage");

// src/index.ts
import manageHtml from "./8925bfe95a6fc581dd06c9980f2aa80b59076cc6-index.html";

// src/html.ts
import html from "./ac2b2c77bc149b1f90218d429b5c52e1c8d67573-index.html";
var html_default = html;

// src/js.ts
import js from "./098782441785a123b7da2bc1506888453b5238ce-bangumi.js";
var js_default = js;

// src/css.ts
import css from "./3c56cba0b1ecd0f544fa92bebd2ffa3e846b89e6-bangumi.css";
var css_default = css;

// src/index.ts
function errorToResponse(route, err) {
  const log = createManageErrorLog(route, err);
  console.error(JSON.stringify(log));
  if (err instanceof BgmHttpError) {
    if (err.status === 401 || err.status === 403) {
      return publicError(401, "BGM_AUTH", err);
    }
    return publicError(502, "BGM_UPSTREAM", err);
  }
  if (err instanceof BgmTimeoutError) {
    return publicError(504, "BGM_TIMEOUT", err);
  }
  if (err instanceof BgmNetworkError) {
    return publicError(502, "BGM_UPSTREAM", err);
  }
  if (err instanceof SyntaxError) {
    return publicError(400, "INVALID_REQUEST", err);
  }
  return publicError(500, "REQUEST_FAILED", err);
}
__name(errorToResponse, "errorToResponse");
var app = new Hono();
var publicCors = cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] });
app.use("/api/collections", publicCors);
app.use("/api/calendar", publicCors);
app.use("/api/config", publicCors);
app.use("/api/health", publicCors);
function summarize(merged) {
  const keys = ["want", "watched", "watching", "on_hold", "dropped"];
  const counts = {};
  let total = 0;
  for (const k of keys) {
    const n = Array.isArray(merged[k]) ? merged[k].length : 0;
    counts[k] = n;
    total += n;
  }
  counts._total = total;
  return counts;
}
__name(summarize, "summarize");
app.get("/", () => {
  return new Response(html_default, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});
app.get("/src/bangumi.js", () => {
  return new Response(js_default, { headers: { "Content-Type": "application/javascript; charset=utf-8" } });
});
app.get("/src/bangumi.css", () => {
  return new Response(css_default, { headers: { "Content-Type": "text/css; charset=utf-8" } });
});
app.get("/api/collections", (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV);
  return handleCollections(storage, new URL(c.req.url), c.env.NSFW_SHOW !== "false");
});
app.get("/api/calendar", (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV);
  return handleCalendar(storage, c.env.NSFW_SHOW !== "false");
});
app.get("/api/config", (c) => {
  return handleConfig(new URL(c.req.url), { NSFW_SHOW: c.env.NSFW_SHOW });
});
app.get("/api/health", async (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV);
  try {
    const merged = await storage.get("collections:merged");
    const calendar = await storage.get("calendar");
    const lastSuccess = await storage.get("sync:last_success");
    return Response.json({
      ok: true,
      data: {
        collections: merged ? { updated_at: merged.updated_at, types: summarize(merged) } : null,
        calendar: calendar ? calendar.length + " days" : null,
        last_sync: lastSuccess || null
      }
    });
  } catch (err) {
    const log = createHealthFailureLog(err);
    console.error(JSON.stringify(log));
    return Response.json({ ok: false }, { status: 500 });
  }
});
app.get("/image/*", (c) => {
  return handleImage({ BANGUMI_R2: c.env.BANGUMI_R2 }, c.req.raw);
});
app.get("/manage", () => {
  return new Response(manageHtml, {
    headers: {
      ...manageHeaders(managePageCsp()),
      "Content-Type": "text/html; charset=utf-8"
    }
  });
});
app.get("/manage/callback", () => {
  return new Response(oauthCallbackHtml(), {
    headers: {
      ...manageHeaders(callbackPageCsp()),
      "Content-Type": "text/html; charset=utf-8"
    }
  });
});
app.use("/api/manage/*", async (c, next) => {
  const denied = await authorizeManageRequest(c.req.raw, c.env.MANAGE_SECRET);
  if (denied) return denied;
  await next();
  for (const [name, value] of Object.entries(manageHeaders())) {
    c.header(name, String(value));
  }
});
app.post("/api/manage/oauth-url", async (c) => {
  const purpose = parseOAuthPurposeBody(await c.req.json().catch(() => null));
  if (!purpose) {
    return publicError(400, "INVALID_REQUEST");
  }
  if (!c.env.BANGUMI_CLIENT_ID) return publicError(503, "OAUTH_NOT_CONFIGURED");
  const created = await createOAuthState(c.env.MANAGE_SECRET, purpose);
  const redirectUri = `${new URL(c.req.url).origin}/manage/callback`;
  return Response.json({
    url: getOAuthRedirectUrl(c.env.BANGUMI_CLIENT_ID, redirectUri, created.state),
    state: created.state,
    nonce: created.nonce
  });
});
app.post("/api/manage/exchange", async (c) => {
  const body = parseOAuthExchangeBody(await c.req.json().catch(() => null));
  if (!body) return publicError(400, "INVALID_REQUEST");
  const state = await verifyOAuthState(c.env.MANAGE_SECRET, body.state);
  if (!state) return publicError(400, "INVALID_OAUTH_STATE");
  if (!c.env.BANGUMI_CLIENT_ID || !c.env.BANGUMI_CLIENT_SECRET) {
    return publicError(503, "OAUTH_NOT_CONFIGURED");
  }
  try {
    const result = await exchangeCode(
      c.env.BANGUMI_CLIENT_ID,
      c.env.BANGUMI_CLIENT_SECRET,
      body.code,
      `${new URL(c.req.url).origin}/manage/callback`
    );
    if (state.purpose === "cron") {
      const storage = new KVStorage(c.env.BANGUMI_KV);
      await storage.put("bgm:tokens", {
        access_token: result.access_token,
        refresh_token: result.refresh_token
      });
      return Response.json({ ok: true });
    }
    return Response.json({ access_token: result.access_token, user_id: result.user_id });
  } catch (err) {
    return errorToResponse("/api/manage/exchange", err);
  }
});
app.post("/api/manage/compare", async (c) => {
  try {
    const body = await c.req.json();
    const result = await compareAccounts(body.tokenA || "", body.userA || "", body.tokenB || "", body.userB || "");
    return Response.json(result);
  } catch (err) {
    return errorToResponse("/api/manage/compare", err);
  }
});
app.post("/api/manage/sync", async (c) => {
  try {
    const body = await c.req.json();
    const results = await executeSync(body.tokenA, body.from, body.tokenB, body.to, {
      mode: body.mode,
      from: body.from,
      to: body.to,
      subject_ids: body.subject_ids
    });
    return Response.json(results);
  } catch (err) {
    return errorToResponse("/api/manage/sync", err);
  }
});
app.delete("/api/manage/cron-token", async (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV);
  try {
    await storage.delete("bgm:tokens");
    return Response.json({ ok: true });
  } catch (err) {
    return errorToResponse("/api/manage/cron-token", err);
  }
});
app.post("/__cron/sync", async (c) => {
  const secret = c.req.header("X-Cron-Secret");
  if (secret !== c.env.CRON_SECRET) return new Response("Unauthorized", { status: 401 });
  const storage = new KVStorage(c.env.BANGUMI_KV);
  const imageStore = new R2ImageStore(c.env.BANGUMI_R2);
  const users = c.env.BANGUMI_USERS.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    await runSync(storage, imageStore, {
      BANGUMI_TOKEN: c.env.BANGUMI_TOKEN,
      BANGUMI_REFRESH_TOKEN: c.env.BANGUMI_REFRESH_TOKEN,
      BANGUMI_CLIENT_ID: c.env.BANGUMI_CLIENT_ID,
      BANGUMI_CLIENT_SECRET: c.env.BANGUMI_CLIENT_SECRET,
      BANGUMI_USERS: users,
      BANGUMI_PRIMARY_USER: c.env.BANGUMI_PRIMARY_USER,
      SYNC_MODE: c.env.SYNC_MODE || "merge"
    });
    await storage.put("sync:last_success", (/* @__PURE__ */ new Date()).toISOString());
    await storage.delete("sync:last_error");
    return new Response("OK", { status: 200 });
  } catch (err) {
    const log = createSyncFailureLog("manual", err);
    console.error(JSON.stringify(log));
    await storage.put("sync:last_error", err instanceof Error ? err.message : String(err));
    return new Response("Sync failed", { status: 500 });
  }
});
async function scheduled(_event, env, ctx) {
  const storage = new KVStorage(env.BANGUMI_KV);
  const imageStore = new R2ImageStore(env.BANGUMI_R2);
  const users = env.BANGUMI_USERS.split(",").map((s) => s.trim()).filter(Boolean);
  ctx.waitUntil(
    runSync(storage, imageStore, {
      BANGUMI_TOKEN: env.BANGUMI_TOKEN,
      BANGUMI_REFRESH_TOKEN: env.BANGUMI_REFRESH_TOKEN,
      BANGUMI_CLIENT_ID: env.BANGUMI_CLIENT_ID,
      BANGUMI_CLIENT_SECRET: env.BANGUMI_CLIENT_SECRET,
      BANGUMI_USERS: users,
      BANGUMI_PRIMARY_USER: env.BANGUMI_PRIMARY_USER,
      SYNC_MODE: env.SYNC_MODE || "merge"
    }).then(async () => {
      await storage.put("sync:last_success", (/* @__PURE__ */ new Date()).toISOString());
      await storage.delete("sync:last_error");
    }).catch(async (err) => {
      const log = createSyncFailureLog("scheduled", err);
      console.error(JSON.stringify(log));
      await storage.put("sync:last_error", err instanceof Error ? err.message : String(err));
    })
  );
}
__name(scheduled, "scheduled");
var index_default = {
  fetch: app.fetch,
  scheduled
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
