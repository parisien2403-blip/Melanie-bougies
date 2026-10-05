// Boudoir & Vanille · service worker : ouverture rapide et hors ligne
// Change le numéro à chaque mise à jour du site pour forcer le rafraîchissement
const CACHE = "madeleine-v13";
// Le strict nécessaire à l'ouverture hors ligne ; le reste (photos, icônes…) est rangé au fil de la navigation
const FILES = ["./", "index.html", "manifest.webmanifest", "produits.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url), chemin = url.pathname;
  // Boutique en ligne (comptes, commandes, stock) et numéro de version : toujours en direct
  if (chemin.includes("/api/") && !chemin.includes("/api/image/")) return;
  if (chemin.endsWith("/version.json")) return;
  const local = url.origin === location.origin;
  const polices = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!local && !polices) return;
  // Photos, icônes, textures, bibliothèques, polices : servies tout de suite depuis l'appareil,
  // puis rafraîchies en arrière-plan (une photo remplacée apparaît à la visite suivante)
  if (polices || /\.(jpe?g|png|webp|svg|woff2?|js)$/.test(chemin) || chemin.includes("/api/image/")) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const garde = await c.match(e.request);
      const frais = fetch(e.request).then(r => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()); return r; }).catch(() => garde);
      if (garde) { e.waitUntil(frais); return garde; }
      return frais;
    }));
    return;
  }
  // Page et données : le réseau d'abord (dernière version), l'appareil en secours
  e.respondWith(fetch(e.request).then(r => {
    const copie = r.clone();
    if (r.ok) caches.open(CACHE).then(c => c.put(e.request, copie));
    return r;
  }).catch(() => caches.match(e.request)));
});

// Notifications (messages, suivi de commande, nouveautés, mises à jour) : affichées même appli fermée
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) {}
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(fenetres => {
    fenetres.forEach(f => f.postMessage({ type: "madeleine-push", tag: d.tag }));
    return self.registration.showNotification(d.titre || "Boudoir & Vanille", {
      body: d.texte || "", icon: "icons/icon-192.jpg", badge: "icons/favicon-48.png", tag: d.tag || "madeleine", renotify: true,
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
