/*
 * Nombres de sectores y barrios de Buena Fe.
 *
 * - "SAN FELIPE", "san felipe" y "San  Felipe" son el mismo sector: se
 *   comparan por una clave sin mayúsculas, tildes ni signos.
 * - Se muestran siempre con el mismo formato ("San Felipe").
 * - Si existe un nombre oficial (capa de barrios dibujada en ArcMap o lugares
 *   del cantón), se usa ese nombre.
 * - Con la capa de barrios, se detecta el barrio a partir de las coordenadas.
 */
(function (raiz, fabrica) {
    const modulo = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = modulo;
    else raiz.Sectores = modulo;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'a', 'por', 'al']);
    const PREFIJOS = new Set(['recinto', 'barrio', 'ciudadela', 'urbanizacion', 'cooperativa', 'lotizacion', 'sector', 'hacienda', 'colonia', 'comuna', 'comunidad']);
    const ABREVIATURAS ={ 'lot': 'Lot.', 'coop': 'Coop.', 'urb': 'Urb.', 'cdla': 'Cdla.', 'av': 'Av.', 'km': 'Km' };

    function clave(texto) {
        return String(texto ?? '')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/\b(lotizacion|lot)\b\.?/g, 'lot')
            .replace(/\b(cooperativa|coop)\b\.?/g, 'coop')
            .replace(/\b(ciudadela|cdla)\b\.?/g, 'cdla')
            .replace(/\b(urbanizacion|urb)\b\.?/g, 'urb')
            .replace(/[^a-z0-9ñ]+/g, ' ')
            .trim();
    }

    // "SAN FELIPE" → "San Felipe"; "lot. las rosas #2" → "Lot. Las Rosas #2".
    function formato(texto) {
        const limpio = String(texto ?? '').replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!limpio) return '';
        let inicio = true; // la primera palabra (o la que sigue a "Lot.", "Coop."...) va con mayúscula
        let indice = 0;
        return limpio.split(' ').map(palabra => {
            const base = palabra.toLowerCase();
            const sinPunto = base.replace(/\.$/, '');
            if (ABREVIATURAS[sinPunto]) { inicio = true; return ABREVIATURAS[sinPunto]; }
            const esInicio = inicio;
            const despuesDePrefijo = esInicio && indice > 0;
            indice++;
            // "Recinto Los Amazu", "Barrio de la Paz": tras el tipo, el nombre
            // empieza con mayúscula salvo "de"/"del".
            inicio = esInicio && PREFIJOS.has(base.normalize('NFD').replace(/[̀-ͯ]/g, ''));
            if (/^\d/.test(base) || /^#/.test(base)) return base;
            if (/^(i{1,3}|iv|v|vi{0,3}|ix|x)$/.test(base) && !esInicio) return base.toUpperCase();
            if (despuesDePrefijo && /^(de|del|y|e|en|a|por|al)$/.test(base)) return base;
            if (!esInicio && MINUSCULAS.has(base)) return base;
            return base.charAt(0).toUpperCase() + base.slice(1);
        }).join(' ');
    }

    const tildes = t => (String(t).normalize('NFD').match(/[̀-ͯ]/g) || []).length;

    // Catálogo: clave → nombre oficial.
    function crearCatalogo(nombres) {
        const catalogo = new Map();
        (nombres || []).forEach(nombre => {
            const visible = formato(nombre);
            const k = clave(visible);
            if (!k) return;
            const previo = catalogo.get(k);
            if (!previo || tildes(visible) > tildes(previo)) catalogo.set(k, visible);
        });
        return catalogo;
    }

    function canonico(texto, catalogo) {
        const k = clave(texto);
        if (!k) return '';
        return catalogo?.get(k) || formato(texto);
    }

    // Unifica los sectores de una lista de reportes (en memoria). Para cada
    // clave elige el nombre oficial o, si no hay, la forma más repetida
    // (y con tildes si empatan). Guarda el texto original en sectorOriginal.
    function unificarReportes(reportes, catalogo) {
        const variantes = new Map();
        reportes.forEach(r => {
            const k = clave(r.sector);
            if (!k) return;
            const v = formato(r.sector);
            if (!variantes.has(k)) variantes.set(k, new Map());
            const m = variantes.get(k);
            m.set(v, (m.get(v) || 0) + 1);
        });
        const elegido = new Map();
        variantes.forEach((m, k) => {
            if (catalogo?.has(k)) { elegido.set(k, catalogo.get(k)); return; }
            const [mejor] = [...m.entries()].sort((a, b) => b[1] - a[1] || tildes(b[0]) - tildes(a[0]) || a[0].localeCompare(b[0], 'es'));
            elegido.set(k, mejor[0]);
        });
        reportes.forEach(r => {
            const k = clave(r.sector);
            if (!k) return;
            if (r.sectorOriginal === undefined) r.sectorOriginal = r.sector;
            r.sector = elegido.get(k);
        });
        return reportes;
    }

    // ───── Barrios dibujados (GeoJSON en WGS84) ─────
    function dentroAnillo(x, y, anillo) {
        let dentro = false;
        for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
            const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) dentro = !dentro;
        }
        return dentro;
    }

    function dentroPoligono(x, y, poligono) {
        if (!poligono.length || !dentroAnillo(x, y, poligono[0])) return false;
        for (let h = 1; h < poligono.length; h++) if (dentroAnillo(x, y, poligono[h])) return false;
        return true;
    }

    function dentroGeometria(lat, lon, geometria) {
        if (!geometria) return false;
        if (geometria.type === 'Polygon') return dentroPoligono(lon, lat, geometria.coordinates);
        if (geometria.type === 'MultiPolygon') return geometria.coordinates.some(p => dentroPoligono(lon, lat, p));
        return false;
    }

    // Devuelve la feature del barrio que contiene el punto (o null).
    function barrioEn(lat, lon, geojson) {
        if (!geojson?.features || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return geojson.features.find(f => dentroGeometria(lat, lon, f.geometry)) || null;
    }

    return { clave, formato, crearCatalogo, canonico, unificarReportes, barrioEn, dentroGeometria };
});
