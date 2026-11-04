/*
 * Habitantes autorizados de Buena Fe.
 *
 * Solo pueden reportar como ciudadanos las personas cuya cédula y nombre
 * estén en la lista que carga el administrador. La lista vive en Firestore
 * (colección "habitantes") y solo el administrador puede leerla. El
 * ciudadano nunca descarga la lista: su navegador calcula una clave a partir
 * de la cédula y el nombre, y las reglas de Firestore comprueban que esa
 * clave exista.
 */
(function (raiz, fabrica) {
    const modulo = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = modulo;
    else raiz.Habitantes = modulo;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const PREFIJO = 'SIGER-BF-v1';

    function normalizarCedula(valor) {
        let texto = String(valor ?? '').replace(/\D/g, '');
        // Excel guarda las cédulas como número y borra el 0 inicial (09…).
        if (texto.length === 9) texto = '0' + texto;
        return texto;
    }

    // Cédula ecuatoriana: 10 dígitos, provincia 01-24 o 30, tercer dígito
    // menor a 6 y dígito verificador por módulo 10.
    function cedulaValida(valor) {
        const c = normalizarCedula(valor);
        if (!/^\d{10}$/.test(c)) return false;
        const provincia = Number(c.slice(0, 2));
        if (!((provincia >= 1 && provincia <= 24) || provincia === 30)) return false;
        if (Number(c[2]) >= 6) return false;
        let suma = 0;
        for (let i = 0; i < 9; i++) {
            let n = Number(c[i]) * (i % 2 === 0 ? 2 : 1);
            if (n > 9) n -= 9;
            suma += n;
        }
        return (10 - (suma % 10)) % 10 === Number(c[9]);
    }

    // Sin tildes, mayúsculas ni espacios de más; el orden de las palabras
    // no importa ("Justin Bryan Mendoza Zambrano" = "MENDOZA ZAMBRANO JUSTIN BRYAN").
    function palabrasNombre(valor) {
        return String(valor ?? '')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toUpperCase().replace(/[^A-Z]+/g, ' ')
            .trim().split(' ').filter(Boolean);
    }

    function normalizarNombre(valor) {
        return palabrasNombre(valor).sort().join(' ');
    }

    async function sha256(texto) {
        const datos = new TextEncoder().encode(texto);
        const resumen = await globalThis.crypto.subtle.digest('SHA-256', datos);
        return Array.from(new Uint8Array(resumen), b => b.toString(16).padStart(2, '0')).join('');
    }

    async function claveHabitante(cedula, nombre) {
        return sha256(`${PREFIJO}|${normalizarCedula(cedula)}|${normalizarNombre(nombre)}`);
    }

    // Revisa lo que escribe el ciudadano antes de consultar Firebase.
    function revisarDatos(cedula, nombre) {
        const c = normalizarCedula(cedula);
        if (!c) return 'Escribe tu número de cédula.';
        if (!cedulaValida(c)) return 'El número de cédula no es válido. Revísalo (10 dígitos, sin guiones).';
        if (palabrasNombre(nombre).length < 2) return 'Escribe tus nombres y apellidos completos, como aparecen en tu cédula.';
        return '';
    }

    // Filas pegadas desde Excel o leídas de un archivo: [cedula, nombres].
    // Devuelve las válidas (sin repetir) y las que se descartan con su motivo.
    function prepararFilas(filas) {
        const validas = [];
        const descartadas = [];
        const vistas = new Set();
        (filas || []).forEach((fila, i) => {
            const [cedulaBruta, ...resto] = Array.isArray(fila) ? fila : [];
            const nombre = resto.filter(v => v != null && String(v).trim()).join(' ').trim();
            const cedula = normalizarCedula(cedulaBruta);
            if (!cedula && !nombre) return;
            if (/^c[eé]dula$/i.test(String(cedulaBruta ?? '').trim())) return; // encabezado
            const fila1 = i + 1;
            if (!cedulaValida(cedula)) { descartadas.push({ fila: fila1, cedula: String(cedulaBruta ?? ''), nombre, motivo: 'cédula no válida' }); return; }
            if (palabrasNombre(nombre).length < 2) { descartadas.push({ fila: fila1, cedula, nombre, motivo: 'falta el nombre completo' }); return; }
            if (vistas.has(cedula)) { descartadas.push({ fila: fila1, cedula, nombre, motivo: 'cédula repetida' }); return; }
            vistas.add(cedula);
            validas.push({ cedula, nombre: palabrasNombre(nombre).join(' ') });
        });
        return { validas, descartadas };
    }

    // Texto pegado desde Excel: una persona por línea, columnas separadas
    // por tabulación, punto y coma o coma.
    function filasDesdeTexto(texto) {
        return String(texto ?? '').split(/\r?\n/).map(linea => {
            const partes = linea.split(/\t|;/);
            if (partes.length >= 2) return partes;
            const m = linea.match(/^\s*([\d\s-]{9,13})[\s,]+(.+)$/);
            return m ? [m[1], m[2]] : [linea];
        });
    }

    function ocultarCedula(cedula) {
        const c = normalizarCedula(cedula);
        return c.length === 10 ? `${c.slice(0, 2)}******${c.slice(8)}` : c;
    }

    return { normalizarCedula, cedulaValida, normalizarNombre, palabrasNombre, claveHabitante, revisarDatos, prepararFilas, filasDesdeTexto, ocultarCedula };
});
