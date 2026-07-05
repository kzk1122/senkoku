/* 線刻 − minimal cache-first service worker */
const CACHE = "senkoku-v12";
const ASSETS = [
  ".",
  "index.html",
  "keitai.html",
  "css/style.css",
  "js/scoring.js",
  "js/app.js",
  "js/keitai.js",
  "manifest.webmanifest",
  "icons/icon.svg",
];

/* Cloudflare Pages は /index.html → / や /keitai.html → /keitai へ 308 リダイレクトする。
   リダイレクトを辿ったレスポンス (redirected=true) をそのままキャッシュすると、
   Safari がページ遷移で "Response served by service worker has redirections" を出して
   開けなくなるため、クリーンな Response に作り直して保存する。
   さらにリダイレクト先 URL (/keitai 等) でも引けるよう両方のキーで put する */
self.addEventListener("install", e => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        ASSETS.map(async url => {
          const res = await fetch(url, { cache: "no-cache" });
          if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
          const body = await res.blob();
          const clean = new Response(body, { status: 200, headers: res.headers });
          await cache.put(url, clean.clone());
          if (res.redirected) await cache.put(res.url, clean);
        })
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request))
  );
});
