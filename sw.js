/* Service worker — Heures KA-RÉ
   Fichiers de l'appli : réseau d'abord, cache en secours. On a toujours la
   dernière version quand il y a du réseau, et l'appli s'ouvre quand même sans.
   Les échanges avec Make ne passent jamais par le cache. */
var CACHE = "kare-heures-v1";
var FICHIERS = ["./", "./index.html", "./style.css", "./app.js", "./logo.png",
  "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FICHIERS); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (cles) {
    return Promise.all(cles.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (rep) {
    var copie = rep.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copie); });
    return rep;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (r) {
      return r || caches.match("./index.html");
    });
  }));
});
