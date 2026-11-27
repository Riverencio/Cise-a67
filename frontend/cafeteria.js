const tarjetasAbiertas = new Set();
let ultimoJsonLotes = '';
let ultimoJsonResumen = '';
let pollingTimer = null;
let demoMode = false;
const MSG_ERROR_RED = 'No se pudo conectar con el servidor. Reintentando...';

function escapeHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mostrarError(msg) {
  const el = document.getElementById('mensaje-error');
  if (el) el.textContent = msg || '';
}

function manejarErrorPeticion(err) {
  if (err instanceof TypeError || String(err?.message || '').includes('Failed to fetch')) {
    mostrarError(MSG_ERROR_RED);
  } else {
    mostrarError(err?.message || 'Ocurrió un error.');
  }
}

function limpiarErrorSiRed() {
  const el = document.getElementById('mensaje-error');
  if (el && el.textContent === MSG_ERROR_RED) {
    el.textContent = '';
  }
}

function mostrarEstado(msg) {
  const el = document.getElementById('mensaje-estado');
  if (el) el.textContent = msg || '';
}

async function parseJsonSeguro(res) {
  const tipo = res.headers.get('content-type') || '';
  if (!tipo.includes('application/json')) {
    return null;
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function formatearHoraLimite(valor) {
  if (!valor) return '';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return String(valor);
  return fecha.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

function abrirForm() {
  const form = document.getElementById('formulario');
  form.classList.add('mostrar');
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cerrarForm() {
  document.getElementById('formulario').classList.remove('mostrar');
}

async function cargarCafeteria() {
  const aviso = document.getElementById('aviso-suscripcion');
  const nombreEl = document.getElementById('cafeteria-nombre');
  const simEl = document.getElementById('cafeteria-simulado');
  if (!aviso) return;
  try {
    const res = await fetch('/api/cafeteria');
    const data = await parseJsonSeguro(res);
    if (!data) throw new Error('Respuesta inválida del servidor.');
    if (!res.ok) throw new Error(data.error || 'Error al cargar cafetería.');
    limpiarErrorSiRed();

    if (nombreEl) {
      nombreEl.textContent = data.nombre || 'Cafetería';
    }
    if (simEl) {
      simEl.style.display = data.simulado ? 'inline-block' : 'none';
    }

    let texto = '';
    if (data.suscripcion && data.suscripcion.inicio) {
      const inicio = new Date(data.suscripcion.inicio);
      const fin = new Date(inicio.getTime() + 30 * 24 * 60 * 60 * 1000);
      const diasRestantes = Math.ceil((fin.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      texto = diasRestantes > 0
        ? `Prueba gratuita: ${diasRestantes} días restantes`
        : 'Prueba terminada: requiere suscripción mensual';
    } else {
      texto = 'Prueba terminada: requiere suscripción mensual';
    }

    aviso.textContent = texto;

    const nuevoDemoMode = Boolean(data.demo_mode);
    const demoWrap = document.getElementById('menu-demo-wrap');
    if (demoWrap) {
      demoWrap.style.display = nuevoDemoMode ? 'block' : 'none';
    }
    if (nuevoDemoMode !== demoMode) {
      demoMode = nuevoDemoMode;
      ultimoJsonLotes = '';
    }
  } catch (err) {
    manejarErrorPeticion(err);
  }
}

async function cargarResumen() {
  try {
    const res = await fetch('/api/resumen');
    const data = await parseJsonSeguro(res);
    if (!data) throw new Error('Respuesta inválida del servidor.');
    if (!res.ok) throw new Error(data.error || 'Error al cargar resumen.');
    limpiarErrorSiRed();

    const jsonActual = JSON.stringify(data);
    if (jsonActual === ultimoJsonResumen) return;
    ultimoJsonResumen = jsonActual;

    document.getElementById('res-publicado').textContent = data.unidades_publicadas ?? 0;
    document.getElementById('res-reservado').textContent = data.unidades_reservadas ?? 0;
    document.getElementById('res-recogido').textContent = data.unidades_recogidas ?? 0;
    document.getElementById('res-vencido').textContent = data.unidades_vencidas ?? 0;

    const dispCard = document.getElementById('res-disponible-card');
    const dispVal = document.getElementById('res-disponible');
    const disponible = data.unidades_disponibles ?? data.disponible;
    if (dispCard && dispVal) {
      if (disponible !== undefined && disponible !== null) {
        dispVal.textContent = disponible;
        dispCard.style.display = 'flex';
      } else {
        dispCard.style.display = 'none';
      }
    }
  } catch (err) {
    manejarErrorPeticion(err);
  }
}

async function confirmar(boton) {
  mostrarError('');
  mostrarEstado('');
  const btn = boton || document.getElementById('btn-confirmar');
  const nombre = document.getElementById('nombre').value.trim();
  const descripcion = document.getElementById('descripcion').value.trim();
  const categoria = document.getElementById('categoria').value.trim() || 'General';
  const cantidad_total = document.getElementById('cantidad_total').value;
  const precio_original = document.getElementById('precio_original').value;
  const precio_descuento = document.getElementById('precio_descuento').value;
  const archivoImagen = document.getElementById('imagen').files[0];
  const ubicacion = document.getElementById('ubicacion').value.trim();
  const maps_url = document.getElementById('maps_url').value.trim();
  const hora_limite = document.getElementById('hora_limite').value;

  const precioOrigNum = Number(precio_original);
  const precioDescNum = Number(precio_descuento);
  if (precio_original === '' || Number.isNaN(precioOrigNum) || precioOrigNum <= 0) {
    mostrarError('El precio original es obligatorio y debe ser mayor a 0.');
    return;
  }
  if (precio_descuento === '' || Number.isNaN(precioDescNum) || precioDescNum < 0) {
    mostrarError('El precio con descuento es obligatorio y debe ser mayor o igual a 0.');
    return;
  }
  if (precioOrigNum <= precioDescNum) {
    mostrarError('El precio original debe ser mayor que el precio con descuento.');
    return;
  }

  const formData = new FormData();
  formData.append('nombre', nombre);
  formData.append('descripcion', descripcion);
  formData.append('categoria', categoria);
  formData.append('cantidad_total', cantidad_total);
  formData.append('precio_original', precio_original);
  formData.append('precio_descuento', precio_descuento);
  formData.append('ubicacion', ubicacion);
  if (maps_url) {
    formData.append('maps_url', maps_url);
  }
  formData.append('hora_limite', hora_limite);
  if (archivoImagen) {
    formData.append('imagen', archivoImagen);
  }

  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/lotes', { method: 'POST', body: formData });
    const data = await parseJsonSeguro(res);
    if (!data) throw new Error('Respuesta inválida del servidor.');
    if (!res.ok) throw new Error(data.error || 'Error al publicar el lote.');
    limpiarErrorSiRed();

    document.getElementById('nombre').value = '';
    document.getElementById('descripcion').value = '';
    document.getElementById('categoria').value = '';
    document.getElementById('cantidad_total').value = '';
    document.getElementById('precio_original').value = '';
    document.getElementById('precio_descuento').value = '';
    document.getElementById('imagen').value = '';
    document.getElementById('ubicacion').value = '';
    document.getElementById('maps_url').value = '';
    document.getElementById('hora_limite').value = '';
    cerrarForm();
    await Promise.all([cargarLotes(), cargarResumen()]);
  } catch (err) {
    manejarErrorPeticion(err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function eliminar(boton) {
  mostrarError('');
  mostrarEstado('');
  const tarjeta = boton.closest('.tarjeta');
  const id = tarjeta?.dataset.id;
  if (!id) return;

  boton.disabled = true;
  try {
    const res = await fetch(`/api/lotes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await parseJsonSeguro(res);
    if (!data) throw new Error('Respuesta inválida del servidor.');
    if (!res.ok) throw new Error(data.error || 'No se pudo eliminar el lote.');
    limpiarErrorSiRed();
    await Promise.all([cargarLotes(), cargarResumen()]);
  } catch (err) {
    manejarErrorPeticion(err);
  } finally {
    boton.disabled = false;
  }
}

function verMas(boton) {
  const tarjeta = boton.closest('.tarjeta');
  const id = tarjeta?.dataset.id;
  const abierta = tarjeta.classList.toggle('expandida');
  if (id) {
    if (abierta) tarjetasAbiertas.add(id);
    else tarjetasAbiertas.delete(id);
  }
  boton.textContent = abierta ? 'Ver menos' : 'Ver más';
}

async function cargarLotes() {
  const panel = document.getElementById('panel-group');
  try {
    const res = await fetch('/api/lotes');
    const lotes = await parseJsonSeguro(res);
    if (!lotes) throw new Error('Respuesta inválida del servidor.');
    if (!res.ok) throw new Error(lotes.error || 'Error al cargar lotes.');
    limpiarErrorSiRed();

    const jsonActual = JSON.stringify(lotes);
    if (jsonActual === ultimoJsonLotes) return;
    ultimoJsonLotes = jsonActual;

    panel.innerHTML = '';
    lotes.forEach((lote) => {
      const tarjeta = document.createElement('div');
      const estaAbierta = tarjetasAbiertas.has(lote.id);
      tarjeta.className = estaAbierta ? 'tarjeta expandida' : 'tarjeta';
      tarjeta.dataset.id = lote.id;
      const simBadge = lote.simulado ? '<span class="badge-simulado">DATOS DE PRUEBA SIMULADOS</span>' : '';
      const imgHtml = lote.imagen
        ? `<img src="${escapeHtml(lote.imagen)}" alt="${escapeHtml(lote.nombre)}">`
        : '<div class="sin-imagen">Sin imagen</div>';
      const orig = Number(lote.precio_original);
      const desc = Number(lote.precio_descuento);
      let precioHtml = `<span class="precio-descuento">$${escapeHtml(lote.precio_descuento)}</span>`;
      if (lote.precio_original !== undefined && lote.precio_original !== null && !Number.isNaN(orig) && orig > 0 && orig > desc) {
        const pct = Math.round((1 - desc / orig) * 100);
        precioHtml = `<s>$${escapeHtml(lote.precio_original)}</s> <span class="precio-descuento">$${escapeHtml(lote.precio_descuento)}</span> <span class="badge-descuento">-${pct}%</span>`;
      }
      const btnVencerDemo = demoMode && lote.estado === 'activo'
        ? `<button type="button" class="btn-demo-vencer" onclick="vencerLoteDemo('${escapeHtml(lote.id)}', this)">Vencer ahora (demo)</button>`
        : '';

      tarjeta.innerHTML =
        `<div class="lado-img">${imgHtml}</div>` +
        `<div class="lado-info">` +
        simBadge +
        `<div><span class="lote-titulo">${escapeHtml(lote.nombre)}</span> <span class="lote-categoria">(${escapeHtml(lote.categoria)})</span></div>` +
        `<div class="lote-precios">${precioHtml}</div>` +
        `<div class="lote-meta">Disponibles: ${escapeHtml(lote.cantidad_disponible)} / ${escapeHtml(lote.cantidad_total)}</div>` +
        `<div class="lote-meta">Límite: ${escapeHtml(formatearHoraLimite(lote.hora_limite))}</div>` +
        `</div>` +
        `<div class="tarjeta-acciones">` +
        `<button type="button" class="btn-tarjeta-sec" onclick="verMas(this)">${estaAbierta ? 'Ver menos' : 'Ver más'}</button>` +
        `<button type="button" class="btnEliminar" onclick="eliminar(this)">Eliminar</button>` +
        btnVencerDemo +
        `</div>` +
        `<div class="detalle">` +
        `<div>${escapeHtml(lote.descripcion)}</div>` +
        `<div>Ubicación: ${escapeHtml(lote.ubicacion)}</div>` +
        `</div>`;
      panel.appendChild(tarjeta);
    });
  } catch (err) {
    manejarErrorPeticion(err);
  }
}

async function validarCodigo() {
  mostrarError('');
  mostrarEstado('');
  const btn = document.getElementById('btn-validar');
  const input = document.getElementById('codigo-validar');
  const salida = document.getElementById('resultado-validar');
  const codigo = input.value.trim();
  salida.textContent = '';

  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/reservas/validar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo })
    });
    const data = await parseJsonSeguro(res);
    if (!data) throw new Error('Respuesta inválida del servidor.');
    if (!res.ok) throw new Error(data.error || 'Error al validar código.');
    limpiarErrorSiRed();

    const sim = data.simulado ? ' [DATOS DE PRUEBA SIMULADOS]' : '';
    salida.textContent = `Validada: ${data.codigo} - ${data.nombre_cliente} (x${data.cantidad})${sim}`;
    input.value = '';
    await Promise.all([cargarLotes(), cargarResumen()]);
  } catch (err) {
    if (err instanceof TypeError || String(err?.message || '').includes('Failed to fetch')) {
      manejarErrorPeticion(err);
    } else {
      salida.textContent = `Error: ${err.message}`;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function crearCifraReporte(etiqueta, valor) {
  const card = document.createElement('div');
  card.className = 'reporte-cifra-card';
  const valEl = document.createElement('span');
  valEl.className = 'reporte-cifra-valor';
  valEl.textContent = valor;
  const lblEl = document.createElement('span');
  lblEl.className = 'reporte-cifra-etiqueta';
  lblEl.textContent = etiqueta;
  card.appendChild(valEl);
  card.appendChild(lblEl);
  return card;
}

async function generarReporteIA() {
  mostrarError('');
  mostrarEstado('');
  const btn = document.getElementById('btn-reporte-ia');
  const etiquetaEl = document.getElementById('etiqueta-ia');
  const salidaEl = document.getElementById('resultado-ia');
  etiquetaEl.textContent = '';
  salidaEl.textContent = 'Generando reporte...';

  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/reporte-ia', { method: 'POST' });
    const data = await parseJsonSeguro(res);
    if (!data) throw new Error('Respuesta inválida del servidor.');
    if (!res.ok) throw new Error(data.error || 'Error al generar reporte.');
    limpiarErrorSiRed();

    salidaEl.replaceChildren();
    const m = data.metricas;
    if (m) {
      const tasa = m.tasa_rescate === null ? 'N/A' : `${m.tasa_rescate}%`;
      const metricasWrap = document.createElement('div');
      metricasWrap.className = 'reporte-metricas-wrap';

      const subtitulo = document.createElement('p');
      subtitulo.className = 'reporte-subtitulo';
      subtitulo.textContent = 'Lotes ya cerrados de los últimos 30 días';
      metricasWrap.appendChild(subtitulo);

      const cifrasGrid = document.createElement('div');
      cifrasGrid.className = 'reporte-cifras';
      cifrasGrid.appendChild(crearCifraReporte('Publicadas', m.publicadas));
      cifrasGrid.appendChild(crearCifraReporte('Recogidas', m.recogidas));
      cifrasGrid.appendChild(crearCifraReporte('Vencidas', m.vencidas));
      cifrasGrid.appendChild(crearCifraReporte('Tasa de rescate', tasa));
      metricasWrap.appendChild(cifrasGrid);

      salidaEl.appendChild(metricasWrap);
    }

    const lineas = String(data.reporte || '').split(/\r?\n/);
    let vioTitulo = false;
    for (const linea of lineas) {
      const p = document.createElement('p');
      const texto = linea.trim();
      if (/^\d+\.\s/.test(texto)) {
        vioTitulo = true;
        p.className = 'reporte-titulo';
      } else if (texto.startsWith('- ')) {
        p.className = 'reporte-item';
      } else if (!vioTitulo && texto) {
        p.className = 'reporte-aviso';
      }
      p.textContent = linea || '\u00A0';
      salidaEl.appendChild(p);
    }

    const pie = document.createElement('p');
    pie.className = 'reporte-pie';
    pie.textContent = data.modo === 'ia' ? 'Generado con IA' : 'Reporte simulado';
    salidaEl.appendChild(pie);

    if (m && (m.datos_simulados === 'todos' || m.datos_simulados === 'parte')) {
      etiquetaEl.textContent = 'DATOS DE PRUEBA SIMULADOS';
    }
  } catch (err) {
    salidaEl.textContent = '';
    manejarErrorPeticion(err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

const boton = document.getElementById('menu');
const cuadro = document.getElementById('cuadro-info');
const menuBackdrop = document.getElementById('menu-backdrop');
const btnCerrarMenu = document.getElementById('menu-cerrar');

function abrirMenu() {
  cuadro.classList.add('abierto');
  boton.classList.add('mover');
  boton.setAttribute('aria-expanded', 'true');
  if (menuBackdrop) menuBackdrop.hidden = false;
  document.body.classList.add('sin-scroll');
}

function cerrarMenu() {
  cuadro.classList.remove('abierto');
  boton.classList.remove('mover');
  boton.setAttribute('aria-expanded', 'false');
  if (menuBackdrop) menuBackdrop.hidden = true;
  document.body.classList.remove('sin-scroll');
}

boton.addEventListener('click', () => {
  if (cuadro.classList.contains('abierto')) {
    cerrarMenu();
  } else {
    abrirMenu();
  }
});

if (menuBackdrop) {
  menuBackdrop.addEventListener('click', cerrarMenu);
}

if (btnCerrarMenu) {
  btnCerrarMenu.addEventListener('click', cerrarMenu);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && cuadro.classList.contains('abierto')) {
    cerrarMenu();
  }
});

async function reiniciarDemo() {
  if (!confirm('¿Reiniciar los datos de demostración? Se restaurarán los datos simulados.')) return;
  mostrarError('');
  mostrarEstado('');
  const btn = document.getElementById('menu-reiniciar-demo');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/demo/reiniciar', { method: 'POST' });
    const data = await parseJsonSeguro(res);
    if (!data) throw new Error('Respuesta inválida del servidor.');
    if (!res.ok) throw new Error(data.error || 'No se pudieron reiniciar los datos.');
    limpiarErrorSiRed();
    ultimoJsonLotes = '';
    ultimoJsonResumen = '';
    await refrescarTodo();
    mostrarEstado('Datos de demostración reiniciados');
  } catch (err) {
    manejarErrorPeticion(err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function vencerLoteDemo(id, boton) {
  mostrarError('');
  mostrarEstado('');
  if (boton) boton.disabled = true;
  try {
    const res = await fetch(`/api/demo/vencer-lote/${encodeURIComponent(id)}`, { method: 'POST' });
    const data = await parseJsonSeguro(res);
    if (!data) throw new Error('Respuesta inválida del servidor.');
    if (!res.ok) throw new Error(data.error || 'No se pudo vencer el lote.');
    limpiarErrorSiRed();
    ultimoJsonLotes = '';
    ultimoJsonResumen = '';
    await refrescarTodo();
    mostrarEstado('Lote vencido');
  } catch (err) {
    manejarErrorPeticion(err);
  } finally {
    if (boton) boton.disabled = false;
  }
}

document.getElementById('menu-publicar').addEventListener('click', () => {
  cerrarMenu();
  abrirForm();
});
document.getElementById('menu-validar').addEventListener('click', () => {
  cerrarMenu();
  document.getElementById('validar-panel').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('codigo-validar').focus();
});
document.getElementById('menu-ia').addEventListener('click', () => {
  cerrarMenu();
  document.getElementById('ia-panel').scrollIntoView({ behavior: 'smooth' });
});
document.getElementById('menu-resumen').addEventListener('click', () => {
  cerrarMenu();
  document.getElementById('resumen-panel').scrollIntoView({ behavior: 'smooth' });
});
document.getElementById('menu-cliente').addEventListener('click', cerrarMenu);
document.getElementById('menu-reiniciar-demo').addEventListener('click', () => {
  cerrarMenu();
  reiniciarDemo();
});

document.getElementById('btn-validar').addEventListener('click', validarCodigo);
document.getElementById('btn-reporte-ia').addEventListener('click', generarReporteIA);

window.eliminar = eliminar;
window.confirmar = confirmar;
window.abrirForm = abrirForm;
window.cerrarForm = cerrarForm;
window.verMas = verMas;
window.vencerLoteDemo = vencerLoteDemo;

function refrescarTodo() {
  return Promise.all([cargarLotes(), cargarResumen()]);
}

function iniciarPolling() {
  if (pollingTimer || document.hidden) return;
  pollingTimer = setInterval(refrescarTodo, 15000);
}

function detenerPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    detenerPolling();
  } else {
    refrescarTodo();
    iniciarPolling();
  }
});

const btnActualizarExistente = document.getElementById('btn-actualizar');
if (btnActualizarExistente) {
  btnActualizarExistente.addEventListener('click', refrescarTodo);
} else {
  const panelGroup = document.getElementById('panel-group');
  if (panelGroup) {
    const btnActualizar = document.createElement('button');
    btnActualizar.id = 'btn-actualizar';
    btnActualizar.type = 'button';
    btnActualizar.textContent = 'Actualizar';
    btnActualizar.addEventListener('click', refrescarTodo);
    panelGroup.parentNode.insertBefore(btnActualizar, panelGroup);
  }
}

cargarCafeteria().then(() => {
  refrescarTodo();
  iniciarPolling();
});
