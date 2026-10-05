// La Madeleine · service worker : mise en cache pour ouverture hors ligne
// Change le numéro à chaque mise à jour du site pour forcer le rafraîchissement
const CACHE = "madeleine-v10";
const FILES = ["./", "index.html", "manifest.webmanifest", "produits.json", "vendor/qrcode.js",
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
  // (sauf les photos envoyées par l'atelier, qui ne changent jamais)
  const chemin = new URL(e.request.url).pathname;
  if (chemin.includes("/api/") && !chemin.includes("/api/image/")) return;
  // Numéro de version : toujours demandé au serveur (recherche de mise à jour)
  if (chemin.endsWith("/version.json")) return;
  // Réseau d'abord (pour avoir la dernière version), cache en secours
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    if (r.ok && new URL(e.request.url).origin === location.origin) caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});

// Notifications (messages, suivi de commande, nouveautés, mises à jour) : affichées même appli fermée
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) {}
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(fenetres => {
    fenetres.forEach(f => f.postMessage({ type: "madeleine-push", tag: d.tag }));
    return self.registration.showNotification(d.titre || "La Madeleine", {
      body: d.texte || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: d.tag || "madeleine", renotify: true,
      data: { url: new URL(d.url || "./", self.registration.scope).href }
    });
  }));
});
// Toucher la notification ouvre l'appli au bon endroit (discussion, suivi, réglages…)
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const cible = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(fenetres => {
    const f = fenetres.find(x => x.url.startsWith(self.registration.scope));
    if (f && f.navigate) return f.focus().then(() => f.navigate(cible)).catch(() => self.clients.openWindow(cible));
    return self.clients.openWindow(cible);
  }));
});
