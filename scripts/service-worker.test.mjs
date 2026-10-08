import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const workerSource = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const offlineSource = fs.readFileSync(new URL("../public/offline.html", import.meta.url), "utf8");
const manifestSource = fs.readFileSync(new URL("../src/app/manifest.ts", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const configSource = fs.readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
const clientSource = fs.readFileSync(new URL("../src/app/client-app.tsx", import.meta.url), "utf8");

function response({ body = "static", contentType = "application/javascript", cacheControl = "public, max-age=31536000, immutable", ok = true } = {}) {
  return {
    ok,
    type: "basic",
    headers: { get: (name) => name === "content-type" ? contentType : name === "cache-control" ? cacheControl : null },
    clone() { return response({ body, contentType, cacheControl, ok }); },
    async text() { return body; },
  };
}

function createHarness({ fetchRequest = async () => response(), initialCaches = [] } = {}) {
  const handlers = new Map();
  const fetches = [];
  const data = new Map();
  for (const name of initialCaches) data.set(name, new Map());
  const cacheStorage = {
    async open(name) {
      if (!data.has(name)) data.set(name, new Map());
      const entries = data.get(name);
      return {
        async addAll(urls) {
          for (const url of urls) {
            const fetched = await fetchRequest(url);
            if (!fetched.ok) throw new Error(`Precache failed: ${url}`);
            entries.set(new URL(url, "https://chagokchan.test").href, fetched.clone());
          }
        },
        async match(request) {
          const key = typeof request === "string" ? new URL(request, "https://chagokchan.test").href : request.url;
          return entries.get(key);
        },
        async put(request, value) { entries.set(request.url, value); },
        async keys() { return [...entries.keys()].map((url) => ({ url })); },
        async delete(request) { return entries.delete(typeof request === "string" ? request : request.url); },
      };
    },
    async keys() { return [...data.keys()]; },
    async delete(name) { return data.delete(name); },
  };
  const self = {
    location: { origin: "https://chagokchan.test" },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, handler) { handlers.set(type, handler); },
  };
  const context = vm.createContext({
    URL,
    Response,
    Promise,
    Set,
    Math,
    self,
    caches: cacheStorage,
    fetch: async (request) => {
      fetches.push(typeof request === "string" ? request : request.url);
      return fetchRequest(request);
    },
  });
  vm.runInContext(workerSource, context, { filename: "public/sw.js" });
  return { handlers, fetches, data, cacheStorage };
}

function request(path, { method = "GET", destination = "", mode = "cors" } = {}) {
  return { url: new URL(path, "https://chagokchan.test").href, method, destination, mode };
}

async function dispatchFetch(harness, requestValue) {
  let handled = false;
  let responsePromise;
  harness.handlers.get("fetch")({
    request: requestValue,
    respondWith(value) { handled = true; responsePromise = Promise.resolve(value); },
  });
  return { handled, response: handled ? await responsePromise : undefined };
}

test("manifest declares installable app identity and 192/512 PNG icons", () => {
  assert.match(manifestSource, /name: "차곡찬 · Chagokchan"/);
  assert.match(manifestSource, /start_url: "\/"/);
  assert.match(manifestSource, /display: "standalone"/);
  assert.match(manifestSource, /src: "\/pwa-icons\/192", sizes: "192x192", type: "image\/png"/);
  assert.match(manifestSource, /src: "\/pwa-icons\/512", sizes: "512x512", type: "image\/png"/);
  assert.match(manifestSource, /purpose: "maskable"/);
});

test("user document and API fetches stay private and uncached; SW installs only in production", () => {
  assert.match(pageSource, /dynamic = "force-dynamic"/);
  assert.match(configSource, /source: "\/"[\s\S]*?private, no-store, max-age=0, must-revalidate/);
  assert.match(configSource, /source: "\/sw\.js"[\s\S]*?no-cache, no-store, must-revalidate/);
  assert.match(clientSource, /cache: "no-store", credentials: "same-origin"/);
  assert.match(clientSource, /navigator\.onLine === false/);
  assert.match(clientSource, /process\.env\.NODE_ENV === "production" && "serviceWorker" in navigator/);
});

test("install precaches only the public offline document and app icons", async () => {
  const harness = createHarness({ fetchRequest: async () => response({ contentType: "image/png" }) });
  let installPromise;
  harness.handlers.get("install")({ waitUntil(value) { installPromise = value; } });
  await installPromise;
  const urls = [...harness.data.get("chagokchan-public-static-v1").keys()];
  assert.deepEqual(urls.map((url) => new URL(url).pathname).sort(), ["/offline.html", "/pwa-icons/180", "/pwa-icons/192", "/pwa-icons/512"].sort());
  assert.equal(harness.fetches.some((url) => url.includes("/api/") || url.includes("invite")), false);
  assert.match(offlineSource, /오프라인에서 보낸 기록은 저장되거나 성공으로 표시되지 않아요/);
});

test("versioned static assets cache; HTML, RSC, APIs, invites, query URLs and writes bypass", async () => {
  const harness = createHarness({ fetchRequest: async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/pwa-icons/")) return response({ contentType: "image/png" });
    if (url.includes("bad.html")) return response({ contentType: "text/html" });
    return response({ contentType: "application/javascript" });
  } });
  let installPromise;
  harness.handlers.get("install")({ waitUntil(value) { installPromise = value; } });
  await installPromise;

  const staticResult = await dispatchFetch(harness, request("/_next/static/chunks/app.js", { destination: "script" }));
  assert.equal(staticResult.handled, true);
  assert.ok(harness.data.get("chagokchan-public-static-v1").has("https://chagokchan.test/_next/static/chunks/app.js"));

  const htmlResult = await dispatchFetch(harness, request("/_next/static/chunks/bad.html", { destination: "script" }));
  assert.equal(htmlResult.handled, true);
  assert.equal(harness.data.get("chagokchan-public-static-v1").has("https://chagokchan.test/_next/static/chunks/bad.html"), false);

  const navigation = await dispatchFetch(harness, request("/", { mode: "navigate" }));
  assert.equal(navigation.handled, true);
  assert.equal(harness.data.get("chagokchan-public-static-v1").has("https://chagokchan.test/"), false);

  for (const bypass of [
    request("/api/v1/goals"),
    request("/invite/private-token", { mode: "navigate" }),
    request("/invite?token=private-token", { mode: "navigate" }),
    request("/?invite=private-token", { mode: "navigate" }),
    request("/goals?_rsc=private-token"),
    request("/_next/static/chunks/app.js?token=private-token", { destination: "script" }),
    request("/api/v1/praises", { method: "POST" }),
  ]) {
    assert.equal((await dispatchFetch(harness, bypass)).handled, false, `${bypass.method} ${bypass.url} should fall through to the network`);
  }
  const cachedUrls = [...harness.data.get("chagokchan-public-static-v1").keys()];
  assert.equal(cachedUrls.some((url) => /\/api\/|invite|_rsc|private-token|\/$/.test(new URL(url).pathname + new URL(url).search)), false);
});

test("offline home navigation receives only the generic static offline page", async () => {
  const harness = createHarness({ fetchRequest: async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === "https://chagokchan.test/") throw new TypeError("offline");
    if (url.endsWith("/offline.html")) return response({ body: offlineSource, contentType: "text/html", cacheControl: "public, max-age=31536000, immutable" });
    return response({ contentType: "image/png" });
  } });
  let installPromise;
  harness.handlers.get("install")({ waitUntil(value) { installPromise = value; } });
  await installPromise;
  const result = await dispatchFetch(harness, request("/", { mode: "navigate" }));
  assert.equal(result.handled, true);
  assert.equal((await result.response.text()).includes("오프라인에서 보낸 기록은 저장되거나 성공으로 표시되지 않아요"), true);
});

test("activation removes only older Chagokchan static cache versions", async () => {
  const harness = createHarness({ initialCaches: ["chagokchan-public-static-old", "another-app-cache"] });
  let activatePromise;
  harness.handlers.get("activate")({ waitUntil(value) { activatePromise = value; } });
  await activatePromise;
  assert.deepEqual([...harness.data.keys()].sort(), ["another-app-cache"]);
});
