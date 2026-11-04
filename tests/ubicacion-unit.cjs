const assert = require('node:assert/strict');
const U = require('../ubicacion-reporte.js');

const lim = { sur: -1.00, norte: -0.48, oeste: -79.65, este: -79.28 };
const cerca = (a, b, tol = 1e-5) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`);
const leer = t => U.validarEnArea(U.interpretarTexto(t), lim);

// UTM: referencias conocidas y viaje de ida y vuelta.
let p = U.utmALatLon(500000, 10000000, 17, true); cerca(p.lat, 0); cerca(p.lon, -81);
let u = U.latLonAUtm(-1, -81); cerca(u.este, 500000, 0.01); cerca(u.norte, 9889470.8, 1);
u = U.latLonAUtm(-0.8973, -79.4914);
p = U.utmALatLon(u.este, u.norte); cerca(p.lat, -0.8973, 1e-7); cerca(p.lon, -79.4914, 1e-7);
assert.ok(u.este > 667000 && u.este < 669000 && u.norte > 9900000 && u.norte < 9901500, JSON.stringify(u));

// Formato Google Maps y variantes.
let r = leer('-0.89732, -79.49140'); assert.ok(r.ok); cerca(r.lat, -0.89732); cerca(r.lon, -79.4914); assert.equal(r.avisos.length, 0);
r = leer('-0.89732,-79.49140'); assert.ok(r.ok);
r = leer('-0,89732; -79,49140'); assert.ok(r.ok); cerca(r.lat, -0.89732);
r = leer('https://www.google.com/maps/place/x/@-0.8,-79.4,17z/data=!3d-0.89732!4d-79.4914'); assert.ok(r.ok); cerca(r.lat, -0.89732);
r = leer('https://maps.google.com/?q=-0.89732,-79.49140'); assert.ok(r.ok); cerca(r.lon, -79.4914);
r = leer('https://www.google.com/maps/search/?api=1&query=-0.89732%2C-79.49140'); assert.ok(r.ok);
r = leer('0°53\'50.4"S 79°29\'29.0"W'); assert.ok(r.ok); cerca(r.lat, -0.8973333, 1e-6); cerca(r.lon, -79.4913889, 1e-6);

// Errores frecuentes: corregidos con aviso.
r = leer('0.89732, 79.49140'); assert.ok(r.ok); cerca(r.lat, -0.89732); assert.match(r.avisos[0], /signo/);
r = leer('-79.49140, -0.89732'); assert.ok(r.ok); cerca(r.lat, -0.89732); assert.match(r.avisos[0], /orden/);
r = leer('-0.9, -79.5'); assert.ok(r.ok); assert.match(r.avisos.join(' '), /decimales/);

// UTM pegado en el campo de Google Maps y en sus propios campos.
r = leer(`${Math.round(u.este)} ${Math.round(u.norte)}`); assert.ok(r.ok); cerca(r.lat, -0.8973, 1e-4);
r = U.validarEnArea(U.interpretarUtm(String(Math.round(u.este)), String(Math.round(u.norte))), lim); assert.ok(r.ok); assert.equal(r.formato, 'utm');
assert.equal(U.interpretarUtm('9900780', '667900').ok, false);
assert.equal(U.interpretarUtm('', '9900780').ok, false);
assert.equal(U.interpretarUtm('66790', '9900780').ok, false);

// Fuera de Buena Fe o inválidos: rechazados.
r = leer('-0.180653, -78.467834'); assert.equal(r.ok, false); assert.ok(r.fuera); assert.match(r.error, /fuera/);
r = leer('-2.170998, -79.922359'); assert.equal(r.ok, false);
assert.equal(leer('').ok, false);
assert.equal(leer('hola').ok, false);
assert.equal(leer('-0.8').ok, false);
assert.equal(leer('https://maps.app.goo.gl/abc123').ok, false);
assert.equal(leer('-0.8, -79.4, 15').ok, false);

assert.equal(U.textoOrigen(undefined), 'GPS del celular');
assert.equal(U.textoOrigen('utm'), 'Coordenadas UTM ingresadas a mano');
console.log('PASS: UTM, Google Maps, enlaces, grados, signos, orden, área Buena Fe y errores.');
