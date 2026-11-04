const assert = require('node:assert/strict');
const H = require('../habitantes.js');

(async () => {
    // Dígito verificador (módulo 10) y formato.
    assert.equal(H.cedulaValida('1204567892'), false);
    assert.equal(H.cedulaValida('1710034065'), true);
    assert.equal(H.cedulaValida('171003406'), false);
    assert.equal(H.cedulaValida('1710034066'), false);
    assert.equal(H.cedulaValida('9910034065'), false);
    assert.equal(H.cedulaValida('17-1003406-5'), true);
    assert.equal(H.normalizarCedula(912345675), '0912345675');

    // Nombre: sin tildes, mayúsculas, espacios ni orden.
    assert.equal(H.normalizarNombre('  José  Peñafiel rivas '), H.normalizarNombre('PENAFIEL RIVAS JOSE'));
    const a = await H.claveHabitante('1710034065', 'Pérez Gómez Ana María');
    const b = await H.claveHabitante('17 1003406 5', 'ana maria  PEREZ gomez');
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, await H.claveHabitante('1710034065', 'Pérez Gómez Ana'));
    assert.notEqual(a, await H.claveHabitante('0912345675', 'Pérez Gómez Ana María'));

    // Mensajes para el ciudadano.
    assert.match(H.revisarDatos('', 'Ana Pérez'), /cédula/);
    assert.match(H.revisarDatos('1234567890', 'Ana Pérez'), /no es válido/);
    assert.match(H.revisarDatos('1710034065', 'Ana'), /nombres y apellidos/);
    assert.equal(H.revisarDatos('1710034065', 'Ana Pérez'), '');

    // Filas de Excel: encabezado, cédula numérica sin 0, repetidas, inválidas.
    const { validas, descartadas } = H.prepararFilas([
        ['cedula', 'nombres'],
        [1710034065, 'Pérez Gómez Ana María '],
        [912345675, 'Ruiz', 'Luis'],
        ['1710034065', 'Otra Persona'],
        ['123', 'Mal Numero'],
        ['0912345675', ''],
        ['', '']
    ]);
    assert.deepEqual(validas.map(v => v.cedula), ['1710034065', '0912345675']);
    assert.equal(validas[0].nombre, 'PEREZ GOMEZ ANA MARIA');
    assert.deepEqual(descartadas.map(d => d.motivo), ['cédula repetida', 'cédula no válida', 'falta el nombre completo']);

    // Pegado desde Excel (tabulación), punto y coma o coma.
    const filas = H.filasDesdeTexto('1710034065\tPérez Ana\r\n0912345675;Ruiz Luis\n1710034065, Pérez Ana');
    assert.deepEqual(filas.map(f => f[0].trim()), ['1710034065', '0912345675', '1710034065']);
    assert.equal(H.ocultarCedula('1710034065'), '17******65');

    console.log('PASS: cédula, nombre, clave, filas de Excel y texto pegado.');
})().catch(error => { console.error(error); process.exit(1); });
