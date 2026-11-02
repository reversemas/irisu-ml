"use strict";

// Offline shell cache. The v86 runtime blobs (wasm, kernel, guest files) are
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !shouldHandle(new URL(request.url))) return;
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
