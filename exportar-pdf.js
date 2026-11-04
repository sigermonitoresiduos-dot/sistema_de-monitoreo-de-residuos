/*
 * Informe PDF de SIGER (GAD Municipal de Buena Fe).
 *
 * Usa jsPDF + jsPDF-AutoTable (ya cargados por la página). Contenido:
 *   1. Portada: indicadores, resumen ejecutivo y gráficos.
 *   2. Mapa con los puntos numerados (fondo CARTO/OpenStreetMap).
 *   3. Inventario a colores con enlaces a Google Maps.
 *   4. Ficha de cada reporte con su fotografía y coordenadas WGS84 / UTM.
 *   5. Firmas de responsabilidad.
 */
(function (raiz, fabrica) {
    const modulo = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = modulo;
    else raiz.ExportarPDF = modulo;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const P = { ancho: 210, alto: 297, m: 14 };
    P.util = P.ancho - P.m * 2;
    const C = {
        verdeOscuro: [20, 83, 45], verde: [22, 163, 74], verdeClaro: [220, 252, 231], verdeTexto: [187, 247, 208],
        tinta: [15, 23, 42], gris: [71, 85, 105], grisSuave: [148, 163, 184], fondo: [241, 245, 249], borde: [203, 213, 225],
        blanco: [255, 255, 255], enlace: [29, 78, 216], rojo: [185, 28, 28]
    };
    const COLORES = {
        estado: { 'Pendiente': [[254, 243, 199], [146, 64, 14], [217, 119, 6]], 'En revisión': [[219, 234, 254], [30, 64, 175], [37, 99, 235]], 'Atendido': [[220, 252, 231], [22, 101, 52], [22, 163, 74]], 'Descartado': [[229, 231, 235], [55, 65, 81], [107, 114, 128]] },
        prioridad: { 'Crítica': [[254, 226, 226], [153, 27, 27], [220, 38, 38]], 'Alta': [[255, 237, 213], [154, 52, 18], [234, 88, 12]], 'Media': [[254, 249, 195], [133, 77, 14], [202, 138, 4]], 'Baja': [[220, 252, 231], [22, 101, 52], [22, 163, 74]] },
        nivel: { 'Alto': [[254, 226, 226], [153, 27, 27], [220, 38, 38]], 'Medio': [[254, 249, 195], [133, 77, 14], [202, 138, 4]], 'Bajo': [[220, 252, 231], [22, 101, 52], [22, 163, 74]] },
        tipo: { 'Orgánico': [[220, 252, 231], [22, 101, 52], [22, 163, 74]], 'Inorgánico': [[255, 237, 213], [154, 52, 18], [234, 88, 12]], 'Reciclable': [[219, 234, 254], [30, 64, 175], [37, 99, 235]], 'Peligroso': [[252, 231, 243], [157, 23, 77], [219, 39, 119]] }
    };
    const ESTADOS = ['Pendiente', 'En revisión', 'Atendido', 'Descartado'];
    const TIPOS = ['Orgánico', 'Inorgánico', 'Reciclable', 'Peligroso'];
    const PRIORIDADES = ['Crítica', 'Alta', 'Media', 'Baja'];
    const ZONA = 'America/Guayaquil';

    const fmtFecha = (d, op) => d.toLocaleString('es-EC', { timeZone: ZONA, ...op });
    const fechaHora = d => fmtFecha(d, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    const soloHora = d => fmtFecha(d, { hour: '2-digit', minute: '2-digit', hour12: false });
    const horaNumero = d => Number(fmtFecha(d, { hour: '2-digit', hour12: false })) % 24;
    const pct = (n, t) => (t ? Math.round(n * 1000 / t) / 10 : 0);
    const color = (grupo, valor, i) => COLORES[grupo]?.[valor]?.[i] || [C.fondo, C.tinta, C.verde][i];
    // Helvetica de jsPDF solo trae caracteres latinos: se quitan emojis y símbolos raros.
    const limpio = t => String(t ?? '').replace(/[^\u0009\u000A\u000D -~ -ÿ–—‘’“”•…]/g, '').trim();

    function contar(lista, clave, orden) {
        const m = new Map();
        lista.forEach(r => { const k = r[clave] || 'Sin dato'; m.set(k, (m.get(k) || 0) + 1); });
        const pares = orden ? orden.map(k => [k, m.get(k) || 0]) : [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
        return pares;
    }

    async function cargarImagen(url, max = 900, calidad = 0.82) {
        const control = new AbortController();
        const espera = setTimeout(() => control.abort(), 12000);
        try {
            const respuesta = await fetch(url, { signal: control.signal });
            if (!respuesta.ok) throw new Error('Foto no disponible');
            const blob = await respuesta.blob();
            const enlace = URL.createObjectURL(blob);
            try {
                const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('Formato no compatible')); i.src = enlace; });
                const escala = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
                const lienzo = document.createElement('canvas');
                lienzo.width = Math.max(1, Math.round(img.naturalWidth * escala));
                lienzo.height = Math.max(1, Math.round(img.naturalHeight * escala));
                const ctx = lienzo.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, lienzo.width, lienzo.height);
                ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
                return { data: lienzo.toDataURL('image/jpeg', calidad), w: lienzo.width, h: lienzo.height };
            } finally { URL.revokeObjectURL(enlace); }
        } finally { clearTimeout(espera); }
    }

    // ───────────── Mapa con fondo de teselas y puntos numerados ─────────────
    function aPixel(lat, lon, z) {
        const n = 256 * 2 ** z, r = lat * Math.PI / 180;
        return { x: (lon + 180) / 360 * n, y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n };
    }

    function cargarTesela(url) {
        return new Promise((ok, mal) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const t = setTimeout(() => mal(new Error('tiempo')), 9000);
            img.onload = () => { clearTimeout(t); ok(img); };
            img.onerror = () => { clearTimeout(t); mal(new Error('tesela')); };
            img.src = url;
        });
    }

    async function dibujarMapa(puntos, plantilla) {
        if (!puntos.length) return null;
        const W = 900, H = 560, S = 2, MARGEN = 70;
        let z = 17, px;
        for (; z >= 9; z--) {
            px = puntos.map(p => aPixel(p.lat, p.lon, z));
            const xs = px.map(p => p.x), ys = px.map(p => p.y);
            if (Math.max(...xs) - Math.min(...xs) <= W - MARGEN * 2 && Math.max(...ys) - Math.min(...ys) <= H - MARGEN * 2) break;
        }
        if (puntos.length === 1) { z = 16; px = puntos.map(p => aPixel(p.lat, p.lon, z)); }
        const xs = px.map(p => p.x), ys = px.map(p => p.y);
        const x0 = (Math.min(...xs) + Math.max(...xs)) / 2 - W / 2;
        const y0 = (Math.min(...ys) + Math.max(...ys)) / 2 - H / 2;

        const lienzo = document.createElement('canvas');
        lienzo.width = W * S; lienzo.height = H * S;
        const ctx = lienzo.getContext('2d');
        ctx.scale(S, S);
        ctx.fillStyle = '#eef2f0'; ctx.fillRect(0, 0, W, H);

        let teselasOk = 0;
        if (plantilla) {
            const tareas = [];
            const max = 2 ** z;
            for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W) / 256); tx++) {
                for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + H) / 256); ty++) {
                    if (ty < 0 || ty >= max) continue;
                    const url = plantilla.replace('{s}', 'abcd'[Math.abs(tx + ty) % 4]).replace('{z}', z)
                        .replace('{x}', ((tx % max) + max) % max).replace('{y}', ty).replace('{r}', '@2x');
                    tareas.push(cargarTesela(url).then(img => { ctx.drawImage(img, tx * 256 - x0, ty * 256 - y0, 256, 256); teselasOk++; }).catch(() => {}));
                }
            }
            await Promise.all(tareas);
        }
        if (!teselasOk) {
            ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 1;
            for (let x = 0; x < W; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
            for (let y = 0; y < H; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        }

        // Separa los marcadores que se tapan (espiral) y los une con una línea a su lugar real.
        const colocados = [];
        const marcadores = puntos.map((p, i) => {
            const rx = px[i].x - x0, ry = px[i].y - y0;
            let x = rx, y = ry;
            for (let paso = 0; paso < 80 && colocados.some(c => Math.hypot(c.x - x, c.y - y) < 25); paso++) {
                const ang = paso * 0.9, dist = 14 + paso * 2.2;
                x = rx + Math.cos(ang) * dist; y = ry + Math.sin(ang) * dist;
            }
            const m = { p, x, y, rx, ry };
            colocados.push(m);
            return m;
        });
        for (const m of marcadores) {
            if (Math.hypot(m.x - m.rx, m.y - m.ry) < 2) continue;
            ctx.beginPath(); ctx.moveTo(m.rx, m.ry); ctx.lineTo(m.x, m.y);
            ctx.strokeStyle = 'rgba(15,23,42,.55)'; ctx.lineWidth = 1.2; ctx.stroke();
            ctx.beginPath(); ctx.arc(m.rx, m.ry, 2.6, 0, Math.PI * 2); ctx.fillStyle = '#0f172a'; ctx.fill();
        }
        // Los críticos se dibujan al final para que queden encima.
        const orden = marcadores.slice().sort((a, b) => (a.p.critico ? 1 : 0) - (b.p.critico ? 1 : 0));
        for (const { p, x, y } of orden) {
            const r = p.numero > 99 ? 13 : 11;
            ctx.beginPath(); ctx.arc(x + 1.5, y + 2, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill();
            if (p.critico) { ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 3; ctx.stroke(); }
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = `rgb(${p.color.join(',')})`; ctx.fill();
            ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.font = `bold ${p.numero > 99 ? 10 : 11}px Arial`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(p.numero), x, y + 0.5);
        }
        if (teselasOk) {
            const texto = '© OpenStreetMap  © CARTO';
            ctx.font = '10px Arial'; const w = ctx.measureText(texto).width + 10;
            ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(W - w, H - 16, w, 16);
            ctx.fillStyle = '#334155'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(texto, W - 5, H - 8);
        }
        try {
            return { data: lienzo.toDataURL('image/jpeg', 0.86), w: W, h: H, fondo: teselasOk > 0 };
        } catch (e) {
            return null; // lienzo bloqueado por CORS
        }
    }

    /*
     * reportes: mismo formato que ExportarExcel.generar.
     * meta: { dia, exportadoPor, nombreArchivo, plantillaMapa, progreso(texto) }
     */
    async function generar(reportes, meta = {}) {
        const avisar = meta.progreso || (() => {});
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
        const dia = limpio(meta.dia || 'Reportes del día');
        doc.setProperties({ title: `Informe de reportes de residuos - ${dia}`, subject: 'SIGER - GAD Municipal de Buena Fe', author: 'SIGER', creator: 'SIGER - Sistema de Monitoreo de Residuos' });

        const lista = reportes.slice().sort((a, b) => a.fecha - b.fecha).map((r, i) => ({ ...r, numero: i + 1 }));
        const total = lista.length;
        const n = (clave, valor) => lista.filter(r => r[clave] === valor).length;
        const atendidos = n('estado', 'Atendido');
        const criticos = n('prioridad', 'Crítica');
        const conFotos = lista.filter(r => r.fotos.length).length;
        const porEstado = contar(lista, 'estado', ESTADOS);
        const porTipo = contar(lista, 'tipo', TIPOS);
        const porPrioridad = contar(lista, 'prioridad', PRIORIDADES);
        const porSector = contar(lista.map(r => ({ ...r, sector: limpio(r.sector) || 'Sin sector' })), 'sector');

        let y = 0;
        const fuente = (tam, estilo = 'normal', col = C.tinta) => { doc.setFont('helvetica', estilo); doc.setFontSize(tam); doc.setTextColor(...col); };
        const encabezadoInterno = () => {
            doc.setFillColor(...C.verdeOscuro); doc.rect(0, 0, P.ancho, 13, 'F');
            doc.setFillColor(...C.verde); doc.rect(0, 13, P.ancho, 1.2, 'F');
            fuente(9, 'bold', C.blanco); doc.text('Informe de reportes de residuos · GAD Municipal de Buena Fe', P.m, 8.5);
            fuente(8, 'normal', C.verdeTexto); doc.text(dia, P.ancho - P.m, 8.5, { align: 'right' });
        };
        const nuevaPagina = () => { doc.addPage(); encabezadoInterno(); y = 22; };
        const espacio = alto => { if (y + alto > P.alto - 20) nuevaPagina(); };
        const tituloSeccion = (texto, sub) => {
            espacio(16);
            doc.setFillColor(...C.verde); doc.rect(P.m, y - 4.2, 1.6, 6, 'F');
            fuente(12.5, 'bold', C.verdeOscuro); doc.text(texto, P.m + 4, y);
            if (sub) { fuente(8, 'normal', C.gris); doc.text(sub, P.m + 4, y + 4.6); y += 4.6; }
            y += 6;
        };

        // ───────────── 1. PORTADA ─────────────
        avisar('Armando la portada...');
        doc.setFillColor(...C.verdeOscuro); doc.rect(0, 0, P.ancho, 50, 'F');
        doc.setFillColor(...C.verde); doc.rect(0, 50, P.ancho, 2, 'F');
        doc.setFillColor(...[34, 110, 66]); doc.circle(P.ancho - 8, 2, 30, 'F');
        doc.setFillColor(...[28, 96, 56]); doc.circle(P.ancho - 30, 46, 14, 'F');
        fuente(8, 'bold', C.verdeTexto); doc.text('GAD MUNICIPAL DEL CANTÓN BUENA FE  ·  LOS RÍOS', P.m, 13);
        fuente(21, 'bold', C.blanco); doc.text('Informe de reportes de residuos', P.m, 25);
        fuente(9.5, 'normal', C.verdeTexto); doc.text('Sistema de Monitoreo de Residuos (SIGER)  ·  Universidad Técnica Estatal de Quevedo', P.m, 32.5);
        doc.setFillColor(255, 255, 255); doc.roundedRect(P.m, 37, 118, 9, 1.8, 1.8, 'F');
        fuente(7, 'bold', C.gris); doc.text('DÍA CONSULTADO', P.m + 3, 42.6);
        fuente(9.5, 'bold', C.verdeOscuro); doc.text(dia, P.m + 27, 42.8);
        fuente(7.5, 'normal', C.gris);
        doc.text(`Generado el ${fechaHora(new Date())} (hora de Ecuador)  ·  Por: ${limpio(meta.exportadoPor || 'Administrador')}`, P.m, 58);
        y = 63;

        const kpis = [
            ['Total de reportes', total, C.verdeOscuro], ['Pendientes', n('estado', 'Pendiente'), [217, 119, 6]],
            ['En revisión', n('estado', 'En revisión'), [37, 99, 235]], ['Atendidos', atendidos, C.verde],
            ['Puntos críticos', criticos, [220, 38, 38]], ['Con fotografías', conFotos, [124, 58, 237]],
            ['Descartados', n('estado', 'Descartado'), [107, 114, 128]], ['% atendido', `${Math.round(pct(atendidos, total))}%`, [15, 118, 110]]
        ];
        const anchoK = (P.util - 3 * 4) / 4;
        kpis.forEach(([etq, val, col], i) => {
            const x = P.m + (i % 4) * (anchoK + 4), yy = y + Math.floor(i / 4) * 24;
            doc.setFillColor(...C.fondo); doc.setDrawColor(...C.borde); doc.setLineWidth(0.2);
            doc.roundedRect(x, yy, anchoK, 20, 2, 2, 'FD');
            doc.setFillColor(...col); doc.rect(x, yy + 0.2, 1.6, 19.6, 'F');
            fuente(6.8, 'bold', C.gris); doc.text(etq.toUpperCase(), x + 5, yy + 6.5);
            fuente(17, 'bold', col); doc.text(String(val), x + 5, yy + 16);
        });
        y += 54;

        // Resumen ejecutivo escrito automáticamente.
        tituloSeccion('Resumen ejecutivo');
        const [sectorTop, sectorTopN] = porSector[0] || ['—', 0];
        const tipoTop = porTipo.slice().sort((a, b) => b[1] - a[1])[0] || ['—', 0];
        const horas = Array(24).fill(0); lista.forEach(r => { horas[horaNumero(r.fecha)]++; });
        const horaPico = horas.indexOf(Math.max(...horas));
        const frases = total ? [
            `Durante ${dia.charAt(0).toLowerCase() + dia.slice(1)} se registraron ${total} reporte(s) ciudadano(s) de residuos en el cantón Buena Fe.`,
            `El sector con más reportes fue ${sectorTop} (${sectorTopN}; ${pct(sectorTopN, total)}%) y el tipo de residuo más frecuente fue ${tipoTop[0].toLowerCase()} (${pct(tipoTop[1], total)}%).`,
            criticos ? `Se identificaron ${criticos} reporte(s) en puntos críticos (varios reportes cercanos), que conviene atender primero.` : 'No se identificaron puntos críticos.',
            `Hasta la hora de este informe se ha atendido el ${Math.round(pct(atendidos, total))}% de los reportes; ${n('estado', 'Pendiente') + n('estado', 'En revisión')} siguen activos.`,
            `La mayor cantidad de reportes llegó entre las ${String(horaPico).padStart(2, '0')}:00 y las ${String(horaPico).padStart(2, '0')}:59.`
        ] : ['No hay reportes registrados para el día consultado.'];
        fuente(9.5, 'normal', C.tinta);
        const parrafo = doc.splitTextToSize(frases.join(' '), P.util);
        doc.text(parrafo, P.m, y, { lineHeightFactor: 1.45 });
        y += parrafo.length * 4.9 + 5;

        // Gráficos de barras horizontales.
        const barras = (x, yy, ancho, titulo, pares, grupo, colorFijo) => {
            fuente(9.5, 'bold', C.tinta); doc.text(titulo, x, yy);
            let fy = yy + 4;
            const maximo = Math.max(1, ...pares.map(p => p[1]));
            pares.forEach(([nombre, cant]) => {
                const etiqueta = doc.splitTextToSize(limpio(nombre), 27)[0];
                fuente(8, 'normal', C.gris); doc.text(etiqueta, x, fy + 3.4);
                const xb = x + 29, ab = ancho - 29 - 20;
                doc.setFillColor(...C.fondo); doc.roundedRect(xb, fy, ab, 4.6, 1, 1, 'F');
                if (cant) { doc.setFillColor(...(colorFijo || color(grupo, nombre, 2))); doc.roundedRect(xb, fy, Math.max(2, ab * cant / maximo), 4.6, 1, 1, 'F'); }
                fuente(8, 'bold', C.tinta); doc.text(`${cant}`, x + ancho - 12, fy + 3.4, { align: 'right' });
                fuente(7, 'normal', C.grisSuave); doc.text(`${Math.round(pct(cant, total))}%`, x + ancho, fy + 3.4, { align: 'right' });
                fy += 6.4;
            });
            return fy;
        };
        const mitad = (P.util - 8) / 2;
        espacio(36);
        let fin = Math.max(barras(P.m, y, mitad, 'Por estado', porEstado, 'estado'), barras(P.m + mitad + 8, y, mitad, 'Por tipo de residuo', porTipo, 'tipo'));
        y = fin + 5;
        const topSectores = porSector.slice(0, 5);
        espacio(10 + Math.max(4, topSectores.length) * 6.4);
        fin = Math.max(barras(P.m, y, mitad, 'Por prioridad', porPrioridad, 'prioridad'), barras(P.m + mitad + 8, y, mitad, 'Sectores con más reportes', topSectores, null, [14, 165, 233]));
        y = fin + 6;

        // Reportes por hora (columnas).
        espacio(38);
        fuente(9.5, 'bold', C.tinta); doc.text('Reportes por hora del día (hora de Ecuador)', P.m, y);
        const alto = 22, base = y + 4 + alto, anchoCol = P.util / 24, maxH = Math.max(1, ...horas);
        doc.setDrawColor(...C.borde); doc.setLineWidth(0.2); doc.line(P.m, base, P.m + P.util, base);
        horas.forEach((cant, h) => {
            const x = P.m + h * anchoCol;
            if (cant) {
                const hh = alto * cant / maxH;
                doc.setFillColor(...(h === horaPico ? [217, 119, 6] : [251, 191, 36])); doc.rect(x + 0.7, base - hh, anchoCol - 1.4, hh, 'F');
                fuente(6.5, 'bold', C.tinta); doc.text(String(cant), x + anchoCol / 2, base - hh - 1, { align: 'center' });
            }
            if (h % 3 === 0) { fuente(6.5, 'normal', C.grisSuave); doc.text(`${String(h).padStart(2, '0')}h`, x + anchoCol / 2, base + 3.6, { align: 'center' }); }
        });
        y = base + 8;

        // ───────────── 2. MAPA ─────────────
        const conCoordenadas = lista.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));
        if (conCoordenadas.length) {
            avisar('Dibujando el mapa...');
            nuevaPagina();
            tituloSeccion('Mapa de ubicación de los reportes', 'Cada número corresponde al N° del reporte en el inventario y en las fichas.');
            let mapa = null;
            try {
                mapa = await dibujarMapa(conCoordenadas.map(r => ({ lat: r.lat, lon: r.lon, numero: r.numero, critico: r.prioridad === 'Crítica', color: color('tipo', r.tipo, 2) })), meta.plantillaMapa);
            } catch (e) { mapa = null; }
            if (mapa) {
                const alt = P.util * mapa.h / mapa.w;
                doc.setDrawColor(...C.borde); doc.setLineWidth(0.3);
                doc.addImage(mapa.data, 'JPEG', P.m, y, P.util, alt);
                doc.roundedRect(P.m, y, P.util, alt, 1.5, 1.5, 'S');
                y += alt + 6;
                // Leyenda
                let lx = P.m;
                fuente(8, 'bold', C.gris); doc.text('Tipo de residuo:', lx, y); lx += 25;
                TIPOS.forEach(t => {
                    doc.setFillColor(...color('tipo', t, 2)); doc.circle(lx + 1.6, y - 1.1, 1.8, 'F');
                    fuente(8, 'normal', C.tinta); doc.text(t, lx + 4.5, y); lx += doc.getTextWidth(t) + 10;
                });
                doc.setDrawColor(220, 38, 38); doc.setLineWidth(0.6); doc.circle(lx + 1.6, y - 1.1, 2.2, 'S');
                fuente(8, 'normal', C.tinta); doc.text('Punto crítico', lx + 5, y);
                y += 8;
                if (!mapa.fondo) { fuente(7.5, 'italic', C.gris); doc.text('No se pudo descargar el fondo del mapa; se muestran solo las posiciones relativas.', P.m, y); y += 6; }
            } else {
                fuente(9, 'italic', C.gris); doc.text('No se pudo generar el mapa en este equipo.', P.m, y); y += 8;
            }
        }

        // ───────────── 3. INVENTARIO ─────────────
        avisar('Armando el inventario...');
        espacio(40);
        tituloSeccion('Inventario de reportes', `${total} reporte(s) ordenados por hora de llegada.`);
        doc.autoTable({
            startY: y,
            margin: { left: P.m, right: P.m, top: 22, bottom: 20 },
            head: [['N°', 'Código', 'Hora', 'Tipo', 'Sector / barrio', 'Nivel', 'Prioridad', 'Estado', 'Mapa']],
            body: lista.map(r => [r.numero, r.codigo, soloHora(r.fecha), r.tipo, limpio(r.sector), r.nivel, r.prioridad, r.estado, Number.isFinite(r.lat) ? 'Abrir' : '—']),
            theme: 'grid',
            styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.2, textColor: C.tinta, lineColor: C.borde, lineWidth: 0.15, valign: 'middle' },
            headStyles: { fillColor: C.verdeOscuro, textColor: 255, fontStyle: 'bold', halign: 'center', fontSize: 8 },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            columnStyles: {
                0: { halign: 'center', cellWidth: 9, fontStyle: 'bold' }, 1: { cellWidth: 27, fontStyle: 'bold', textColor: C.verdeOscuro },
                2: { halign: 'center', cellWidth: 13 }, 3: { halign: 'center', cellWidth: 21 }, 4: { cellWidth: 'auto' },
                5: { halign: 'center', cellWidth: 15 }, 6: { halign: 'center', cellWidth: 17 }, 7: { halign: 'center', cellWidth: 21 },
                8: { halign: 'center', cellWidth: 13, textColor: C.enlace }
            },
            didParseCell: d => {
                if (d.section !== 'body') return;
                const grupo = { 3: 'tipo', 5: 'nivel', 6: 'prioridad', 7: 'estado' }[d.column.index];
                if (grupo && COLORES[grupo][d.cell.raw]) {
                    d.cell.styles.fillColor = color(grupo, d.cell.raw, 0);
                    d.cell.styles.textColor = color(grupo, d.cell.raw, 1);
                    d.cell.styles.fontStyle = 'bold';
                }
            },
            didDrawCell: d => {
                if (d.section === 'body' && d.column.index === 8) {
                    const r = lista[d.row.index];
                    if (r && Number.isFinite(r.lat)) doc.link(d.cell.x, d.cell.y, d.cell.width, d.cell.height, { url: `https://www.google.com/maps?q=${r.lat},${r.lon}` });
                }
            },
            didDrawPage: () => { if (doc.getCurrentPageInfo().pageNumber > 1) encabezadoInterno(); }
        });
        y = doc.lastAutoTable.finalY + 10;

        // ───────────── 4. FICHAS ─────────────
        if (total) {
            nuevaPagina();
            tituloSeccion('Fichas de los reportes', 'Detalle de cada reporte con su evidencia fotográfica.');
            const ALTO_FICHA = 66;
            for (const r of lista) {
                espacio(ALTO_FICHA + 4);
                avisar(`Preparando ficha ${r.numero} de ${total}...`);
                const x = P.m, yy = y, colEst = color('estado', r.estado, 2);
                doc.setFillColor(255, 255, 255); doc.setDrawColor(...C.borde); doc.setLineWidth(0.25);
                doc.roundedRect(x, yy, P.util, ALTO_FICHA, 2, 2, 'FD');
                doc.setFillColor(...colEst); doc.rect(x, yy + 0.3, 1.8, ALTO_FICHA - 0.6, 'F');
                // Cabecera
                doc.setFillColor(...C.fondo); doc.rect(x + 1.8, yy + 0.3, P.util - 2.1, 9, 'F');
                fuente(10.5, 'bold', C.verdeOscuro); doc.text(`N° ${r.numero}  ·  ${r.codigo}`, x + 5, yy + 6.3);
                const chip = (texto, grupo, xd) => {
                    fuente(7.5, 'bold', color(grupo, texto, 1));
                    const w = doc.getTextWidth(texto) + 6;
                    doc.setFillColor(...color(grupo, texto, 0)); doc.roundedRect(xd - w, yy + 2.2, w, 5.2, 2.4, 2.4, 'F');
                    doc.text(texto, xd - w / 2, yy + 5.9, { align: 'center' });
                    return xd - w - 2;
                };
                let xc = chip(r.estado, 'estado', x + P.util - 3);
                xc = chip(r.prioridad, 'prioridad', xc);
                chip(r.tipo, 'tipo', xc);

                // Foto
                const fx = x + 5, fy = yy + 12, fw = 58, fh = 43.5;
                let foto = null;
                if (r.fotos[0]) { try { foto = await cargarImagen(r.fotos[0]); } catch (e) { foto = null; } }
                doc.setFillColor(...C.fondo); doc.roundedRect(fx, fy, fw, fh, 1.5, 1.5, 'F');
                if (foto) {
                    const esc = Math.min(fw / foto.w, fh / foto.h), w = foto.w * esc, h = foto.h * esc;
                    doc.addImage(foto.data, 'JPEG', fx + (fw - w) / 2, fy + (fh - h) / 2, w, h);
                    doc.link(fx, fy, fw, fh, { url: r.fotos[0] });
                } else {
                    fuente(8, 'italic', C.grisSuave);
                    doc.text(r.fotos.length ? 'Foto no disponible' : 'Sin fotografía', fx + fw / 2, fy + fh / 2, { align: 'center' });
                }
                if (r.fotos.length) {
                    let lx = fx;
                    r.fotos.slice(0, 3).forEach((url, i) => {
                        fuente(7, 'normal', C.enlace);
                        const t = `Foto ${i + 1}`;
                        doc.textWithLink(t, lx, fy + fh + 4, { url });
                        lx += doc.getTextWidth(t) + 4;
                    });
                }

                // Datos
                const dx = fx + fw + 6, anchoDatos = P.util - fw - 16;
                const filas = [
                    ['Fecha y hora', fechaHora(r.fecha)],
                    ['Clasificación', limpio(r.subtipo) || '—'],
                    ['Sector / barrio', limpio(r.sector) || '—'],
                    ['Nivel', r.nivel || '—'],
                    ['Reportante', limpio(r.reportante) || 'Anónimo'],
                    ['Coordenadas', Number.isFinite(r.lat) ? `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}` : '—'],
                    ['UTM 17 Sur', r.utm ? `E ${Math.round(r.utm.este).toLocaleString('es-EC')}  ·  N ${Math.round(r.utm.norte).toLocaleString('es-EC')}` : '—'],
                    ['Ubicación', limpio(r.origen) || '—']
                ];
                let ly = fy + 3;
                filas.forEach(([k, v]) => {
                    fuente(7.5, 'bold', C.gris); doc.text(k, dx, ly);
                    fuente(8, 'normal', C.tinta); doc.text(doc.splitTextToSize(v, anchoDatos - 27)[0], dx + 27, ly);
                    ly += 4.6;
                });
                fuente(7.5, 'bold', C.gris); doc.text('Descripción', dx, ly + 0.6);
                fuente(8, 'normal', C.tinta);
                let lineas = doc.splitTextToSize(limpio(r.descripcion) || '—', anchoDatos - 27);
                if (lineas.length > 2) lineas = [lineas[0], lineas[1].replace(/\s*\S*$/, '') + '…'];
                doc.text(lineas, dx + 27, ly + 0.6, { lineHeightFactor: 1.3 });
                if (Number.isFinite(r.lat)) {
                    fuente(7.5, 'bold', C.enlace);
                    doc.textWithLink('Ver en Google Maps', dx, yy + ALTO_FICHA - 3.5, { url: `https://www.google.com/maps?q=${r.lat},${r.lon}` });
                }
                y = yy + ALTO_FICHA + 5;
            }
        }

        // ───────────── 5. FIRMAS ─────────────
        espacio(42);
        y += 6;
        tituloSeccion('Responsables');
        y += 14;
        const anchoF = (P.util - 20) / 2;
        [['Elaborado por', 'Responsable técnico · SIGER'], ['Revisado por', 'GAD Municipal de Buena Fe']].forEach(([t, s], i) => {
            const x = P.m + i * (anchoF + 20);
            doc.setDrawColor(...C.gris); doc.setLineWidth(0.3); doc.line(x, y, x + anchoF, y);
            fuente(9, 'bold', C.tinta); doc.text(t, x + anchoF / 2, y + 5, { align: 'center' });
            fuente(8, 'normal', C.gris); doc.text(s, x + anchoF / 2, y + 9.5, { align: 'center' });
        });

        // ───────────── Pie de página ─────────────
        const paginas = doc.getNumberOfPages();
        for (let i = 1; i <= paginas; i++) {
            doc.setPage(i);
            doc.setDrawColor(...C.borde); doc.setLineWidth(0.3); doc.line(P.m, P.alto - 13, P.ancho - P.m, P.alto - 13);
            fuente(7.5, 'normal', C.gris);
            doc.text('SIGER · Sistema de Monitoreo de Residuos · GAD Municipal de Buena Fe', P.m, P.alto - 8.5);
            fuente(7.5, 'bold', C.verdeOscuro);
            doc.text(`Página ${i} de ${paginas}`, P.ancho - P.m, P.alto - 8.5, { align: 'right' });
        }

        avisar('Guardando el PDF...');
        if (meta.devolver) return doc.output('arraybuffer');
        doc.save(meta.nombreArchivo || 'SIGER_Informe.pdf');
        return null;
    }

    return { generar };
});
