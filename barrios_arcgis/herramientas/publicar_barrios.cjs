/*
 * Convierte capas/Barrios.shp (dibujado en ArcMap) en ../barrios-buena-fe.geojson,
 * el archivo que usa la página para mostrar los barrios y detectar el sector.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const shp = require('./shapefile.cjs');
const Sectores = require('../../sectores.js');

const RAIZ = path.join(__dirname, '..');
const ORIGEN = path.join(RAIZ, 'capas', 'Barrios');
const SALIDA = path.join(RAIZ, '..', 'barrios-buena-fe.geojson');

if (!fs.existsSync(ORIGEN + '.shp')) {
    console.log('No existe capas/Barrios.shp. Ejecuta primero 1_CREAR_KIT.bat');
    process.exit(1);
}

const redondear = c => (Array.isArray(c[0]) ? c.map(redondear) : [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6]);
const todos = shp.leerPoligonos(ORIGEN);
const vistos = new Map();
const features = [];
let sinNombre = 0;

for (const [i, f] of todos.entries()) {
    const primero = (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0])[0];
    if (Math.abs(primero[0]) > 180 || Math.abs(primero[1]) > 90) {
        console.log('ERROR: Barrios.shp no está en latitud/longitud (WGS84). No cambies su sistema de coordenadas.');
        process.exit(1);
    }
    const nombre = Sectores.formato(f.properties.NOMBRE || '');
    if (!nombre) { sinNombre++; console.log(`  Aviso: el polígono N.° ${i + 1} no tiene NOMBRE y no se publica.`); continue; }
    const clave = Sectores.clave(nombre);
    if (vistos.has(clave)) console.log(`  Aviso: "${nombre}" está repetido (polígonos ${vistos.get(clave)} y ${i + 1}). Se publican ambos.`);
    vistos.set(clave, i + 1);
    features.push({
        type: 'Feature',
        properties: { nombre, tipo: Sectores.formato(f.properties.TIPO || '') || 'Barrio', parroquia: (f.properties.PARROQUIA || '').trim() },
        geometry: { type: f.geometry.type, coordinates: redondear(f.geometry.coordinates) }
    });
}

fs.writeFileSync(SALIDA, JSON.stringify({ type: 'FeatureCollection', fuente: 'ArcMap - SIGER Buena Fe', features }));
console.log('');
console.log(`Publicados ${features.length} barrio(s) en barrios-buena-fe.geojson.`);
if (sinNombre) console.log(`${sinNombre} polígono(s) sin nombre no se publicaron: ponles NOMBRE en la tabla de atributos.`);
console.log('Ahora sube la página (GitHub + Vercel) para que los barrios aparezcan en línea.');
