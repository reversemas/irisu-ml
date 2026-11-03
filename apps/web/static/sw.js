"use strict";

// Offline shell cache (music is cached by the page, see music.mjs, and served here). The v86 runtime blobs (wasm, kernel, guest files) are
// cached by exact-worker.js in its own versioned cache, so they are skipped
// here to avoid storing them twice; only libv86.js (loaded via importScripts)
// is handled by this worker.
const SHELL_PREFIX = "irisu-shell-";

function shouldHandle(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.endsWith("/sw.js")) return false;
  if (url.pathname.includes("/exact-runtime/")) return url.pathname.endsWith("/libv86.js");
  return true;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const response = await fetch("./precache.json", {cache: "no-store"});
    if (!response.ok) throw new Error("precache.json unavailable");
    const {version, files} = await response.json();
    const cache = await caches.open(SHELL_PREFIX + version);
    await cache.addAll(files.map(file => new Request(file, {cache: "reload"})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const response = await fetch("./precache.json", {cache: "no-store"}).catch(() => null);
    const current = response?.ok ? SHELL_PREFIX + (await response.json()).version : null;
    for (const name of await caches.keys()) {
      if (name.startsWith(SHELL_PREFIX) && name !== current) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// Safari requests audio with Range headers and rejects a plain 200 from a
// service worker, so answer ranges ourselves from the cached full file.
async function rangeResponse(request, cached) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
  if (!match) return cached;
  const blob = await cached.blob();
  const total = blob.size;
  const start = match[1] === "" ? Math.max(0, total - Number(match[2])) : Number(match[1]);
  const end = match[1] === "" || match[2] === "" ? total - 1 : Math.min(Number(match[2]), total - 1);
  if (start >= total || start > end) {
    return new Response(null, {status: 416, headers: {"Content-Range": `bytes */${total}`}});
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || "audio/mpeg",
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
    },
  });
}

async function musicResponse(request) {
  const cached = await caches.match(request.url, {ignoreSearch: true});
  if (cached) return request.headers.has("range") ? rangeResponse(request, cached) : cached;
  return fetch(request);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || !shouldHandle(url)) return;
  if (url.pathname.includes("/music/")) {
    event.respondWith(musicResponse(request));
    return;
  }
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (fresh.ok && request.destination !== "") {
        const names = (await caches.keys()).filter(name => name.startsWith(SHELL_PREFIX));
        if (names.length) {
          const cache = await caches.open(names[names.length - 1]);
          cache.put(request, fresh.clone()).catch(() => {});
        }
      }
      return fresh;
    } catch (error) {
      const cached = await caches.match(request, {ignoreSearch: true});
      if (cached) return cached;
      if (request.mode === "navigate") {
        const shell = await caches.match("./index.html", {ignoreSearch: true});
        if (shell) return shell;
      }
      throw error;
    }
  })());
});
