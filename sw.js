// Service worker: shell en caché para abrir rápido. "Red primero" (lección de
// Hub Limpieza: con "caché primero" los equipos se quedaban con el JS viejo).
// Los datos (SharePoint) nunca se cachean aquí.
const CACHE_NAME = "hub-precios-fruta-v3";
const SHELL_FILES = [
  "./", "./index.html", "./manifest.json", "./css/styles.css", "./icons/logo.png", "./icons/icon-192.png",
  "./js/app.js", "./js/config.js", "./js/auth.js", "./js/datos.js", "./js/dom.js", "./js/util.js", "./js/motor.js",
  "./js/calculo.js", "./js/cargar.js", "./js/precios.js", "./js/tendencia.js",
  "./vendor/msal-browser.min.js", "./vendor/xlsx.full.min.js",
];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL_FILES))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname.endsWith("sharepoint.com") || url.hostname.includes("login.microsoftonline.com")) return;
  if (url.pathname.includes("/data/")) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const c = res.clone(); caches.open(CACHE_NAME).then((k) => k.put(e.request, c)); }
    return res;
  }).catch(() => caches.match(e.request)));
});
