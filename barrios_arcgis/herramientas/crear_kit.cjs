/*
 * Crea las capas (shapefiles en WGS84) para dibujar los barrios en ArcMap:
 *   capas/Limite_Canton.shp   límite del cantón Buena Fe (OpenStreetMap)
 *   capas/Parroquias.shp      San Jacinto de Buena Fe y Patricia Pilar
 *   capas/Lugares_OSM.shp     recintos y lugares con nombre (referencia)
 *   capas/Barrios.shp         capa VACÍA para dibujar (no se borra si ya existe)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const shp = require('./shapefile.cjs');

const RAIZ = path.join(__dirname, '..');
const DATOS = path.join(RAIZ, 'datos');
const CAPAS = path.join(RAIZ, 'capas');
fs.mkdirSync(CAPAS, { recursive: true });

const limites = JSON.parse(fs.readFileSync(path.join(DATOS, 'limites.geojson'), 'utf8')).features;
const lugares = JSON.parse(fs.readFileSync(path.join(DATOS, 'lugares.json'), 'utf8'));
const NOMBRE = [{ nombre: 'NOMBRE', largo: 100 }];

shp.escribirPoligonos(path.join(CAPAS, 'Limite_Canton'), NOMBRE,
    limites.filter(f => f.properties.tipo === 'canton').map(f => ({ geometry: f.geometry, properties: { NOMBRE: f.properties.nombre } })));
shp.escribirPoligonos(path.join(CAPAS, 'Parroquias'), NOMBRE,
    limites.filter(f => f.properties.tipo === 'parroquia').map(f => ({ geometry: f.geometry, properties: { NOMBRE: f.properties.nombre } })));
shp.escribirPuntos(path.join(CAPAS, 'Lugares_OSM'), [{ nombre: 'NOMBRE', largo: 100 }, { nombre: 'TIPO', largo: 30 }, { nombre: 'PARROQUIA', largo: 40 }],
    lugares.map(l => ({ geometry: { type: 'Point', coordinates: [l.lon, l.lat] }, properties: { NOMBRE: l.nombre, TIPO: l.tipo, PARROQUIA: l.parroquia } })));
console.log('Capas de referencia listas: Limite_Canton, Parroquias, Lugares_OSM (' + lugares.length + ' lugares).');

const barrios = path.join(CAPAS, 'Barrios');
if (fs.existsSync(barrios + '.shp')) {
    const n = shp.leerPoligonos(barrios).length;
    console.log('Barrios.shp ya existe: se conservan ' + n + ' barrio(s) dibujados.');
} else {
    shp.escribirPoligonos(barrios, [
        { nombre: 'NOMBRE', largo: 100 }, { nombre: 'TIPO', largo: 30 }, { nombre: 'PARROQUIA', largo: 40 },
        { nombre: 'OBSERV', largo: 200 }, { nombre: 'FUENTE', largo: 80 }
    ], []);
    console.log('Barrios.shp creado (vacío, listo para dibujar).');
}
console.log('');
console.log('LISTO. Abre ArcMap y agrega la carpeta "capas" (ver INSTRUCCIONES.txt).');
