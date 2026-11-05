/*
 * Tareas municipales de SIGER.
 *
 * Un jefe (administrador principal) asigna un reporte a una persona del
 * equipo municipal con instrucciones y un plazo. La persona la empieza, la
 * marca como cumplida con una respuesta, y el jefe la aprueba (el reporte
 * pasa a "Atendido") o la devuelve con un nuevo plazo. Si vence el plazo sin
 * cumplirse, aparece como "Vencida".
 *
 * Avisos: mensaje + sonido en la página y notificación del navegador (si se
 * permite) mientras la página esté abierta. Opcional: enlace de WhatsApp.
 *
 * Firestore:
 *   personal/{correo}  { email, nombre, telefono, activo, fecha }
 *   tareas/{id}        { reporteId, codigo, sector, tipo, asignadoA, asignadoNombre,
 *                        asignadoPor, instrucciones, plazoHoras, vence, estado,
 *                        respuesta, notaJefe, fechaAsignada, fechaRespuesta, fechaCierre }
 */
(function (raiz) {
    'use strict';

    const ACTIVAS = ['Asignada', 'En proceso', 'Devuelta'];
    // Atajos para el plazo (el jefe también puede escribir cualquier número).
    const RAPIDOS = [[4, 'horas', '4 h'], [8, 'horas', '8 h'], [24, 'horas', '24 h'], [2, 'dias', '2 días'], [7, 'dias', '1 semana']];
    const MAX_HORAS = 720; // 30 días

    function htmlPlazo(clave, titulo) {
        return `<div class="plazo" data-plazo="${clave}">
            <label class="tarea-etq">${titulo}</label>
            <div class="plazo-fila">
                <input type="number" class="tarea-campo plazo-num" min="1" step="1" value="24" inputmode="numeric" aria-label="Cantidad de tiempo">
                <div class="plazo-unidad" role="radiogroup" aria-label="Unidad del plazo">
                    <button type="button" data-unidad="horas" class="activo" aria-pressed="true">Horas</button>
                    <button type="button" data-unidad="dias" aria-pressed="false">Días</button>
                </div>
            </div>
            <div class="plazo-rapidos">${RAPIDOS.map(([n, u, t]) => `<button type="button" data-rapido="${n}|${u}">${t}</button>`).join('')}</div>
            <p class="plazo-vence" aria-live="polite"></p>
        </div>`;
    }

    // Devuelve las horas escritas o un texto de error.
    function leerPlazo(caja) {
        const n = Number(String(caja?.querySelector('.plazo-num')?.value || '').replace(',', '.'));
        const dias = caja?.querySelector('[data-unidad="dias"]')?.classList.contains('activo');
        if (!Number.isFinite(n) || n <= 0) return { error: 'Escribe el plazo (un número mayor que 0).' };
        const horas = Math.round((dias ? n * 24 : n) * 100) / 100;
        if (horas < 1) return { error: 'El plazo mínimo es 1 hora.' };
        if (horas > MAX_HORAS) return { error: 'El plazo máximo es 30 días.' };
        return { horas };
    }

    function actualizarVence(caja) {
        const p = caja?.querySelector('.plazo-vence');
        if (!p) return;
        const r = leerPlazo(caja);
        p.classList.toggle('error', Boolean(r.error));
        p.textContent = r.error || `Vence: ${new Date(Date.now() + r.horas * 3.6e6).toLocaleString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`;
    }
    const ICONO = { 'Asignada': '📋', 'En proceso': '🛠', 'Devuelta': '↩️', 'Cumplida': '✅', 'Aprobada': '👍', 'Cancelada': '✖', 'Vencida': '⏰' };

    function crear(dep) {
        const { db, fs, auth, esJefe, esPersonal, mostrarToast, sonar, abrirReporte, reporteAbierto, actualizarEstadoReporte } = dep;
        const esc = dep.escaparHTML;
        let tareas = [];
        let personal = [];
        let cancelar = [];
        let reloj = null;
        let filtro = 'activas';
        let editando = null; // correo de la persona del equipo que se está editando
        let primeraCarga = true;
        let previos = new Map();
        const avisadasVencidas = new Set();

        const yo = () => (auth.currentUser?.email || '').trim().toLowerCase();
        const fecha = v => (v?.toDate ? v.toDate() : v ? new Date(v) : null);
        const vencida = t => ACTIVAS.includes(t.estado) && fecha(t.vence) && fecha(t.vence) < new Date();
        const estadoVisible = t => (vencida(t) ? 'Vencida' : t.estado);
        const fechaTexto = d => (d ? d.toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
        const clase = e => 'tarea-' + String(e).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '-');

        function restante(t) {
            const ms = fecha(t.vence) - Date.now();
            const abs = Math.abs(ms), h = Math.floor(abs / 3.6e6), m = Math.floor((abs % 3.6e6) / 6e4);
            const texto = h >= 48 ? `${Math.floor(h / 24)} días` : h ? `${h} h ${m} min` : `${m} min`;
            return ms >= 0 ? `Quedan ${texto}` : `Venció hace ${texto}`;
        }

        function notificar(titulo, cuerpo = '') {
            mostrarToast(cuerpo ? `${titulo} · ${cuerpo}` : titulo);
            try { sonar?.(); } catch (e) { /* sin sonido */ }
            try {
                if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
                    new Notification(titulo, { body: cuerpo, icon: 'icon-192.png', tag: `${titulo}|${cuerpo}` });
                }
            } catch (e) { /* el navegador no permite notificaciones */ }
        }

        // ───── Escucha en tiempo real ─────
        // Si la escucha falla (sin conexión, o reglas recién publicadas), se
        // vuelve a intentar con espera creciente: 15 s, 30 s, 60 s… hasta 5 min.
        let reintento = null, esperaReintento = 15000;
        function reintentar() {
            if (reintento) return;
            reintento = setTimeout(() => {
                reintento = null;
                esperaReintento = Math.min(esperaReintento * 2, 300000);
                if (esPersonal()) iniciar();
            }, esperaReintento);
        }

        function iniciar() {
            detener();
            if (!esPersonal() || !yo()) return;
            primeraCarga = true;
            previos = new Map();
            const consulta = esJefe()
                ? fs.collection(db, 'tareas')
                : fs.query(fs.collection(db, 'tareas'), fs.where('asignadoA', '==', yo()));
            cancelar.push(fs.onSnapshot(consulta, snap => {
                esperaReintento = 15000;
                const nuevas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                if (primeraCarga) {
                    const mias = nuevas.filter(t => t.asignadoA === yo() && ACTIVAS.includes(t.estado)).length;
                    if (mias) mostrarToast(`📋 Tienes ${mias} tarea(s) pendiente(s)`);
                    if (esJefe()) {
                        const revisar = nuevas.filter(t => t.estado === 'Cumplida').length;
                        const venc = nuevas.filter(vencida).length;
                        if (revisar || venc) mostrarToast([revisar && `✅ ${revisar} tarea(s) por revisar`, venc && `⏰ ${venc} vencida(s)`].filter(Boolean).join(' · '));
                    }
                    nuevas.filter(vencida).forEach(t => avisadasVencidas.add(t.id));
                } else {
                    nuevas.forEach(t => {
                        const antes = previos.get(t.id);
                        if (antes === t.estado) return;
                        if (t.asignadoA === yo() && antes === undefined) notificar('📋 Nueva tarea asignada', `${t.codigo} · ${t.sector || ''}`);
                        else if (t.asignadoA === yo() && t.estado === 'Devuelta') notificar('↩️ Tarea devuelta', `${t.codigo}: ${t.notaJefe || ''}`);
                        else if (t.asignadoA === yo() && t.estado === 'Aprobada') notificar('👍 Tarea aprobada', t.codigo);
                        else if (t.asignadoA === yo() && t.estado === 'Cancelada') notificar('✖ Tarea cancelada', t.codigo);
                        if (esJefe() && t.asignadoA !== yo() && t.estado === 'Cumplida') notificar('✅ Tarea cumplida', `${t.asignadoNombre} · ${t.codigo}`);
                        if (esJefe() && t.asignadoA !== yo() && t.estado === 'En proceso' && antes === 'Asignada') mostrarToast(`🛠 ${t.asignadoNombre} empezó ${t.codigo}`);
                    });
                }
                nuevas.forEach(t => previos.set(t.id, t.estado));
                tareas = nuevas;
                primeraCarga = false;
                pintar();
                refrescarDetalle();
            }, error => { console.warn('Tareas:', error); pintar(error); reintentar(); }));

            if (esJefe()) {
                cancelar.push(fs.onSnapshot(fs.collection(db, 'personal'), snap => {
                    personal = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.activo !== false)
                        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
                    pintarEquipo();
                    refrescarDetalle();
                }, error => { pintarEquipo(error); reintentar(); }));
            }
            reloj = setInterval(revisarVencidas, 60000);
            try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) { /* sin permiso */ }
        }

        function detener() {
            cancelar.forEach(f => { try { f(); } catch (e) { /* ya cerrada */ } });
            cancelar = [];
            clearInterval(reloj);
            reloj = null;
            clearTimeout(reintento);
            reintento = null;
            tareas = [];
            personal = [];
            pintar();
            pintarEquipo();
        }

        function revisarVencidas() {
            tareas.filter(vencida).forEach(t => {
                if (avisadasVencidas.has(t.id)) return;
                avisadasVencidas.add(t.id);
                if (esJefe()) notificar('⏰ Tarea vencida sin cumplir', `${t.codigo} · ${t.asignadoNombre}`);
                else if (t.asignadoA === yo()) notificar('⏰ Se venció tu tarea', t.codigo);
            });
            pintar();
        }

        // ───── Panel "Tareas" ─────
        const FILTROS = {
            activas: t => ACTIVAS.includes(t.estado) && !vencida(t),
            revisar: t => t.estado === 'Cumplida',
            vencidas: vencida,
            cerradas: t => ['Aprobada', 'Cancelada'].includes(t.estado)
        };

        function pintar(error) {
            const panel = document.getElementById('panelTareas');
            if (!panel) return;
            const titulo = panel.querySelector('[data-titulo]');
            if (titulo) titulo.textContent = esJefe() ? '📋 Tareas del equipo' : '📋 Mis tareas';
            const conteos = Object.fromEntries(Object.entries(FILTROS).map(([k, f]) => [k, tareas.filter(f).length]));
            panel.querySelectorAll('[data-filtro]').forEach(b => {
                b.classList.toggle('activo', b.dataset.filtro === filtro);
                const n = b.querySelector('b');
                if (n) n.textContent = conteos[b.dataset.filtro] || 0;
                b.hidden = b.dataset.filtro === 'revisar' && !esJefe() && !conteos.revisar;
            });
            const aviso = conteos.revisar + conteos.vencidas;
            const insignia = document.getElementById('insigniaTareas');
            if (insignia) { insignia.textContent = esJefe() ? aviso : conteos.activas + conteos.vencidas; insignia.hidden = !Number(insignia.textContent); }
            const lista = panel.querySelector('[data-lista]');
            if (!lista) return;
            if (error) { lista.innerHTML = `<li class="tarea-vacia">${error.code === 'permission-denied' ? 'Falta publicar las reglas nuevas de Firestore.' : 'No se pudieron cargar las tareas.'}</li>`; return; }
            const visibles = tareas.filter(FILTROS[filtro]).sort((a, b) => (fecha(a.vence) || 0) - (fecha(b.vence) || 0));
            lista.innerHTML = visibles.map(t => `
                <li><button type="button" class="tarea-item ${clase(estadoVisible(t))}" data-abrir="${esc(t.reporteId)}">
                    <span class="tarea-fila"><strong>${esc(t.codigo)}</strong><span class="tarea-chip ${clase(estadoVisible(t))}">${ICONO[estadoVisible(t)] || ''} ${esc(estadoVisible(t))}</span></span>
                    <span class="tarea-sector">${esc(t.sector || '')}${esJefe() ? ` · ${esc(t.asignadoNombre || t.asignadoA)}` : ''}</span>
                    <span class="tarea-texto">${esc(t.instrucciones || '')}</span>
                    ${ACTIVAS.includes(t.estado) ? `<span class="tarea-plazo">${vencida(t) ? '⏰' : '⏳'} ${esc(restante(t))}</span>` : ''}
                </button></li>`).join('') || `<li class="tarea-vacia">${{ activas: 'No hay tareas en curso.', revisar: 'No hay tareas por revisar.', vencidas: 'Ninguna tarea vencida. 👏', cerradas: 'Todavía no hay tareas cerradas.' }[filtro]}</li>`;
        }

        function conectarPanel() {
            const panel = document.getElementById('panelTareas');
            if (!panel || panel.dataset.listo) return;
            panel.dataset.listo = '1';
            panel.addEventListener('click', e => {
                const f = e.target.closest('[data-filtro]');
                if (f) { filtro = f.dataset.filtro; pintar(); return; }
                const a = e.target.closest('[data-abrir]');
                if (a) abrirReporte(a.dataset.abrir);
            });
        }

        // ───── Panel "Equipo municipal" (solo jefes) ─────
        function pintarEquipo(error) {
            const lista = document.getElementById('listaPersonal');
            if (!lista) return;
            if (error) { lista.innerHTML = `<li class="tarea-vacia">${error.code === 'permission-denied' ? 'Falta publicar las reglas nuevas de Firestore.' : 'No se pudo cargar el equipo.'}</li>`; return; }
            // No se repinta mientras alguien escribe en el formulario de edición.
            const enEdicion = lista.querySelector('.persona-editar');
            if (editando && enEdicion?.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
            lista.innerHTML = personal.map(p => {
                const nombre = nombreBonito(p.nombre);
                if (editando === p.email) {
                    return `<li class="persona persona-editar" data-editar="${esc(p.email)}">
                        <span class="persona-avatar" aria-hidden="true">✏️</span>
                        <span class="persona-datos">
                            <label class="tarea-etq">Nombre y apellido</label>
                            <input type="text" class="tarea-campo" data-campo="nombre" value="${esc(nombre)}" maxlength="100">
                            <label class="tarea-etq">Correo</label>
                            <input type="email" class="tarea-campo" data-campo="email" value="${esc(p.email)}" autocomplete="off">
                            <label class="tarea-etq">Celular para WhatsApp (opcional)</label>
                            <input type="tel" class="tarea-campo" data-campo="telefono" value="${esc(p.telefono || '')}" inputmode="numeric" placeholder="09...">
                            <span class="persona-acciones">
                                <button type="button" class="tarea-btn tarea-ok" data-guardar-personal="${esc(p.email)}">Guardar</button>
                                <button type="button" class="tarea-btn tarea-sec" data-cancelar-edicion>Cancelar</button>
                            </span>
                            <small class="persona-aviso" data-aviso></small>
                        </span>
                    </li>`;
                }
                const activas = tareas.filter(t => t.asignadoA === p.email && ACTIVAS.includes(t.estado));
                const vencidas = activas.filter(vencida).length;
                const iniciales = nombre.split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?';
                const tel = p.telefono ? `<a class="persona-tel" href="https://wa.me/593${esc(p.telefono.replace(/^0/, ''))}" target="_blank" rel="noopener" title="Escribir por WhatsApp">📱 ${esc(p.telefono)}</a>` : '';
                const carga = activas.length
                    ? `<span class="persona-carga ${vencidas ? 'con-vencidas' : ''}">${activas.length} en curso${vencidas ? ` · ${vencidas} vencida(s)` : ''}</span>`
                    : '<span class="persona-carga libre">Sin tareas</span>';
                return `<li class="persona">
                    <span class="persona-avatar" aria-hidden="true">${esc(iniciales)}</span>
                    <span class="persona-datos">
                        <strong>${esc(nombre)}</strong>
                        <span class="persona-correo">${esc(p.email)}</span>
                        <span class="persona-extra">${tel}${carga}</span>
                    </span>
                    <span class="persona-botones">
                        <button type="button" class="persona-icono persona-editar-btn" data-editar-personal="${esc(p.email)}" title="Editar datos" aria-label="Editar datos de ${esc(nombre)}">✏️</button>
                        <button type="button" class="persona-icono persona-quitar" data-quitar-personal="${esc(p.email)}" title="Quitar del equipo" aria-label="Quitar a ${esc(nombre)} del equipo">✕</button>
                    </span>
                </li>`;
            }).join('') || '<li class="tarea-vacia">Aún no agregas personal.</li>';
        }

        // "justin mendoza" → "Justin Mendoza"
        function nombreBonito(texto) {
            return String(texto || '').trim().replace(/\s+/g, ' ').toLowerCase()
                .replace(/(^|\s)(\p{L})/gu, (m, esp, letra) => esp + letra.toUpperCase());
        }

        async function agregarPersonal() {
            const email = document.getElementById('personalCorreo').value.trim().toLowerCase();
            const nombre = nombreBonito(document.getElementById('personalNombre').value);
            const telefono = document.getElementById('personalTelefono').value.replace(/\D/g, '');
            const estado = document.getElementById('estadoPersonal');
            if (!/^\S+@\S+\.\S+$/.test(email)) { estado.textContent = 'Escribe un correo válido.'; return; }
            if (nombre.length < 3) { estado.textContent = 'Escribe el nombre de la persona.'; return; }
            if (telefono && !/^0?9\d{8}$/.test(telefono)) { estado.textContent = 'El celular debe tener 10 dígitos (09...).'; return; }
            if (dep.correosJefes.includes(email)) { estado.textContent = 'Ese correo ya es de un jefe.'; return; }
            try {
                await fs.setDoc(fs.doc(db, 'personal', email), { email, nombre, telefono, activo: true, fecha: fs.serverTimestamp() });
                ['personalCorreo', 'personalNombre', 'personalTelefono'].forEach(id => { document.getElementById(id).value = ''; });
                estado.innerHTML = `✔ ${esc(nombre)} agregado. <b>Falta su cuenta:</b> en Firebase → Authentication → Agregar usuario, con el correo <b>${esc(email)}</b> y una contraseña. Luego entra por “Acceso administrador”.`;
            } catch (error) {
                estado.textContent = error?.code === 'permission-denied' ? 'Firebase no lo permitió: falta publicar las reglas nuevas.' : 'No se pudo agregar: ' + (error?.message || error);
            }
        }

        // Corrige nombre, celular o correo de una persona del equipo.
        async function guardarEdicion(emailAnterior, boton) {
            const caja = document.querySelector(`[data-editar="${CSS.escape(emailAnterior)}"]`);
            const aviso = caja?.querySelector('[data-aviso]');
            const decir = t => { if (aviso) aviso.textContent = t; };
            const p = personal.find(x => x.email === emailAnterior);
            if (!caja || !p) return;
            const nombre = nombreBonito(caja.querySelector('[data-campo="nombre"]').value);
            const email = caja.querySelector('[data-campo="email"]').value.trim().toLowerCase();
            const telefono = caja.querySelector('[data-campo="telefono"]').value.replace(/\D/g, '');
            if (nombre.length < 3) return decir('Escribe el nombre completo.');
            if (!/^\S+@\S+\.\S+$/.test(email)) return decir('Escribe un correo válido.');
            if (telefono && !/^0?9\d{8}$/.test(telefono)) return decir('El celular debe tener 10 dígitos (09...).');
            const cambiaCorreo = email !== emailAnterior;
            if (cambiaCorreo) {
                if (dep.correosJefes.includes(email)) return decir('Ese correo ya es de un jefe.');
                if (personal.some(x => x.email === email)) return decir('Ese correo ya está en el equipo.');
                if (tareas.some(t => t.asignadoA === emailAnterior && ACTIVAS.includes(t.estado))) {
                    return decir('Tiene tareas en curso con el correo anterior. Termínalas o cancélalas antes de cambiar el correo.');
                }
                if (!confirm(`Vas a cambiar el correo a ${email}.\n\nRecuerda crear (o cambiar) su cuenta en Firebase → Authentication con ese mismo correo; con el correo anterior ya no podrá entrar.`)) return;
            }
            boton.disabled = true;
            try {
                const datos = { email, nombre, telefono, activo: true, fecha: p.fecha || fs.serverTimestamp() };
                if (cambiaCorreo) {
                    await fs.setDoc(fs.doc(db, 'personal', email), datos);
                    await fs.deleteDoc(fs.doc(db, 'personal', emailAnterior));
                } else {
                    await fs.setDoc(fs.doc(db, 'personal', email), datos);
                }
                editando = null;
                document.activeElement?.blur?.();
                pintarEquipo();
                mostrarToast(`✔ Datos de ${nombre} actualizados`);
            } catch (error) {
                boton.disabled = false;
                decir(error?.code === 'permission-denied' ? 'Firebase no permitió guardar el cambio.' : 'No se pudo guardar: ' + (error?.message || error));
            }
        }

        function conectarEquipo() {
            const panel = document.getElementById('panelEquipo');
            if (!panel || panel.dataset.listo) return;
            panel.dataset.listo = '1';
            document.getElementById('btnAgregarPersonal')?.addEventListener('click', agregarPersonal);
            panel.addEventListener('click', async e => {
                const ed = e.target.closest('[data-editar-personal]');
                if (ed) { editando = ed.dataset.editarPersonal; pintarEquipo(); panel.querySelector('.persona-editar input')?.focus(); return; }
                if (e.target.closest('[data-cancelar-edicion]')) { editando = null; pintarEquipo(); return; }
                const g = e.target.closest('[data-guardar-personal]');
                if (g) { guardarEdicion(g.dataset.guardarPersonal, g); return; }
                const b = e.target.closest('[data-quitar-personal]');
                if (!b) return;
                const p = personal.find(x => x.email === b.dataset.quitarPersonal);
                if (!p || !confirm(`¿Quitar a ${nombreBonito(p.nombre)} del equipo? Ya no podrá entrar como administrador.`)) return;
                try { await fs.deleteDoc(fs.doc(db, 'personal', p.email)); mostrarToast(`${p.nombre} ya no es parte del equipo`); }
                catch (error) { alert('No se pudo quitar: ' + (error?.message || error)); }
            });
        }

        // ───── Sección dentro del detalle del reporte ─────
        function enlaceWhatsApp(t) {
            const p = personal.find(x => x.email === t.asignadoA);
            if (!p?.telefono) return '';
            const numero = '593' + p.telefono.replace(/^0/, '');
            const texto = `SIGER Buena Fe – Tarea ${t.codigo} (${t.sector || ''}).\nInstrucciones: ${t.instrucciones}\nPlazo: ${fechaTexto(fecha(t.vence))}.\nIngresa a ${location.origin}${location.pathname} con tu cuenta de administrador.`;
            return `<a class="tarea-wa" href="https://wa.me/${numero}?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">💬 Avisar por WhatsApp</a>`;
        }

        function tarjeta(t) {
            const e = estadoVisible(t);
            const mia = t.asignadoA === yo();
            const jefe = esJefe();
            let acciones = '';
            if (mia && ACTIVAS.includes(t.estado)) {
                acciones += (t.estado !== 'En proceso' ? `<button type="button" class="tarea-btn" data-accion="empezar" data-id="${esc(t.id)}">🛠 Empezar</button>` : '') + `
                    <label class="tarea-etq">¿Qué hiciste? (se envía al jefe)</label>
                    <textarea class="tarea-campo" data-respuesta="${esc(t.id)}" rows="3" placeholder="Ej. Se recogió la basura y se limpió el lugar.">${esc(t.respuesta || '')}</textarea>
                    <button type="button" class="tarea-btn tarea-ok" data-accion="cumplir" data-id="${esc(t.id)}">✅ Marcar como cumplida</button>`;
            }
            if (jefe && t.estado === 'Cumplida') {
                acciones += `<div class="tarea-dos"><button type="button" class="tarea-btn tarea-ok" data-accion="aprobar" data-id="${esc(t.id)}">👍 Aprobar · reporte Atendido</button>
                    <button type="button" class="tarea-btn tarea-sec" data-accion="mostrar-devolver" data-id="${esc(t.id)}">↩️ Devolver</button></div>`;
            }
            if (jefe && ['Cumplida', ...ACTIVAS].includes(t.estado)) {
                acciones += `<div class="tarea-devolver" data-devolver="${esc(t.id)}" ${t.estado === 'Cumplida' ? 'hidden' : 'hidden'}>
                    <label class="tarea-etq">Qué falta corregir</label>
                    <textarea class="tarea-campo" data-nota="${esc(t.id)}" rows="2" placeholder="Ej. Falta limpiar la otra esquina."></textarea>
                    ${htmlPlazo(`devolver-${esc(t.id)}`, 'Nuevo plazo')}
                    <button type="button" class="tarea-btn tarea-sec" data-accion="devolver" data-id="${esc(t.id)}">Enviar devolución</button></div>`;
                if (ACTIVAS.includes(t.estado)) acciones += `<div class="tarea-dos">${enlaceWhatsApp(t)}<button type="button" class="tarea-btn tarea-peligro" data-accion="cancelar" data-id="${esc(t.id)}">✖ Cancelar tarea</button></div>`;
            }
            return `<div class="tarea-tarjeta ${clase(e)}">
                <div class="tarea-fila"><strong>${ICONO[e] || ''} ${esc(e)}</strong>${ACTIVAS.includes(t.estado) ? `<span class="tarea-plazo">${esc(restante(t))}</span>` : ''}</div>
                <dl class="tarea-datos">
                    <dt>Responsable</dt><dd>${esc(t.asignadoNombre || t.asignadoA)}</dd>
                    <dt>Asignó</dt><dd>${esc(t.asignadoPor)}</dd>
                    <dt>Plazo</dt><dd>${esc(fechaTexto(fecha(t.vence)))}</dd>
                    <dt>Instrucciones</dt><dd class="tarea-pre">${esc(t.instrucciones)}</dd>
                    ${t.notaJefe ? `<dt>Devolución</dt><dd class="tarea-pre">${esc(t.notaJefe)}</dd>` : ''}
                    ${t.respuesta && !(mia && ACTIVAS.includes(t.estado)) ? `<dt>Respuesta</dt><dd class="tarea-pre">${esc(t.respuesta)}<br><small>${esc(fechaTexto(fecha(t.fechaRespuesta)))}</small></dd>` : ''}
                </dl>${acciones}</div>`;
        }

        function htmlDetalle(reporte) {
            if (!esPersonal() || !reporte) return '';
            const delReporte = tareas.filter(t => t.reporteId === reporte.id).sort((a, b) => (fecha(b.fechaAsignada) || 0) - (fecha(a.fechaAsignada) || 0));
            const actual = delReporte.find(t => [...ACTIVAS, 'Cumplida'].includes(t.estado));
            const anteriores = delReporte.filter(t => t !== actual);
            let cuerpo = actual ? tarjeta(actual) : '';
            if (!actual && esJefe()) {
                cuerpo = personal.length ? `<div class="tarea-form">
                    <label class="tarea-etq" for="tareaPersona">Asignar a</label>
                    <select id="tareaPersona" class="tarea-campo">${personal.map(p => `<option value="${esc(p.email)}">${esc(nombreBonito(p.nombre))}</option>`).join('')}</select>
                    <label class="tarea-etq" for="tareaInstrucciones">Instrucciones</label>
                    <textarea id="tareaInstrucciones" class="tarea-campo" rows="3" maxlength="1000" placeholder="Ej. Acudir con el recolector, retirar la basura y tomar una foto del lugar limpio."></textarea>
                    ${htmlPlazo('asignar', 'Plazo para cumplir')}
                    <button type="button" class="tarea-btn tarea-ok" data-accion="asignar">📋 Asignar tarea</button></div>`
                    : '<p class="tarea-vacia">Para asignar tareas, primero agrega personal en <b>👥 Equipo municipal</b>.</p>';
            } else if (!actual) {
                cuerpo = '<p class="tarea-vacia">Este reporte no tiene una tarea asignada a ti.</p>';
            }
            const historial = anteriores.length ? `<details class="tarea-historial"><summary>Tareas anteriores (${anteriores.length})</summary>${anteriores.map(tarjeta).join('')}</details>` : '';
            return `<section class="tarea-seccion" data-tareas-de="${esc(reporte.id)}"><h3>📋 Tarea municipal</h3>${cuerpo}${historial}</section>`;
        }

        function refrescarDetalle() {
            const id = reporteAbierto?.();
            if (!id) return;
            const seccion = document.querySelector(`[data-tareas-de="${CSS.escape(id)}"]`);
            // No se repinta si alguien está escribiendo dentro de la sección.
            if (seccion && seccion.contains(document.activeElement) && /TEXTAREA|SELECT|INPUT/.test(document.activeElement.tagName)) return;
            abrirReporte(id);
        }

        async function accion(nombre, id, reporte, boton) {
            const t = tareas.find(x => x.id === id);
            const ahora = Date.now();
            if (boton) boton.disabled = true;
            try {
                if (nombre === 'asignar') {
                    const email = document.getElementById('tareaPersona').value;
                    const p = personal.find(x => x.email === email);
                    const instrucciones = document.getElementById('tareaInstrucciones').value.trim();
                    const plazo = leerPlazo(document.querySelector('[data-plazo="asignar"]'));
                    if (!p) return alert('Elige a quién asignar la tarea.');
                    if (instrucciones.length < 5) return alert('Escribe las instrucciones de la tarea.');
                    if (plazo.error) return alert(plazo.error);
                    const horas = plazo.horas;
                    await fs.addDoc(fs.collection(db, 'tareas'), {
                        reporteId: reporte.id, codigo: dep.codigoReporte(reporte), sector: reporte.sector || '', tipo: reporte.tipo || '',
                        asignadoA: p.email, asignadoNombre: nombreBonito(p.nombre), asignadoPor: yo(), instrucciones, plazoHoras: horas,
                        vence: new Date(ahora + horas * 3.6e6), estado: 'Asignada', respuesta: '', notaJefe: '',
                        fechaAsignada: fs.serverTimestamp()
                    });
                    if (reporte.estado === 'Pendiente') await actualizarEstadoReporte(reporte.id, 'En revisión', true);
                    mostrarToast(`📋 Tarea asignada a ${nombreBonito(p.nombre)}`);
                } else if (nombre === 'empezar') {
                    await fs.updateDoc(fs.doc(db, 'tareas', id), { estado: 'En proceso' });
                } else if (nombre === 'cumplir') {
                    const respuesta = document.querySelector(`[data-respuesta="${CSS.escape(id)}"]`)?.value.trim() || '';
                    if (respuesta.length < 5) return alert('Cuenta brevemente qué hiciste antes de marcarla como cumplida.');
                    await fs.updateDoc(fs.doc(db, 'tareas', id), { estado: 'Cumplida', respuesta, fechaRespuesta: fs.serverTimestamp() });
                    mostrarToast('✅ Tarea enviada al jefe para revisión');
                } else if (nombre === 'aprobar') {
                    await fs.updateDoc(fs.doc(db, 'tareas', id), { estado: 'Aprobada', fechaCierre: fs.serverTimestamp() });
                    await actualizarEstadoReporte(t.reporteId, 'Atendido', true);
                    mostrarToast('👍 Tarea aprobada. El reporte pasó a Atendido.');
                } else if (nombre === 'mostrar-devolver') {
                    const caja = document.querySelector(`[data-devolver="${CSS.escape(id)}"]`);
                    if (caja) { caja.hidden = false; caja.querySelector('textarea')?.focus(); }
                } else if (nombre === 'devolver') {
                    const nota = document.querySelector(`[data-nota="${CSS.escape(id)}"]`)?.value.trim() || '';
                    const plazo = leerPlazo(document.querySelector(`[data-plazo="devolver-${CSS.escape(id)}"]`));
                    if (nota.length < 3) return alert('Escribe qué falta corregir.');
                    if (plazo.error) return alert(plazo.error);
                    const horas = plazo.horas;
                    await fs.updateDoc(fs.doc(db, 'tareas', id), { estado: 'Devuelta', notaJefe: nota, plazoHoras: horas, vence: new Date(ahora + horas * 3.6e6) });
                    avisadasVencidas.delete(id);
                    mostrarToast('↩️ Tarea devuelta con nuevo plazo');
                } else if (nombre === 'cancelar') {
                    if (!confirm('¿Cancelar esta tarea?')) return;
                    await fs.updateDoc(fs.doc(db, 'tareas', id), { estado: 'Cancelada', fechaCierre: fs.serverTimestamp() });
                    mostrarToast('Tarea cancelada');
                }
            } catch (error) {
                alert(error?.code === 'permission-denied' ? 'Firebase no permitió esta acción (revisa tus permisos o publica las reglas nuevas).' : 'No se pudo completar: ' + (error?.message || error));
            } finally {
                if (boton) boton.disabled = false;
            }
        }

        function conectarDetalle(contenedor, reporte) {
            const seccion = contenedor.querySelector('.tarea-seccion');
            if (!seccion) return;
            seccion.addEventListener('click', e => {
                const unidad = e.target.closest('[data-unidad]');
                const rapido = e.target.closest('[data-rapido]');
                if (unidad || rapido) {
                    const caja = e.target.closest('.plazo');
                    const [n, u] = rapido ? rapido.dataset.rapido.split('|') : [null, unidad.dataset.unidad];
                    if (n) caja.querySelector('.plazo-num').value = n;
                    caja.querySelectorAll('[data-unidad]').forEach(b => {
                        const activo = b.dataset.unidad === u;
                        b.classList.toggle('activo', activo);
                        b.setAttribute('aria-pressed', String(activo));
                    });
                    actualizarVence(caja);
                    return;
                }
                const b = e.target.closest('[data-accion]');
                if (b) accion(b.dataset.accion, b.dataset.id, reporte, b);
            });
            seccion.addEventListener('input', e => {
                if (e.target.classList.contains('plazo-num')) actualizarVence(e.target.closest('.plazo'));
            });
            seccion.querySelectorAll('.plazo').forEach(actualizarVence);
        }

        conectarPanel();
        conectarEquipo();
        return { iniciar, detener, htmlDetalle, conectarDetalle, tareasActivasDe: id => tareas.filter(t => t.reporteId === id && ACTIVAS.includes(t.estado)) };
    }

    raiz.Tareas = { crear };
})(typeof self !== 'undefined' ? self : this);
