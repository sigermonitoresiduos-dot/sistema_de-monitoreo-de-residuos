/*
 * Capas del cantón Buena Fe en el mapa de SIGER:
 *   - Límite del cantón y de sus parroquias (OpenStreetMap) con el exterior atenuado.
 *   - Barrios y sectores dibujados en ArcMap (barrios-buena-fe.geojson), si existen.
 *   - Catálogo de nombres oficiales (barrios + lugares del cantón) para unificar
 *     y sugerir el sector al reportar.
 * Ninguna capa intercepta los clics del mapa (elegir punto, rutas, reportes).
 */
(function (raiz) {
    'use strict';

    function iniciar({ map, alCargar } = {}) {
        if (!map || !window.L || !window.Sectores) return null;
        const L = window.L;
        const estado = { barrios: null, catalogo: window.Sectores.crearCatalogo([]), nombres: [] };

        const capaLimites = L.layerGroup().addTo(map);
        const capaBarrios = L.layerGroup();
        let control = null;

        function avisar() {
            try { alCargar?.(api); } catch (e) { console.warn(e); }
        }

        async function leer(url) {
            const respuesta = await fetch(url, { cache: 'no-cache' });
            if (!respuesta.ok) throw new Error(String(respuesta.status));
            return respuesta.json();
        }

        function dibujarLimites(gj) {
            const canton = gj.features.find(f => f.properties.tipo === 'canton');
            if (canton) {
                // Exterior atenuado: un rectángulo grande con el cantón como hueco.
                const anillos = canton.geometry.type === 'Polygon' ? [canton.geometry.coordinates[0]] : canton.geometry.coordinates.map(p => p[0]);
                const mundo = [[-5, -84], [-5, -74], [3, -74], [3, -84]];
                L.polygon([mundo, ...anillos.map(a => a.map(([x, y]) => [y, x]))], {
                    stroke: false, fillColor: '#0f172a', fillOpacity: 0.16, interactive: false
                }).addTo(capaLimites);
                L.geoJSON(canton, { interactive: false, style: { color: '#15803d', weight: 2.6, opacity: 0.9, dashArray: '7 5', fill: false } }).addTo(capaLimites);
            }
            gj.features.filter(f => f.properties.tipo === 'parroquia').forEach(f => {
                L.geoJSON(f, { interactive: false, style: { color: '#16a34a', weight: 1.2, opacity: 0.55, dashArray: '3 5', fill: false } }).addTo(capaLimites);
            });
        }

        function dibujarBarrios(gj) {
            capaBarrios.clearLayers();
            L.geoJSON(gj, {
                style: { color: '#0284c7', weight: 1.4, opacity: 0.8, fillColor: '#38bdf8', fillOpacity: 0.07 },
                onEachFeature: (f, capa) => {
                    const nombre = window.Sectores.formato(f.properties?.nombre || '');
                    if (!nombre) return;
                    capa.bindTooltip(`<strong>${nombre.replace(/[<>&]/g, '')}</strong>${f.properties?.parroquia ? `<br><small>${String(f.properties.parroquia).replace(/[<>&]/g, '')}</small>` : ''}`, { sticky: true, direction: 'top', className: 'tooltip-barrio' });
                    capa.on('mouseover', () => capa.setStyle({ fillOpacity: 0.18, weight: 2 }));
                    capa.on('mouseout', () => capa.setStyle({ fillOpacity: 0.07, weight: 1.4 }));
                }
            }).addTo(capaBarrios);
            capaBarrios.addTo(map);
            if (!control) {
                control = L.control.layers(null, { '🏘 Barrios y sectores': capaBarrios, '🗺 Límite del cantón': capaLimites }, { position: 'topright', collapsed: true }).addTo(map);
            }
        }

        function actualizarCatalogo(lugares) {
            const nombres = [
                ...(estado.barrios?.features || []).map(f => f.properties?.nombre),
                ...(lugares || []).map(l => l.nombre)
            ].filter(Boolean);
            estado.catalogo = window.Sectores.crearCatalogo(nombres);
            estado.nombres = [...new Set(estado.catalogo.values())].sort((a, b) => a.localeCompare(b, 'es'));
        }

        const api = {
            catalogo: () => estado.catalogo,
            nombres: () => estado.nombres,
            hayBarrios: () => Boolean(estado.barrios?.features?.length),
            // Barrio (nombre oficial) que contiene el punto, o '' si no hay.
            barrioEn(lat, lon) {
                const f = window.Sectores.barrioEn(lat, lon, estado.barrios);
                return f ? window.Sectores.canonico(f.properties?.nombre, estado.catalogo) : '';
            }
        };

        (async () => {
            const [limites, lugares, barrios] = await Promise.allSettled([
                leer('limites-buena-fe.geojson'), leer('lugares-buena-fe.json'), leer('barrios-buena-fe.geojson')
            ]);
            if (limites.status === 'fulfilled') { try { dibujarLimites(limites.value); } catch (e) { console.warn('Límites no dibujados', e); } }
            if (barrios.status === 'fulfilled' && barrios.value?.features?.length) {
                estado.barrios = barrios.value;
                try { dibujarBarrios(barrios.value); } catch (e) { console.warn('Barrios no dibujados', e); }
            }
            actualizarCatalogo(lugares.status === 'fulfilled' ? lugares.value : []);
            avisar();
        })();

        return api;
    }

    raiz.CapasCanton = { iniciar };
})(typeof self !== 'undefined' ? self : this);
