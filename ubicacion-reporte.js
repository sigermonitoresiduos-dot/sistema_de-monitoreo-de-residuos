// Ubicación del reporte: GPS, coordenadas escritas (Google Maps / UTM) o un
// punto tocado en el mapa. Las funciones de conversión no dependen del
// navegador para poder probarlas con Node (tests/ubicacion-unit.cjs).
(function (raiz, fabrica) {
    const api = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.UbicacionReporte = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---------- Conversión UTM (WGS84) ----------
    const A = 6378137;
    const F = 1 / 298.257223563;
    const E2 = F * (2 - F);
    const EP2 = E2 / (1 - E2);
    const K0 = 0.9996;
    const rad = g => g * Math.PI / 180;
    const grados = r => r * 180 / Math.PI;
    const meridianoCentral = zona => (zona - 1) * 6 - 180 + 3;

    function utmALatLon(este, norte, zona = 17, sur = true) {
        const x = Number(este) - 500000;
        const y = Number(norte) - (sur ? 10000000 : 0);
        const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
        const mu = (y / K0) / (A * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256));
        const phi1 = mu
            + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
            + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
            + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
            + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
        const sen = Math.sin(phi1), cos = Math.cos(phi1), tan = Math.tan(phi1);
        const C1 = EP2 * cos ** 2, T1 = tan ** 2;
        const N1 = A / Math.sqrt(1 - E2 * sen ** 2);
        const R1 = A * (1 - E2) / (1 - E2 * sen ** 2) ** 1.5;
        const D = x / (N1 * K0);
        const lat = phi1 - (N1 * tan / R1) * (D ** 2 / 2
            - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * EP2) * D ** 4 / 24
            + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * EP2 - 3 * C1 ** 2) * D ** 6 / 720);
        const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6
            + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * EP2 + 24 * T1 ** 2) * D ** 5 / 120) / cos;
        return { lat: grados(lat), lon: meridianoCentral(zona) + grados(lon) };
    }

    function latLonAUtm(lat, lon, zona = 17) {
        const phi = rad(lat);
        const sen = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
        const N = A / Math.sqrt(1 - E2 * sen ** 2);
        const T = tan ** 2, C = EP2 * cos ** 2;
        const Aa = rad(lon - meridianoCentral(zona)) * cos;
        const M = A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * phi
            - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * phi)
            + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * phi)
            - (35 * E2 ** 3 / 3072) * Math.sin(6 * phi));
        const este = K0 * N * (Aa + (1 - T + C) * Aa ** 3 / 6
            + (5 - 18 * T + T ** 2 + 72 * C - 58 * EP2) * Aa ** 5 / 120) + 500000;
        let norte = K0 * (M + N * tan * (Aa ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * Aa ** 4 / 24
            + (61 - 58 * T + T ** 2 + 600 * C - 330 * EP2) * Aa ** 6 / 720));
        if (lat < 0) norte += 10000000;
        return { este, norte, zona, sur: lat < 0 };
    }

    // ---------- Lectura de lo que escribe la persona ----------
    const numero = t => Number(String(t).replace(',', '.'));
    const decimales = t => (String(t).split(/[.,]/)[1] || '').length;
    const pareceUtm = (a, b) => a >= 100000 && a <= 900000 && b >= 9000000 && b <= 10000000;

    function interpretarTexto(textoOriginal) {
        let texto = String(textoOriginal || '').trim();
        if (!texto) return { ok: false, error: 'Escribe o pega las coordenadas.' };
        if (/goo\.gl|maps\.app/i.test(texto)) {
            return { ok: false, error: 'Ese es un enlace corto. Ábrelo en Google Maps, mantén presionado el punto y copia los números que aparecen (ej. -0.89732, -79.49140).' };
        }
        try { texto = decodeURIComponent(texto); } catch (_) { /* se usa tal cual */ }

        // Enlaces de Google Maps: el lugar exacto (!3d!4d), ?q= / query= o @lat,lon.
        const patronesEnlace = [
            /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
            /[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i,
            /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/
        ];
        for (const patron of patronesEnlace) {
            const m = texto.match(patron);
            if (m) return { ok: true, lat: Number(m[1]), lon: Number(m[2]), formato: 'enlace', decimales: Math.min(decimales(m[1]), decimales(m[2])) };
        }

        // Grados, minutos y segundos: 0°53'50.4"S 79°29'29.0"W
        if (/[°º]/.test(texto)) {
            const gms = /(\d+(?:[.,]\d+)?)\s*[°º]\s*(?:(\d+(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:"|″|”|''|’’)\s*)?([NSEWO])/gi;
            const partes = [...texto.matchAll(gms)];
            if (partes.length === 2) {
                const valor = p => {
                    const v = numero(p[1]) + (p[2] ? numero(p[2]) / 60 : 0) + (p[3] ? numero(p[3]) / 3600 : 0);
                    return /[SWO]/i.test(p[4]) ? -v : v;
                };
                const [p1, p2] = partes;
                const latPrimero = /[NS]/i.test(p1[4]);
                return { ok: true, lat: valor(latPrimero ? p1 : p2), lon: valor(latPrimero ? p2 : p1), formato: 'gms', decimales: 6 };
            }
            return { ok: false, error: 'No pude leer los grados. Usa el formato 0°53\'50.4"S 79°29\'29.0"W o los números decimales de Google Maps.' };
        }

        const numeros = texto.match(/-?\d+(?:[.,]\d+)?/g) || [];
        if (numeros.length !== 2) {
            return { ok: false, error: 'Escribe dos números: primero la latitud y luego la longitud. Ejemplo: -0.89732, -79.49140' };
        }
        const [a, b] = numeros.map(numero);
        if (pareceUtm(a, b)) return { ok: true, ...utmALatLon(a, b), formato: 'utm', decimales: 6 };
        if (pareceUtm(b, a)) return { ok: true, ...utmALatLon(b, a), formato: 'utm', decimales: 6 };
        if (Math.abs(a) > 90 && Math.abs(b) > 90) {
            return { ok: false, error: 'Esos números parecen UTM. Usa la pestaña «UTM» y escribe Este y Norte por separado.' };
        }
        return { ok: true, lat: a, lon: b, formato: 'decimal', decimales: Math.min(decimales(numeros[0]), decimales(numeros[1])) };
    }

    function interpretarUtm(esteTexto, norteTexto) {
        const limpiar = t => String(t || '').trim().replace(/\s/g, '').replace(',', '.');
        const este = Number(limpiar(esteTexto)), norte = Number(limpiar(norteTexto));
        if (!limpiar(esteTexto) || !limpiar(norteTexto)) return { ok: false, error: 'Escribe el Este (X) y el Norte (Y).' };
        if (!Number.isFinite(este) || !Number.isFinite(norte)) return { ok: false, error: 'Usa solo números en Este y Norte.' };
        if (pareceUtm(norte, este)) return { ok: false, error: 'Parece que Este y Norte están al revés: el Este tiene 6 cifras y el Norte 7.' };
        if (este < 100000 || este > 900000) return { ok: false, error: 'El Este (X) debe tener 6 cifras, por ejemplo 667900.' };
        if (norte < 9000000 || norte > 10000000) return { ok: false, error: 'El Norte (Y) debe tener 7 cifras, por ejemplo 9900780.' };
        return { ok: true, ...utmALatLon(este, norte, 17, true), formato: 'utm', decimales: 6 };
    }

    // ---------- Validación dentro del área ----------
    const dentro = (lat, lon, l) => lat >= l.sur && lat <= l.norte && lon >= l.oeste && lon <= l.este;

    function distanciaKm(lat1, lon1, lat2, lon2) {
        const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
        return 6371 * 2 * Math.asin(Math.sqrt(h));
    }

    // Corrige los errores más comunes (signo olvidado, orden invertido) solo
    // cuando la corrección cae dentro del área; si no, explica el problema.
    function validarEnArea(lectura, limites) {
        if (!lectura.ok) return lectura;
        const { lat, lon } = lectura;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, error: 'Las coordenadas no son números válidos.' };
        const candidatos = [
            [lat, lon, ''],
            [-Math.abs(lat), -Math.abs(lon), 'Agregamos el signo menos: en Buena Fe la latitud y la longitud son negativas.'],
            [lon, lat, 'Invertimos el orden: primero va la latitud (≈ -0.9) y después la longitud (≈ -79.5).'],
            [-Math.abs(lon), -Math.abs(lat), 'Corregimos el orden y el signo de las coordenadas.']
        ];
        for (const [la, lo, aviso] of candidatos) {
            if (dentro(la, lo, limites)) {
                const avisos = [];
                if (aviso) avisos.push(aviso);
                if (lectura.decimales < 4) avisos.push('Tienes pocos decimales: el punto puede quedar a cientos de metros. Lo ideal son 5 o más.');
                return { ok: true, lat: la, lon: lo, formato: lectura.formato, avisos };
            }
        }
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, error: 'Esas coordenadas no existen. Revisa los números.' };
        const centroLat = (limites.sur + limites.norte) / 2, centroLon = (limites.oeste + limites.este) / 2;
        const km = distanciaKm(lat, lon, centroLat, centroLon);
        return { ok: false, fuera: true, lat, lon, error: `Ese punto queda fuera del cantón Buena Fe (a unos ${km < 10 ? km.toFixed(1) : Math.round(km)} km). Revisa los números.` };
    }

    const formatoDecimal = (lat, lon) => `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    const formatoUtm = (lat, lon) => {
        const u = latLonAUtm(lat, lon);
        return `UTM 17S · E ${Math.round(u.este)} · N ${Math.round(u.norte)}`;
    };

    // ---------- Interfaz (solo navegador) ----------
    const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
    const ICONOS = {
        ok: svg('<path d="M5 12.5l4.2 4.2L19 7"/>'),
        alerta: svg('<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4.5M12 17.5v.01"/>'),
        idea: svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.8.6 1.1 1.4 1.1 2.2h5c0-.8.3-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>'),
        ojo: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
        toque: svg('<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.6-2.2L4 15.6a1.6 1.6 0 0 1 2.4-2.1L9 16"/>')
    };

    function iniciar({ map, limites }) {
        const raiz = document.getElementById('ubicacionReporte');
        if (!raiz || !map || !window.L) return null;
        const lim = { sur: limites.getSouth(), norte: limites.getNorth(), oeste: limites.getWest(), este: limites.getEast() };
        const $ = sel => raiz.querySelector(sel);
        const estado = $('#ubiEstado');
        const campoTexto = $('#coordTexto');
        const campoEste = $('#utmEste');
        const campoNorte = $('#utmNorte');
        let modo = 'gps', formato = 'decimal', punto = null, marcador = null, temporizador = null;

        const iconoPin = L.divIcon({
            className: 'ubi-pin',
            html: '<span class="ubi-pin-onda"></span><span class="ubi-pin-cabeza"><svg viewBox="0 0 32 42" aria-hidden="true"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 26.6 16 41 16 41s15-14.4 15-25.2C31 7.6 24.3 1 16 1z"/><circle cx="16" cy="15.5" r="5.6"/></svg></span>',
            iconSize: [44, 44], iconAnchor: [22, 40]
        });

        function quitarMarcador() {
            if (marcador) { map.removeLayer(marcador); marcador = null; }
        }

        function ponerMarcador(lat, lon, mover = true) {
            if (!marcador) {
                marcador = L.marker([lat, lon], { icon: iconoPin, draggable: true, zIndexOffset: 2000, keyboard: false, title: 'Punto del reporte' }).addTo(map);
                marcador.on('dragend', () => {
                    const p = marcador.getLatLng();
                    if (modo === 'coordenadas') {
                        formato === 'utm' ? llenarUtm(p.lat, p.lng) : (campoTexto.value = formatoDecimal(p.lat, p.lng));
                    }
                    aplicar(validarEnArea({ ok: true, lat: p.lat, lon: p.lng, formato: 'mapa', decimales: 6 }, lim), false);
                });
            } else {
                marcador.setLatLng([lat, lon]);
            }
            if (mover) map.flyTo([lat, lon], Math.max(map.getZoom(), 17), { duration: 0.6 });
        }

        function llenarUtm(lat, lon) {
            const u = latLonAUtm(lat, lon);
            campoEste.value = Math.round(u.este);
            campoNorte.value = Math.round(u.norte);
        }

        function mostrar(tipo, html) {
            estado.hidden = !html;
            raiz.dataset.estado = tipo;
            estado.className = `ubi-estado ubi-estado-${tipo}`;
            estado.innerHTML = html || '';
        }

        function aplicar(resultado, mover = true) {
            if (!resultado) { punto = null; quitarMarcador(); mostrar('vacio', ''); return; }
            if (!resultado.ok) {
                punto = null;
                quitarMarcador();
                mostrar('error', `<div class="ubi-estado-cab"><span class="ubi-estado-icono">${ICONOS.alerta}</span>
                    <div><strong>Revisa las coordenadas</strong><small>No se puede usar este punto</small></div></div>
                    <p class="ubi-estado-texto">${resultado.error}</p>`);
                return;
            }
            punto = { lat: resultado.lat, lon: resultado.lon };
            ponerMarcador(punto.lat, punto.lon, mover);
            const utm = latLonAUtm(punto.lat, punto.lon);
            const avisos = (resultado.avisos || []).map(a => `<p class="ubi-aviso">${ICONOS.idea}<span>${a}</span></p>`).join('');
            mostrar('ok', `<div class="ubi-estado-cab"><span class="ubi-estado-icono">${ICONOS.ok}</span>
                    <div><strong>Punto listo</strong><small>Dentro del cantón Buena Fe</small></div></div>
                <dl class="ubi-datos">
                    <div><dt>Latitud, longitud</dt><dd>${formatoDecimal(punto.lat, punto.lon)}</dd></div>
                    <div><dt>UTM 17 Sur</dt><dd>E&nbsp;${Math.round(utm.este)} · N&nbsp;${Math.round(utm.norte)}</dd></div>
                </dl>${avisos}
                <button type="button" class="ubi-ver">${ICONOS.ojo}<span>Ver en el mapa</span></button>`);
            $('.ubi-ver').onclick = verMapa;
        }

        function verMapa() {
            document.getElementById('map')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (punto) map.flyTo([punto.lat, punto.lon], Math.max(map.getZoom(), 17), { duration: 0.6 });
        }

        function leerCampos() {
            if (formato === 'utm') {
                if (!campoEste.value.trim() && !campoNorte.value.trim()) return null;
                return validarEnArea(interpretarUtm(campoEste.value, campoNorte.value), lim);
            }
            if (!campoTexto.value.trim()) return null;
            return validarEnArea(interpretarTexto(campoTexto.value), lim);
        }

        function alEscribir() {
            clearTimeout(temporizador);
            temporizador = setTimeout(() => aplicar(leerCampos()), 450);
        }

        function cambiarModo(nuevo) {
            modo = nuevo;
            raiz.querySelectorAll('.ubi-panel').forEach(p => { p.hidden = p.dataset.modo !== modo; });
            raiz.dataset.modo = modo;
            map.getContainer().classList.toggle('ubi-modo-mapa', modo === 'mapa');
            punto = null;
            quitarMarcador();
            mostrar('vacio', '');
            if (modo === 'coordenadas') aplicar(leerCampos());
            if (modo === 'mapa') {
                mostrar('info', `<div class="ubi-estado-cab"><span class="ubi-estado-icono ubi-icono-toque">${ICONOS.toque}</span>
                    <div><strong>Toca el mapa</strong><small>Marca el lugar exacto del residuo</small></div></div>
                    <p class="ubi-estado-texto">Después puedes arrastrar el pin rojo para ajustarlo.</p>`);
                verMapa();
            }
        }

        function cambiarFormato(nuevo) {
            formato = nuevo;
            raiz.querySelectorAll('.ubi-formato').forEach(b => {
                const activo = b.dataset.formato === formato;
                b.classList.toggle('activo', activo);
                b.setAttribute('aria-selected', String(activo));
            });
            raiz.querySelectorAll('[data-campos]').forEach(c => { c.hidden = c.dataset.campos !== formato; });
            // Al cambiar de formato se traslada el punto ya marcado.
            if (punto) formato === 'utm' ? llenarUtm(punto.lat, punto.lon) : (campoTexto.value = formatoDecimal(punto.lat, punto.lon));
            aplicar(leerCampos(), false);
        }

        raiz.querySelectorAll('input[name="modoUbicacion"]').forEach(r => r.addEventListener('change', () => r.checked && cambiarModo(r.value)));
        raiz.querySelectorAll('.ubi-formato').forEach(b => b.addEventListener('click', () => cambiarFormato(b.dataset.formato)));
        [campoTexto, campoEste, campoNorte].forEach(c => c.addEventListener('input', alEscribir));
        campoTexto.addEventListener('paste', () => setTimeout(() => aplicar(leerCampos()), 0));
        map.on('click', e => {
            if (modo !== 'mapa') return;
            aplicar(validarEnArea({ ok: true, lat: e.latlng.lat, lon: e.latlng.lng, formato: 'mapa', decimales: 6 }, lim), false);
            if (marcador) map.panTo(e.latlng);
        });

        return {
            modo: () => modo,
            // Devuelve el punto escrito/tocado, o null si se debe usar el GPS.
            puntoManual() {
                if (modo === 'gps') return null;
                if (punto) return { ...punto, origen: modo === 'mapa' ? 'mapa' : (formato === 'utm' ? 'utm' : 'coordenadas') };
                const r = modo === 'coordenadas' ? leerCampos() : null;
                if (r && r.ok) { aplicar(r); return { lat: r.lat, lon: r.lon, origen: formato === 'utm' ? 'utm' : 'coordenadas' }; }
                if (r) aplicar(r);
                throw new Error(modo === 'mapa'
                    ? 'Toca el mapa para marcar dónde está el residuo.'
                    : (r && r.error) || 'Escribe las coordenadas del residuo.');
            },
            reiniciar() {
                campoTexto.value = ''; campoEste.value = ''; campoNorte.value = '';
                const gps = raiz.querySelector('input[value="gps"]');
                gps.checked = true;
                cambiarModo('gps');
            }
        };
    }

    const ORIGENES = {
        gps: 'GPS del celular',
        coordenadas: 'Coordenadas ingresadas a mano',
        utm: 'Coordenadas UTM ingresadas a mano',
        mapa: 'Marcado a mano en el mapa'
    };
    const textoOrigen = origen => ORIGENES[origen] || ORIGENES.gps;

    return { utmALatLon, latLonAUtm, interpretarTexto, interpretarUtm, validarEnArea, dentro, textoOrigen, formatoUtm, iniciar };
});
