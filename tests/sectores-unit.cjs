const assert = require('node:assert/strict');
const S = require('../sectores.js');

// Mismo sector aunque cambien mayúsculas, espacios o tildes.
assert.equal(S.clave('SAN FELIPE'), S.clave('san  felipe'));
assert.equal(S.clave('San José'), S.clave('san jose'));
assert.equal(S.clave('Lotización Las Rosas'), S.clave('LOT. las rosas'));
assert.equal(S.clave('Cdla. 20 de Febrero'), S.clave('ciudadela 20 de febrero'));

// Formato uniforme.
assert.equal(S.formato('SAN FELIPE'), 'San Felipe');
assert.equal(S.formato('  san   felipe '), 'San Felipe');
assert.equal(S.formato('BARRIO DE LA PAZ'), 'Barrio de la Paz');
assert.equal(S.formato('lot. la carolina'), 'Lot. La Carolina');
assert.equal(S.formato('COOP. 12 DE OCTUBRE'), 'Coop. 12 de Octubre');
assert.equal(S.formato('el descanso'), 'El Descanso');
assert.equal(S.formato('la primavera ii'), 'La Primavera II');
assert.equal(S.formato('RECINTO "LOS AMAZU"'), 'Recinto Los Amazu');

// Nombre oficial del catálogo.
const cat = S.crearCatalogo(['San José', 'Nueva Buena Fe', 'san jose']);
assert.equal(S.canonico('SAN JOSE', cat), 'San José');
assert.equal(S.canonico('nueva  buena fe', cat), 'Nueva Buena Fe');
assert.equal(S.canonico('san felipe', cat), 'San Felipe');
assert.equal(S.canonico('   ', cat), '');

// Reportes ya guardados con variantes: se agrupan en uno solo.
const rep = [{ sector: 'SAN FELIPE' }, { sector: 'san felipe' }, { sector: 'San Felipe ' }, { sector: 'Centro' }, { sector: 'CENTRO' }, { sector: 'san jose' }, { sector: '' }];
S.unificarReportes(rep, cat);
assert.deepEqual(rep.map(r => r.sector), ['San Felipe', 'San Felipe', 'San Felipe', 'Centro', 'Centro', 'San José', '']);
assert.equal(rep[0].sectorOriginal, 'SAN FELIPE');

// Detección de barrio por coordenadas.
const gj = { features: [
    { properties: { NOMBRE: 'A' }, geometry: { type: 'Polygon', coordinates: [[[-79.50, -0.90], [-79.48, -0.90], [-79.48, -0.88], [-79.50, -0.88], [-79.50, -0.90]]] } },
    { properties: { NOMBRE: 'B' }, geometry: { type: 'MultiPolygon', coordinates: [[[[-79.47, -0.90], [-79.46, -0.90], [-79.46, -0.89], [-79.47, -0.89], [-79.47, -0.90]]]] } }
] };
assert.equal(S.barrioEn(-0.89, -79.49, gj).properties.NOMBRE, 'A');
assert.equal(S.barrioEn(-0.895, -79.465, gj).properties.NOMBRE, 'B');
assert.equal(S.barrioEn(-0.80, -79.49, gj), null);
assert.equal(S.barrioEn(NaN, -79.49, gj), null);

console.log('PASS: sectores (mayúsculas, tildes, abreviaturas, catálogo, unificación y barrio por coordenadas).');
