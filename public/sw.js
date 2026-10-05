// La Madeleine · service worker : mise en cache pour ouverture hors ligne
// Change le numéro à chaque mise à jour du site pour forcer le rafraîchissement
const CACHE = "madeleine-v6";
const FILES = ["./", "index.html", "manifest.webmanifest", "produits.json",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
  ...Array.from({ length: 10 }, (_, i) => `img/p${i + 1}.jpg`)];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Boutique en ligne (comptes, commandes, stock) : toujours en direct, jamais en cache
  if (new URL(e.request.url).pathname.includes("/api/")) return;
  // Réseau d'abord (pour avoir la dernière version), cache en secours
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    if (r.ok && new URL(e.request.url).origin === location.origin) caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
