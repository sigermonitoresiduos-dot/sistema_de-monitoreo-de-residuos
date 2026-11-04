const CACHE = "siger-app-v11";
const ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./gad-ecuador.js",
    "./fotos-reportes.js",
    "./agrupacion-reportes.js",
    "./mapa-reportes.js",
    "./ubicacion-reporte.js",
    "./ubicacion-reporte.css",
    "./agrupacion-reportes.css",
    "./vendor/leaflet.markercluster.js",
    "./vendor/MarkerCluster.css",
    "./manifest.webmanifest",
    "./icon-192.png",
    "./icon-512.png",
    "./apple-touch-icon.png"
];

self.addEventListener("install", (evento) => {
    evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
    evento.waitUntil(
        caches.keys().then((claves) =>
            Promise.all(claves.filter((clave) => clave !== CACHE).map((clave) => caches.delete(clave)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (evento) => {
    if (evento.request.method !== "GET") return;
    const url = new URL(evento.request.url);
    if (url.origin !== self.location.origin) return;

    evento.respondWith(
        fetch(evento.request)
            .then((respuesta) => {
                const copia = respuesta.clone();
                caches.open(CACHE).then((cache) => cache.put(evento.request, copia));
                return respuesta;
            })
            .catch(() => caches.match(evento.request).then((guardada) => guardada || caches.match("./index.html")))
    );
});
