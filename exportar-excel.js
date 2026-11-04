/*
 * Exportación a Excel de SIGER (GAD Municipal de Buena Fe).
 *
 * Genera un libro con formato profesional usando ExcelJS:
 *   1. Resumen      – indicadores, tablas por estado/tipo/prioridad/nivel/origen.
 *   2. Reportes     – detalle completo con colores, filtros, enlaces y UTM.
 *   3. Por sector   – conteo por barrio con fórmulas que se recalculan.
 *   4. Por hora     – a qué horas llegan los reportes del día.
 *   5. Fotografías  – miniaturas de la evidencia (si se pudieron descargar).
 *
 * Los totales usan fórmulas (CONTAR.SI) sobre la hoja Reportes, así que si
 * el municipio cambia un estado en el Excel, el resumen se actualiza solo.
 */
(function (raiz, fabrica) {
    const modulo = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = modulo;
    else raiz.ExportarExcel = modulo;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const URL_EXCELJS = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';

    const C = {
        verdeOscuro: 'FF14532D', verde: 'FF16A34A', verdeClaro: 'FFDCFCE7', verdeSuave: 'FFF0FDF4',
        tinta: 'FF0F172A', gris: 'FF475569', grisClaro: 'FFF1F5F9', borde: 'FFCBD5E1', blanco: 'FFFFFFFF',
        enlace: 'FF1D4ED8'
    };

    // [fondo, texto] por valor.
    const COLORES = {
        estado: {
            'Pendiente': ['FFFEF3C7', 'FF92400E'], 'En revisión': ['FFDBEAFE', 'FF1E40AF'],
            'Atendido': ['FFDCFCE7', 'FF166534'], 'Descartado': ['FFE5E7EB', 'FF374151']
        },
        prioridad: {
            'Crítica': ['FFFEE2E2', 'FF991B1B'], 'Alta': ['FFFFEDD5', 'FF9A3412'],
            'Media': ['FFFEF9C3', 'FF854D0E'], 'Baja': ['FFDCFCE7', 'FF166534']
        },
        nivel: {
            'Alto': ['FFFEE2E2', 'FF991B1B'], 'Medio': ['FFFEF9C3', 'FF854D0E'], 'Bajo': ['FFDCFCE7', 'FF166534']
        },
        tipo: {
            'Orgánico': ['FFDCFCE7', 'FF166534'], 'Inorgánico': ['FFFFEDD5', 'FF9A3412'],
            'Reciclable': ['FFDBEAFE', 'FF1E40AF'], 'Peligroso': ['FFFCE7F3', 'FF9D174D']
        }
    };

    const ESTADOS = ['Pendiente', 'En revisión', 'Atendido', 'Descartado'];
    const TIPOS = ['Orgánico', 'Inorgánico', 'Reciclable', 'Peligroso'];
    const PRIORIDADES = ['Crítica', 'Alta', 'Media', 'Baja'];
    const NIVELES = ['Alto', 'Medio', 'Bajo'];
    const HORA_ECUADOR = -5 * 3600 * 1000; // Ecuador continental no tiene horario de verano.

    function cargarExcelJS() {
        if (typeof ExcelJS !== 'undefined') return Promise.resolve();
        return new Promise((ok, mal) => {
            const s = document.createElement('script');
            s.src = URL_EXCELJS;
            s.async = true;
            s.onload = () => (typeof ExcelJS !== 'undefined' ? ok() : mal(new Error('ExcelJS no quedó disponible.')));
            s.onerror = () => mal(new Error('No se pudo descargar el generador de Excel.'));
            document.head.appendChild(s);
        });
    }

    // Excel no guarda zona horaria: se escribe la hora de pared de Ecuador.
    function fechaEcuador(fecha) {
        return new Date(fecha.getTime() + HORA_ECUADOR);
    }

    function letra(n) {
        let s = '';
        for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
        return s;
    }

    function texto(v) {
        // Evita que un texto que empiece con = + - @ se interprete como fórmula.
        const t = String(v ?? '');
        return /^[=+\-@]/.test(t) ? `'${t}` : t;
    }

    const bordeFino = { style: 'thin', color: { argb: C.borde } };
    const bordes = { top: bordeFino, left: bordeFino, bottom: bordeFino, right: bordeFino };
    const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

    function pintarValor(celda, grupo, valor) {
        const par = COLORES[grupo]?.[valor];
        if (!par) return;
        celda.fill = relleno(par[0]);
        celda.font = { ...(celda.font || {}), bold: true, color: { argb: par[1] } };
        celda.alignment = { ...(celda.alignment || {}), horizontal: 'center' };
    }

    function estiloEncabezado(fila) {
        fila.height = 30;
        fila.eachCell(celda => {
            celda.fill = relleno(C.verdeOscuro);
            celda.font = { bold: true, color: { argb: C.blanco }, size: 10.5 };
            celda.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            celda.border = { ...bordes, bottom: { style: 'medium', color: { argb: C.verde } } };
        });
    }

    function bandaTitulo(hoja, columnas, titulo, subtitulo) {
        const ultima = letra(columnas);
        hoja.mergeCells(`A1:${ultima}1`);
        hoja.mergeCells(`A2:${ultima}2`);
        const t = hoja.getCell('A1');
        t.value = titulo;
        t.font = { bold: true, size: 16, color: { argb: C.blanco } };
        t.fill = relleno(C.verdeOscuro);
        t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        hoja.getRow(1).height = 34;
        const s = hoja.getCell('A2');
        s.value = subtitulo;
        s.font = { italic: true, size: 10, color: { argb: C.verdeOscuro } };
        s.fill = relleno(C.verdeClaro);
        s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        hoja.getRow(2).height = 20;
    }

    function configurarImpresion(hoja, filaTitulos, horizontal = true) {
        hoja.pageSetup = {
            paperSize: 9, orientation: horizontal ? 'landscape' : 'portrait',
            fitToPage: true, fitToWidth: 1, fitToHeight: 0,
            horizontalCentered: true,
            margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
            ...(filaTitulos ? { printTitlesRow: `${filaTitulos}:${filaTitulos}` } : {})
        };
        hoja.headerFooter = {
            oddHeader: '&L&"Calibri,Bold"SIGER · GAD Municipal de Buena Fe&R&D',
            oddFooter: '&LSistema de Monitoreo de Residuos&RPágina &P de &N'
        };
    }

    // Miniatura JPEG (máx. 360 px) para incrustar sin hacer pesado el archivo.
    async function miniatura(url) {
        const respuesta = await fetch(url);
        if (!respuesta.ok) throw new Error('Foto no disponible');
        const blob = await respuesta.blob();
        const enlace = URL.createObjectURL(blob);
        try {
            const img = await new Promise((ok, mal) => {
                const i = new Image();
                i.onload = () => ok(i);
                i.onerror = () => mal(new Error('Formato no compatible'));
                i.src = enlace;
            });
            const escala = Math.min(1, 360 / Math.max(img.naturalWidth, img.naturalHeight));
            const lienzo = document.createElement('canvas');
            lienzo.width = Math.max(1, Math.round(img.naturalWidth * escala));
            lienzo.height = Math.max(1, Math.round(img.naturalHeight * escala));
            const ctx = lienzo.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, lienzo.width, lienzo.height);
            ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
            return { base64: lienzo.toDataURL('image/jpeg', 0.82), width: lienzo.width, height: lienzo.height };
        } finally {
            URL.revokeObjectURL(enlace);
        }
    }

    function descargar(buffer, nombre) {
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const enlace = document.createElement('a');
        enlace.href = URL.createObjectURL(blob);
        enlace.download = nombre;
        document.body.appendChild(enlace);
        enlace.click();
        setTimeout(() => { URL.revokeObjectURL(enlace.href); enlace.remove(); }, 1500);
    }

    /*
     * reportes: [{ codigo, fecha: Date, reportante, tipo, subtipo, descripcion,
     *              sector, nivel, prioridad, estado, origen, lat, lon, utm: {este, norte}|null, fotos: [url] }]
     * meta: { dia: 'texto del día consultado', exportadoPor, nombreArchivo, progreso(texto) }
     */
    async function generar(reportes, meta = {}) {
        const avisar = meta.progreso || (() => {});
        await cargarExcelJS();
        const libro = new ExcelJS.Workbook();
        libro.creator = 'SIGER · GAD Municipal de Buena Fe';
        libro.title = 'Reportes de residuos';
        libro.company = 'GAD Municipal del cantón Buena Fe';
        libro.created = new Date();
        libro.calcProperties = { fullCalcOnLoad: true };

        const lista = reportes.slice().sort((a, b) => a.fecha - b.fecha);
        const total = lista.length;
        const filaIni = 5;                       // primera fila de datos en "Reportes"
        const filaFin = filaIni + Math.max(total, 1) - 1;
        const rango = col => `Reportes!$${col}$${filaIni}:$${col}$${filaFin}`;

        const COL = {}; // letra de cada columna de "Reportes"
        const columnas = [
            ['n', 'N°', 6], ['codigo', 'Código', 16], ['fecha', 'Fecha y hora', 17], ['reportante', 'Reportante', 26],
            ['tipo', 'Tipo de residuo', 14], ['subtipo', 'Clasificación', 22], ['descripcion', 'Descripción', 44],
            ['sector', 'Sector / barrio', 22], ['nivel', 'Nivel', 10], ['prioridad', 'Prioridad', 11],
            ['estado', 'Estado', 13], ['origen', 'Origen de la ubicación', 22], ['lat', 'Latitud', 12],
            ['lon', 'Longitud', 12], ['este', 'UTM Este (17S)', 14], ['norte', 'UTM Norte (17S)', 14],
            ['mapa', 'Ver en mapa', 14], ['nfotos', 'Fotos', 8], ['foto1', 'Foto 1', 11], ['foto2', 'Foto 2', 11], ['foto3', 'Foto 3', 11]
        ];
        columnas.forEach(([k], i) => { COL[k] = letra(i + 1); });

        const contarSi = (col, valor) => {
            const resultado = lista.filter(r => (r[colAKey(col)] ?? '') === valor).length;
            return { formula: `COUNTIF(${rango(col)},"${valor}")`, result: resultado };
        };
        const colAKey = col => Object.keys(COL).find(k => COL[k] === col);

        // ───────────────────────── 1. RESUMEN ─────────────────────────
        avisar('Armando el resumen...');
        const res = libro.addWorksheet('Resumen', { properties: { tabColor: { argb: C.verdeOscuro } }, views: [{ showGridLines: false }] });
        res.columns = [{ width: 3 }, { width: 30 }, { width: 13 }, { width: 11 }, { width: 24 }, { width: 3 }, { width: 30 }, { width: 13 }, { width: 11 }, { width: 24 }];
        res.mergeCells('B1:J1'); res.mergeCells('B2:J2'); res.mergeCells('B3:J3');
        Object.assign(res.getCell('B1'), { value: 'SISTEMA DE MONITOREO DE RESIDUOS · SIGER' });
        res.getCell('B1').font = { bold: true, size: 18, color: { argb: C.blanco } };
        res.getCell('B2').value = 'GAD Municipal del cantón Buena Fe · Los Ríos · Universidad Técnica Estatal de Quevedo';
        res.getCell('B2').font = { size: 11, color: { argb: C.blanco } };
        res.getCell('B3').value = `Informe de reportes ciudadanos · ${meta.dia || 'Día consultado'}`;
        res.getCell('B3').font = { bold: true, size: 11, color: { argb: C.verdeOscuro } };
        for (let f = 1; f <= 3; f++) {
            for (let c = 1; c <= 10; c++) res.getRow(f).getCell(c).fill = relleno(f < 3 ? C.verdeOscuro : C.verdeClaro);
            res.getCell(`B${f}`).alignment = { vertical: 'middle', indent: 1 };
        }
        res.getRow(1).height = 36; res.getRow(2).height = 20; res.getRow(3).height = 22;

        const datosMeta = [
            ['Día consultado', meta.dia || '—'],
            ['Fecha de exportación', fechaEcuador(new Date())],
            ['Exportado por', meta.exportadoPor || 'Administrador'],
            ['Zona horaria', 'Hora de Ecuador (UTC-5)']
        ];
        datosMeta.forEach(([k, v], i) => {
            const fila = 5 + i;
            res.getCell(`B${fila}`).value = k;
            res.getCell(`B${fila}`).font = { bold: true, color: { argb: C.gris } };
            res.mergeCells(`C${fila}:E${fila}`);
            const celda = res.getCell(`C${fila}`);
            celda.value = v;
            if (v instanceof Date) celda.numFmt = 'dd/mm/yyyy hh:mm';
            celda.alignment = { horizontal: 'left' };
        });

        // Tarjetas de indicadores (fila 10 etiqueta, fila 11 valor).
        const conFotos = lista.filter(r => r.fotos.length).length;
        const tarjetas = [
            ['B', 'Total de reportes', { formula: `COUNTA(${rango(COL.codigo)})`, result: total }, C.verdeOscuro],
            ['C', 'Pendientes', contarSi(COL.estado, 'Pendiente'), 'FFB45309'],
            ['D', 'En revisión', contarSi(COL.estado, 'En revisión'), 'FF1D4ED8'],
            ['E', 'Atendidos', contarSi(COL.estado, 'Atendido'), 'FF15803D'],
            ['G', 'Puntos críticos', contarSi(COL.prioridad, 'Crítica'), 'FFB91C1C'],
            ['H', 'Con fotografías', { formula: `COUNTIF(${rango(COL.nfotos)},">0")`, result: conFotos }, 'FF7C3AED'],
            ['I', 'Descartados', contarSi(COL.estado, 'Descartado'), 'FF4B5563'],
            ['J', '% atendido', { formula: `IF(B11=0,0,E11/B11)`, result: total ? lista.filter(r => r.estado === 'Atendido').length / total : 0 }, 'FF0F766E']
        ];
        res.getRow(10).height = 30; res.getRow(11).height = 40;
        tarjetas.forEach(([col, etiqueta, valor, color]) => {
            const e = res.getCell(`${col}10`), v = res.getCell(`${col}11`);
            e.value = etiqueta;
            e.font = { bold: true, size: 9.5, color: { argb: C.blanco } };
            e.fill = relleno(color);
            e.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            v.value = valor;
            v.font = { bold: true, size: 20, color: { argb: color } };
            v.fill = relleno(C.grisClaro);
            v.alignment = { horizontal: 'center', vertical: 'middle' };
            v.border = { bottom: { style: 'thick', color: { argb: color } } };
            if (etiqueta.startsWith('%')) v.numFmt = '0%';
        });

        // Tablas de distribución con barra dibujada por fórmula (funciona en cualquier Excel).
        function tablaDistribucion(colInicio, filaInicio, titulo, columnaDatos, valores, grupo) {
            const [cNom, cCant, cPct, cBar] = [0, 1, 2, 3].map(i => letra(colInicio + i));
            res.mergeCells(`${cNom}${filaInicio}:${cBar}${filaInicio}`);
            const t = res.getCell(`${cNom}${filaInicio}`);
            t.value = titulo;
            t.font = { bold: true, size: 12, color: { argb: C.verdeOscuro } };
            t.border = { bottom: { style: 'medium', color: { argb: C.verde } } };
            const enc = res.getRow(filaInicio + 1);
            [[cNom, 'Categoría'], [cCant, 'Cantidad'], [cPct, '%'], [cBar, 'Proporción']].forEach(([c, v]) => { enc.getCell(c).value = v; });
            [cNom, cCant, cPct, cBar].forEach(c => {
                const celda = enc.getCell(c);
                celda.font = { bold: true, color: { argb: C.blanco }, size: 10 };
                celda.fill = relleno(C.verde);
                celda.alignment = { horizontal: 'center', vertical: 'middle' };
            });
            const primera = filaInicio + 2;
            valores.forEach((valor, i) => {
                const f = primera + i;
                const fila = res.getRow(f);
                fila.getCell(cNom).value = valor;
                pintarValor(fila.getCell(cNom), grupo, valor);
                if (!COLORES[grupo]) fila.getCell(cNom).font = { color: { argb: C.tinta } };
                fila.getCell(cCant).value = contarSi(columnaDatos, valor);
                fila.getCell(cCant).alignment = { horizontal: 'center' };
                const cuenta = fila.getCell(cCant).value.result;
                fila.getCell(cPct).value = { formula: `IF($B$11=0,0,${cCant}${f}/$B$11)`, result: total ? cuenta / total : 0 };
                fila.getCell(cPct).numFmt = '0.0%';
                fila.getCell(cPct).alignment = { horizontal: 'center' };
                fila.getCell(cBar).value = { formula: `REPT("█",ROUND(IF($B$11=0,0,${cCant}${f}/$B$11)*20,0))`, result: '█'.repeat(Math.round((total ? cuenta / total : 0) * 20)) };
                fila.getCell(cBar).font = { color: { argb: COLORES[grupo]?.[valor]?.[1] || C.verde }, size: 9 };
                [cNom, cCant, cPct, cBar].forEach(c => { fila.getCell(c).border = bordes; });
            });
            return primera + valores.length + 1;
        }

        const origenes = [...new Set(lista.map(r => r.origen).filter(Boolean))];
        let fIzq = tablaDistribucion(2, 13, 'Por estado', COL.estado, ESTADOS, 'estado');
        fIzq = tablaDistribucion(2, fIzq + 1, 'Por prioridad', COL.prioridad, PRIORIDADES, 'prioridad');
        let fDer = tablaDistribucion(7, 13, 'Por tipo de residuo', COL.tipo, TIPOS, 'tipo');
        fDer = tablaDistribucion(7, fDer + 1, 'Por nivel de gravedad', COL.nivel, NIVELES, 'nivel');
        if (origenes.length) fDer = tablaDistribucion(7, fDer + 1, 'Cómo se indicó la ubicación', COL.origen, origenes, 'origen');

        const fNota = Math.max(fIzq, fDer) + 1;
        res.mergeCells(`B${fNota}:J${fNota + 1}`);
        const nota = res.getCell(`B${fNota}`);
        nota.value = 'Nota: los totales se calculan con fórmulas sobre la hoja "Reportes". Si cambias el estado de un reporte en esa hoja (lista desplegable), este resumen y la hoja "Por sector" se actualizan solos.';
        nota.font = { italic: true, size: 9.5, color: { argb: C.gris } };
        nota.alignment = { wrapText: true, vertical: 'top' };
        configurarImpresion(res, null, false);

        // ───────────────────────── 2. REPORTES ─────────────────────────
        avisar('Escribiendo el detalle de reportes...');
        const hoja = libro.addWorksheet('Reportes', {
            properties: { tabColor: { argb: C.verde } },
            views: [{ state: 'frozen', xSplit: 2, ySplit: 4, topLeftCell: 'C5', activeCell: 'C5' }]
        });
        hoja.columns = columnas.map(([key, , width]) => ({ key, width }));
        bandaTitulo(hoja, columnas.length, 'Detalle de reportes ciudadanos',
            `${meta.dia || ''} · ${total} reporte(s) · Coordenadas WGS84 y UTM zona 17 Sur · Usa los filtros de cada columna`);
        const enc = hoja.getRow(4);
        columnas.forEach(([, titulo], i) => { enc.getCell(i + 1).value = titulo; });
        estiloEncabezado(enc);

        lista.forEach((r, i) => {
            const f = filaIni + i;
            const fila = hoja.getRow(f);
            const banda = i % 2 ? C.grisClaro : C.blanco;
            const valido = Number.isFinite(r.lat) && Number.isFinite(r.lon);
            const urlMapa = valido ? `https://www.google.com/maps?q=${r.lat},${r.lon}` : '';
            const valores = {
                n: i + 1, codigo: r.codigo, fecha: fechaEcuador(r.fecha), reportante: texto(r.reportante),
                tipo: r.tipo, subtipo: texto(r.subtipo), descripcion: texto(r.descripcion), sector: texto(r.sector),
                nivel: r.nivel, prioridad: r.prioridad, estado: r.estado, origen: r.origen,
                lat: valido ? Number(r.lat.toFixed(6)) : '', lon: valido ? Number(r.lon.toFixed(6)) : '',
                este: r.utm ? Math.round(r.utm.este) : '', norte: r.utm ? Math.round(r.utm.norte) : '',
                mapa: urlMapa ? { text: '📍 Abrir mapa', hyperlink: urlMapa, tooltip: 'Abrir en Google Maps' } : '',
                nfotos: r.fotos.length,
                foto1: r.fotos[0] ? { text: 'Ver foto 1', hyperlink: r.fotos[0] } : '',
                foto2: r.fotos[1] ? { text: 'Ver foto 2', hyperlink: r.fotos[1] } : '',
                foto3: r.fotos[2] ? { text: 'Ver foto 3', hyperlink: r.fotos[2] } : ''
            };
            columnas.forEach(([k], c) => {
                const celda = fila.getCell(c + 1);
                celda.value = valores[k];
                celda.fill = relleno(banda);
                celda.border = bordes;
                celda.font = { size: 10, color: { argb: C.tinta } };
                celda.alignment = { vertical: 'top', wrapText: ['descripcion', 'reportante', 'subtipo', 'sector', 'origen'].includes(k) };
            });
            fila.getCell('fecha').numFmt = 'dd/mm/yyyy hh:mm';
            fila.getCell('lat').numFmt = '0.000000';
            fila.getCell('lon').numFmt = '0.000000';
            fila.getCell('este').numFmt = '#,##0';
            fila.getCell('norte').numFmt = '#,##0';
            ['n', 'codigo', 'fecha', 'nfotos'].forEach(k => { fila.getCell(k).alignment = { vertical: 'top', horizontal: 'center' }; });
            fila.getCell('codigo').font = { size: 10, bold: true, color: { argb: C.verdeOscuro } };
            ['mapa', 'foto1', 'foto2', 'foto3'].forEach(k => {
                if (fila.getCell(k).value) fila.getCell(k).font = { size: 10, underline: true, color: { argb: C.enlace } };
            });
            pintarValor(fila.getCell('tipo'), 'tipo', r.tipo);
            pintarValor(fila.getCell('nivel'), 'nivel', r.nivel);
            pintarValor(fila.getCell('prioridad'), 'prioridad', r.prioridad);
            pintarValor(fila.getCell('estado'), 'estado', r.estado);
            const lineas = Math.max(1, Math.ceil(String(r.descripcion || '').length / 50), Math.ceil(String(r.reportante || '').length / 28));
            fila.height = Math.min(90, 16 + (lineas - 1) * 13);
        });

        if (total) {
            hoja.autoFilter = { from: { row: 4, column: 1 }, to: { row: filaFin, column: columnas.length } };
            // El municipio puede actualizar el estado desde el Excel.
            hoja.dataValidations.add(`${COL.estado}${filaIni}:${COL.estado}${filaFin}`, {
                type: 'list', allowBlank: false, showErrorMessage: true,
                formulae: [`"${ESTADOS.join(',')}"`],
                errorTitle: 'Estado no válido', error: 'Elige un estado de la lista.'
            });
            // Al cambiar el estado, la celda toma el color correspondiente.
            hoja.addConditionalFormatting({
                ref: `${COL.estado}${filaIni}:${COL.estado}${filaFin}`,
                rules: ESTADOS.map((estado, i) => ({
                    type: 'cellIs', operator: 'equal', formulae: [`"${estado}"`], priority: i + 1,
                    style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORES.estado[estado][0] } }, font: { bold: true, color: { argb: COLORES.estado[estado][1] } } }
                }))
            });
        } else {
            hoja.getCell(`A${filaIni}`).value = 'No hay reportes para este día.';
        }
        const fTot = filaFin + 2;
        hoja.mergeCells(`A${fTot}:C${fTot}`);
        hoja.getCell(`A${fTot}`).value = { formula: `"Total: "&COUNTA(${rango(COL.codigo)})&" reporte(s)"`, result: `Total: ${total} reporte(s)` };
        hoja.getCell(`A${fTot}`).font = { bold: true, color: { argb: C.verdeOscuro } };
        configurarImpresion(hoja, 4);

        // ───────────────────────── 3. POR SECTOR ─────────────────────────
        avisar('Agrupando por sector...');
        const sec = libro.addWorksheet('Por sector', {
            properties: { tabColor: { argb: 'FF0EA5E9' } },
            views: [{ state: 'frozen', ySplit: 4, showGridLines: false }]
        });
        const colsSec = [['Sector / barrio', 28], ['Total', 9], ['Pendiente', 11], ['En revisión', 11], ['Atendido', 11], ['Descartado', 11], ['Críticos', 10], ['% del total', 11], ['Proporción', 24]];
        sec.columns = colsSec.map(([, width]) => ({ width }));
        bandaTitulo(sec, colsSec.length, 'Reportes por sector o barrio', 'Ordenado de mayor a menor · Las cifras se recalculan desde la hoja "Reportes"');
        const encS = sec.getRow(4);
        colsSec.forEach(([t], i) => { encS.getCell(i + 1).value = t; });
        estiloEncabezado(encS);
        const conteoSector = new Map();
        lista.forEach(r => { const s = (r.sector || 'Sin sector').trim() || 'Sin sector'; conteoSector.set(s, (conteoSector.get(s) || 0) + 1); });
        const sectores = [...conteoSector.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
        const rS = rango(COL.sector);
        sectores.forEach(([nombre, cantidad], i) => {
            const f = 5 + i;
            const fila = sec.getRow(f);
            const dels = lista.filter(r => ((r.sector || 'Sin sector').trim() || 'Sin sector') === nombre);
            const criterio = `$A${f}`;
            fila.getCell(1).value = texto(nombre);
            fila.getCell(2).value = { formula: `COUNTIF(${rS},${criterio})`, result: cantidad };
            ESTADOS.forEach((estado, j) => {
                fila.getCell(3 + j).value = { formula: `COUNTIFS(${rS},${criterio},${rango(COL.estado)},"${estado}")`, result: dels.filter(r => r.estado === estado).length };
            });
            fila.getCell(7).value = { formula: `COUNTIFS(${rS},${criterio},${rango(COL.prioridad)},"Crítica")`, result: dels.filter(r => r.prioridad === 'Crítica').length };
            fila.getCell(8).value = { formula: `IF(Resumen!$B$11=0,0,B${f}/Resumen!$B$11)`, result: total ? cantidad / total : 0 };
            fila.getCell(8).numFmt = '0.0%';
            fila.getCell(9).value = { formula: `REPT("█",ROUND(H${f}*20,0))`, result: '█'.repeat(Math.round((total ? cantidad / total : 0) * 20)) };
            for (let c = 1; c <= colsSec.length; c++) {
                const celda = fila.getCell(c);
                celda.border = bordes;
                celda.fill = relleno(i % 2 ? C.grisClaro : C.blanco);
                if (c > 1) celda.alignment = { horizontal: c === 9 ? 'left' : 'center' };
            }
            fila.getCell(1).font = { bold: true, color: { argb: C.tinta } };
            fila.getCell(9).font = { color: { argb: C.verde }, size: 9 };
            if (fila.getCell(7).value.result > 0) fila.getCell(7).font = { bold: true, color: { argb: 'FFB91C1C' } };
        });
        if (sectores.length) {
            const fT = 5 + sectores.length;
            const filaT = sec.getRow(fT);
            filaT.getCell(1).value = 'TOTAL';
            for (let c = 2; c <= 7; c++) {
                const L = letra(c);
                let suma = 0;
                for (let f = 5; f < fT; f++) suma += sec.getRow(f).getCell(c).value?.result || 0;
                filaT.getCell(c).value = { formula: `SUM(${L}5:${L}${fT - 1})`, result: suma };
            }
            filaT.getCell(8).value = { formula: `SUM(H5:H${fT - 1})`, result: total ? 1 : 0 };
            filaT.getCell(8).numFmt = '0.0%';
            for (let c = 1; c <= colsSec.length; c++) {
                const celda = filaT.getCell(c);
                celda.font = { bold: true, color: { argb: C.blanco } };
                celda.fill = relleno(C.verdeOscuro);
                celda.alignment = { horizontal: c === 1 ? 'left' : 'center' };
            }
            sec.autoFilter = { from: { row: 4, column: 1 }, to: { row: fT - 1, column: colsSec.length } };
        }
        configurarImpresion(sec, 4, false);

        // ───────────────────────── 4. POR HORA ─────────────────────────
        const hor = libro.addWorksheet('Por hora', { properties: { tabColor: { argb: 'FFF59E0B' } }, views: [{ showGridLines: false }] });
        hor.columns = [{ width: 16 }, { width: 11 }, { width: 11 }, { width: 34 }];
        bandaTitulo(hor, 4, 'Reportes por hora del día', 'Útil para planificar los horarios de recolección (hora de Ecuador)');
        const encH = hor.getRow(4);
        ['Franja horaria', 'Reportes', '%', 'Proporción'].forEach((t, i) => { encH.getCell(i + 1).value = t; });
        estiloEncabezado(encH);
        const porHora = Array(24).fill(0);
        lista.forEach(r => { porHora[fechaEcuador(r.fecha).getUTCHours()]++; });
        const maxHora = Math.max(1, ...porHora);
        porHora.forEach((cantidad, h) => {
            const f = 5 + h;
            const fila = hor.getRow(f);
            fila.getCell(1).value = `${String(h).padStart(2, '0')}:00 – ${String(h).padStart(2, '0')}:59`;
            fila.getCell(2).value = cantidad;
            fila.getCell(3).value = total ? cantidad / total : 0;
            fila.getCell(3).numFmt = '0.0%';
            fila.getCell(4).value = '█'.repeat(Math.round(cantidad / maxHora * 20));
            for (let c = 1; c <= 4; c++) {
                const celda = fila.getCell(c);
                celda.border = bordes;
                celda.alignment = { horizontal: c === 4 ? 'left' : 'center' };
                celda.fill = relleno(cantidad === maxHora && cantidad > 0 ? 'FFFEF3C7' : (h % 2 ? C.grisClaro : C.blanco));
            }
            fila.getCell(4).font = { color: { argb: 'FFD97706' }, size: 9 };
            if (cantidad === maxHora && cantidad > 0) fila.getCell(2).font = { bold: true, color: { argb: 'FF92400E' } };
        });
        configurarImpresion(hor, 4, false);

        // ───────────────────────── 5. FOTOGRAFÍAS ─────────────────────────
        const conEvidencia = lista.filter(r => r.fotos.length);
        if (conEvidencia.length) {
            const fot = libro.addWorksheet('Fotografías', { properties: { tabColor: { argb: 'FF7C3AED' } }, views: [{ showGridLines: false, state: 'frozen', ySplit: 4 }] });
            fot.columns = [{ width: 16 }, { width: 24 }, { width: 14 }, { width: 30 }, { width: 30 }, { width: 30 }];
            bandaTitulo(fot, 6, 'Evidencia fotográfica', 'Miniaturas de las fotos enviadas · Clic en "Abrir original" para verla completa');
            const encF = fot.getRow(4);
            ['Código', 'Sector', 'Tipo', 'Foto 1', 'Foto 2', 'Foto 3'].forEach((t, i) => { encF.getCell(i + 1).value = t; });
            estiloEncabezado(encF);
            const ALTO_PX = 150;
            const MAX_FOTOS = 90;
            let fotosPuestas = 0;
            for (let i = 0; i < conEvidencia.length; i++) {
                const r = conEvidencia[i];
                const f = 5 + i;
                const fila = fot.getRow(f);
                fila.height = ALTO_PX * 0.75 + 18;
                fila.getCell(1).value = r.codigo;
                fila.getCell(1).font = { bold: true, color: { argb: C.verdeOscuro } };
                fila.getCell(2).value = texto(r.sector);
                fila.getCell(3).value = r.tipo;
                pintarValor(fila.getCell(3), 'tipo', r.tipo);
                for (let c = 1; c <= 6; c++) {
                    fila.getCell(c).border = bordes;
                    fila.getCell(c).alignment = { ...(fila.getCell(c).alignment || {}), vertical: 'top', wrapText: true };
                }
                for (let j = 0; j < Math.min(3, r.fotos.length); j++) {
                    const celda = fila.getCell(4 + j);
                    celda.value = { text: 'Abrir original', hyperlink: r.fotos[j] };
                    celda.font = { size: 9, underline: true, color: { argb: C.enlace } };
                    celda.alignment = { vertical: 'bottom', horizontal: 'center' };
                    if (fotosPuestas >= MAX_FOTOS) continue;
                    avisar(`Agregando fotografías (${fotosPuestas + 1})...`);
                    try {
                        const m = await miniatura(r.fotos[j]);
                        const alto = ALTO_PX, ancho = Math.min(205, Math.round(m.width * alto / m.height));
                        const id = libro.addImage({ base64: m.base64, extension: 'jpeg' });
                        fot.addImage(id, { tl: { col: 3 + j + 0.04, row: f - 1 + 0.04 }, ext: { width: ancho, height: alto }, editAs: 'oneCell' });
                        fotosPuestas++;
                    } catch (error) {
                        celda.value = { text: 'Foto no disponible · abrir enlace', hyperlink: r.fotos[j] };
                    }
                }
            }
            configurarImpresion(fot, 4);
        }

        avisar('Guardando el archivo...');
        const buffer = await libro.xlsx.writeBuffer();
        if (typeof document !== 'undefined') descargar(buffer, meta.nombreArchivo || 'SIGER_Reportes.xlsx');
        return buffer;
    }

    return { generar, cargarExcelJS };
});
