/*
 * Lectura y escritura mínima de shapefiles (puntos y polígonos, WGS84, UTF-8)
 * para el kit de barrios de SIGER. Compatible con ArcMap 10.8.
 */
'use strict';
const fs = require('fs');

const PRJ_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

const areaFirmada = anillo => {
    let a = 0;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) a += (anillo[j][0] - anillo[i][0]) * (anillo[j][1] + anillo[i][1]);
    return a / 2; // > 0 = sentido horario
};
const cerrar = anillo => {
    const [a, b] = [anillo[0], anillo[anillo.length - 1]];
    return a[0] === b[0] && a[1] === b[1] ? anillo : [...anillo, a];
};
// Shapefile: anillo exterior en sentido horario, huecos en antihorario.
const orientar = (anillo, horario) => {
    const r = cerrar(anillo);
    return (areaFirmada(r) > 0) === horario ? r : r.slice().reverse();
};

function geometriaAPartes(geom) {
    const poligonos = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    const partes = [];
    poligonos.forEach(p => p.forEach((anillo, i) => partes.push(orientar(anillo, i === 0))));
    return partes;
}

function caja(puntos) {
    const xs = puntos.map(p => p[0]), ys = puntos.map(p => p[1]);
    return puntos.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 0, 0];
}

function cabecera(tipo, largoBytes, bbox) {
    const b = Buffer.alloc(100);
    b.writeInt32BE(9994, 0);
    b.writeInt32BE(largoBytes / 2, 24);
    b.writeInt32LE(1000, 28);
    b.writeInt32LE(tipo, 32);
    bbox.forEach((v, i) => b.writeDoubleLE(v, 36 + i * 8));
    return b;
}

function escribirDbf(ruta, campos, filas) {
    const largoRegistro = 1 + campos.reduce((s, c) => s + c.largo, 0);
    const largoCabecera = 32 + campos.length * 32 + 1;
    const b = Buffer.alloc(largoCabecera + filas.length * largoRegistro + 1, 0x20);
    const hoy = new Date();
    b.writeUInt8(0x03, 0);
    b.writeUInt8(hoy.getFullYear() - 1900, 1); b.writeUInt8(hoy.getMonth() + 1, 2); b.writeUInt8(hoy.getDate(), 3);
    b.writeUInt32LE(filas.length, 4);
    b.writeUInt16LE(largoCabecera, 8);
    b.writeUInt16LE(largoRegistro, 10);
    b.fill(0, 12, 32);
    campos.forEach((c, i) => {
        const o = 32 + i * 32;
        b.fill(0, o, o + 32);
        b.write(c.nombre.slice(0, 10), o, 'ascii');
        b.write('C', o + 11, 'ascii');
        b.writeUInt8(c.largo, o + 16);
    });
    b.writeUInt8(0x0d, largoCabecera - 1);
    filas.forEach((fila, f) => {
        let o = largoCabecera + f * largoRegistro;
        b.write(' ', o++, 'ascii');
        campos.forEach(c => {
            // Recorta por bytes sin partir un carácter UTF-8.
            let texto = String(fila[c.nombre] ?? '');
            while (Buffer.byteLength(texto, 'utf8') > c.largo) texto = texto.slice(0, -1);
            b.fill(0x20, o, o + c.largo);
            b.write(texto, o, 'utf8');
            o += c.largo;
        });
    });
    b.writeUInt8(0x1a, b.length - 1);
    fs.writeFileSync(ruta + '.dbf', b);
}

function escribirComunes(ruta) {
    fs.writeFileSync(ruta + '.prj', PRJ_WGS84);
    fs.writeFileSync(ruta + '.cpg', 'UTF-8');
}

// features: [{ geometry: GeoJSON Polygon/MultiPolygon, properties }]
function escribirPoligonos(ruta, campos, features) {
    const registros = features.map(f => {
        const partes = geometriaAPartes(f.geometry);
        const puntos = partes.flat();
        const largo = 4 + 32 + 8 + partes.length * 4 + puntos.length * 16;
        const r = Buffer.alloc(8 + largo);
        r.writeInt32LE(5, 8);
        caja(puntos).forEach((v, i) => r.writeDoubleLE(v, 12 + i * 8));
        r.writeInt32LE(partes.length, 44);
        r.writeInt32LE(puntos.length, 48);
        let o = 52, inicio = 0;
        partes.forEach(p => { r.writeInt32LE(inicio, o); o += 4; inicio += p.length; });
        puntos.forEach(([x, y]) => { r.writeDoubleLE(x, o); r.writeDoubleLE(y, o + 8); o += 16; });
        return { r, largo, puntos };
    });
    guardarGeometrias(ruta, 5, registros, caja(registros.flatMap(x => x.puntos)));
    escribirDbf(ruta, campos, features.map(f => f.properties || {}));
    escribirComunes(ruta);
}

function escribirPuntos(ruta, campos, features) {
    const registros = features.map(f => {
        const [x, y] = f.geometry.coordinates;
        const r = Buffer.alloc(8 + 20);
        r.writeInt32LE(1, 8); r.writeDoubleLE(x, 12); r.writeDoubleLE(y, 20);
        return { r, largo: 20, puntos: [[x, y]] };
    });
    guardarGeometrias(ruta, 1, registros, caja(registros.flatMap(x => x.puntos)));
    escribirDbf(ruta, campos, features.map(f => f.properties || {}));
    escribirComunes(ruta);
}

function guardarGeometrias(ruta, tipo, registros, bbox) {
    let offset = 50; // en palabras de 16 bits
    const indices = [];
    registros.forEach((x, i) => {
        x.r.writeInt32BE(i + 1, 0);
        x.r.writeInt32BE(x.largo / 2, 4);
        indices.push([offset, x.largo / 2]);
        offset += 4 + x.largo / 2;
    });
    const cuerpo = Buffer.concat(registros.map(x => x.r));
    fs.writeFileSync(ruta + '.shp', Buffer.concat([cabecera(tipo, 100 + cuerpo.length, bbox), cuerpo]));
    const shx = Buffer.alloc(indices.length * 8);
    indices.forEach(([o, l], i) => { shx.writeInt32BE(o, i * 8); shx.writeInt32BE(l, i * 8 + 4); });
    fs.writeFileSync(ruta + '.shx', Buffer.concat([cabecera(tipo, 100 + shx.length, bbox), shx]));
}

// ───── Lectura (para publicar lo que se dibujó en ArcMap) ─────
function leerDbf(ruta) {
    const b = fs.readFileSync(ruta + '.dbf');
    const n = b.readUInt32LE(4), largoCab = b.readUInt16LE(8), largoReg = b.readUInt16LE(10);
    const campos = [];
    for (let o = 32; b[o] !== 0x0d && o < largoCab - 1; o += 32) {
        campos.push({ nombre: b.toString('ascii', o, o + 11).replace(/\0.*$/, '').trim(), tipo: String.fromCharCode(b[o + 11]), largo: b[o + 16] });
    }
    let utf8 = true;
    try { utf8 = !fs.existsSync(ruta + '.cpg') || /utf-?8/i.test(fs.readFileSync(ruta + '.cpg', 'utf8')); } catch (e) { utf8 = true; }
    const filas = [];
    for (let i = 0; i < n; i++) {
        const o = largoCab + i * largoReg;
        if (b[o] === 0x2a) { filas.push(null); continue; } // borrado
        let p = o + 1;
        const fila = {};
        campos.forEach(c => {
            const crudo = b.subarray(p, p + c.largo);
            fila[c.nombre] = (utf8 ? crudo.toString('utf8') : crudo.toString('latin1')).replace(/\0/g, '').trim();
            p += c.largo;
        });
        filas.push(fila);
    }
    return filas;
}

function dentroAnillo(x, y, anillo) {
    let d = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
        const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) d = !d;
    }
    return d;
}

function leerPoligonos(ruta) {
    const b = fs.readFileSync(ruta + '.shp');
    const filas = leerDbf(ruta);
    const salida = [];
    let o = 100, i = 0;
    while (o + 8 <= b.length) {
        const largo = b.readInt32BE(o + 4) * 2;
        const tipo = b.readInt32LE(o + 8);
        const fila = filas[i++];
        if ([5, 15, 25].includes(tipo) && fila) {
            const nPartes = b.readInt32LE(o + 44), nPuntos = b.readInt32LE(o + 48);
            const inicios = [];
            for (let k = 0; k < nPartes; k++) inicios.push(b.readInt32LE(o + 52 + k * 4));
            const base = o + 52 + nPartes * 4;
            const puntos = [];
            for (let k = 0; k < nPuntos; k++) puntos.push([b.readDoubleLE(base + k * 16), b.readDoubleLE(base + k * 16 + 8)]);
            const anillos = inicios.map((ini, k) => puntos.slice(ini, k + 1 < nPartes ? inicios[k + 1] : nPuntos));
            // Exteriores (horario) con sus huecos (antihorario).
            const exteriores = anillos.filter(a => areaFirmada(a) > 0).map(a => [a]);
            anillos.filter(a => areaFirmada(a) <= 0).forEach(h => {
                const contenedor = exteriores.find(p => dentroAnillo(h[0][0], h[0][1], p[0]));
                if (contenedor) contenedor.push(h);
                else exteriores.push([h.slice().reverse()]);
            });
            // GeoJSON: exterior antihorario, huecos horario.
            const poligonos = exteriores.map(p => p.map((a, k) => (k === 0 ? a.slice().reverse() : a.slice().reverse())));
            if (poligonos.length) {
                salida.push({
                    type: 'Feature', properties: fila,
                    geometry: poligonos.length === 1 ? { type: 'Polygon', coordinates: poligonos[0] } : { type: 'MultiPolygon', coordinates: poligonos }
                });
            }
        }
        o += 8 + largo;
    }
    return salida;
}

module.exports = { escribirPoligonos, escribirPuntos, leerPoligonos, leerDbf, areaFirmada };
