const cantidadesPorLote = new Map();
const tarjetasAbiertas = new Set();
let ultimoJsonLotes = '';
let ultimoJsonReservas = '';
let pollingTimer = null;
const MSG_ERROR_RED = 'No se pudo conectar con el servidor. Reintentando...';

function escapeHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function obtenerMapsHref(lote) {
  const url = String(lote.maps_url || '').trim();
  if (url && /^https:\/\//i.test(url)) return url;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lote.ubicacion || '')}`;
}

function montarMapaSiAplica(tarjeta) {
  if (!tarjeta || tarjeta.dataset.simulado === '1') return;
  const cont = tarjeta.querySelector('.mapa-contenedor');
  if (!cont || cont.querySelector('iframe')) return;
  const ubicacion = tarjeta.dataset.ubicacion || '';
  if (!ubicacion) return;
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.google.com/maps?q=${encodeURIComponent(ubicacion)}&output=embed`;
  iframe.loading = 'lazy';
  iframe.referrerPolicy = 'no-referrer-when-downgrade';
  cont.appendChild(iframe);
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

function cerrarModalQr() {
  const qrDiv = document.getElementById('qr-resultado');
  if (!qrDiv) return;
  qrDiv.hidden = true;
  qrDiv.innerHTML = '';
  document.body.classList.remove('sin-scroll');
}

function abrirModalQr(data) {
  const qrDiv = document.getElementById('qr-resultado');
  if (!qrDiv) return;
  const simBadge = data.simulado ? '<span class="badge-simulado">DATOS DE PRUEBA SIMULADOS</span>' : '';
  qrDiv.innerHTML =
    `<div class="qr-modal-contenido">` +
    `<h3 id="qr-titulo">Reserva confirmada</h3>` +
    simBadge +
    `<div class="qr-imagen-wrap"><img src="${escapeHtml(data.qr)}" alt="QR de reserva"></div>` +
    `<div class="qr-codigo">${escapeHtml(data.codigo)}</div>` +
    `<p class="qr-indicacion">Muestra este código en la cafetería</p>` +
    `<button type="button" id="btn-cerrar-qr" class="btn-primario">Cerrar</button>` +
    `</div>`;
  qrDiv.hidden = false;
  document.body.classList.add('sin-scroll');
  const btnCerrar = document.getElementById('btn-cerrar-qr');
  if (btnCerrar) {
    btnCerrar.addEventListener('click', cerrarModalQr);
    btnCerrar.focus();
  }
}

const qrModal = document.getElementById('qr-resultado');
if (qrModal) {
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) {
      cerrarModalQr();
    }
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && qrModal && !qrModal.hidden) {
    cerrarModalQr();
  }
});

async function cargarLotes() {
  const categoria = document.getElementById('filtro-categoria').value.trim();
  const precioMax = document.getElementById('filtro-precio').value.trim();
  const panel = document.getElementById('panel-group');

  const params = new URLSearchParams();
  if (categoria) params.set('categoria', categoria);
  if (precioMax !== '') {
    const precioNum = Number(precioMax);
    if (Number.isNaN(precioNum) || precioNum < 0) {
      mostrarError('El precio máximo debe ser un número mayor o igual a 0.');
      return;
    }
    params.set('precioMax', String(precioNum));
  }
  const query = params.toString() ? `?${params.toString()}` : '';

  if (panel && ultimoJsonLotes === '') {
    panel.innerHTML = '<div class="estado-catalogo">Cargando lotes...</div>';
  }

  try {
    const res = await fetch(`/api/lotes${query}`);
    const lotes = await parseJsonSeguro(res);
    if (!lotes) throw new Error('Respuesta inválida del servidor.');
    if (!res.ok) throw new Error(lotes.error || 'Error al cargar lotes.');
    limpiarErrorSiRed();

    const jsonActual = JSON.stringify(lotes);
    if (jsonActual === ultimoJsonLotes) return;
    ultimoJsonLotes = jsonActual;

    panel.innerHTML = '';
    if (lotes.length === 0) {
      panel.innerHTML = '<div class="estado-catalogo">No hay lotes disponibles por ahora</div>';
      return;
    }

    lotes.forEach((lote) => {
      const tarjeta = document.createElement('div');
      const estaAbierta = tarjetasAbiertas.has(lote.id);
      tarjeta.className = estaAbierta ? 'tarjeta expandida' : 'tarjeta';
      tarjeta.dataset.id = lote.id;
      tarjeta.dataset.ubicacion = lote.ubicacion || '';
      tarjeta.dataset.simulado = lote.simulado ? '1' : '0';

      const simBadge = lote.simulado ? '<span class="badge-simulado">DATOS DE PRUEBA SIMULADOS</span>' : '';
      const imgHtml = lote.imagen
        ? `<img src="${escapeHtml(lote.imagen)}" alt="${escapeHtml(lote.nombre)}">`
        : '<div class="sin-imagen">Sin imagen</div>';
      const valorGuardado = cantidadesPorLote.get(lote.id) || '1';
      const orig = Number(lote.precio_original);
      const desc = Number(lote.precio_descuento);
      let precioHtml = `<span class="precio-descuento">$${escapeHtml(lote.precio_descuento)}</span>`;
      if (lote.precio_original !== undefined && lote.precio_original !== null && !Number.isNaN(orig) && orig > 0 && orig > desc) {
        const pct = Math.round((1 - desc / orig) * 100);
        precioHtml = `<s>$${escapeHtml(lote.precio_original)}</s> <span class="precio-descuento">$${escapeHtml(lote.precio_descuento)}</span> <span class="badge-descuento">-${pct}%</span>`;
      }
      const mapsHref = obtenerMapsHref(lote);
      const mapaHtml = lote.simulado
        ? '<div class="mapa-contenedor">Mapa no disponible en datos de prueba</div>'
        : '<div class="mapa-contenedor"></div>';
      const inputCantId = `cant-${escapeHtml(lote.id)}`;

      tarjeta.innerHTML =
        `<div class="lado-img">${imgHtml}</div>` +
        `<div class="lado-info">` +
        simBadge +
        `<div><span class="lote-titulo">${escapeHtml(lote.nombre)}</span> <span class="lote-categoria">(${escapeHtml(lote.categoria)})</span></div>` +
        `<div class="lote-precios">${precioHtml}</div>` +
        `<div class="lote-meta">Disponibles: ${escapeHtml(lote.cantidad_disponible)}</div>` +
        `<div class="lote-meta">Límite: ${escapeHtml(formatearHoraLimite(lote.hora_limite))}</div>` +
        `</div>` +
        `<div class="cantidad-wrap">` +
        `<label for="${inputCantId}">Cantidad</label>` +
        `<input type="number" id="${inputCantId}" class="input-cantidad" min="1" max="${escapeHtml(lote.cantidad_disponible)}" step="1" value="${escapeHtml(valorGuardado)}">` +
        `</div>` +
        `<div class="tarjeta-acciones">` +
        `<button type="button" class="btn-reservar" onclick="reservar('${escapeHtml(lote.id)}', this)">Reservar</button>` +
        `<button type="button" class="btn-tarjeta-sec" onclick="verMas(this)">${estaAbierta ? 'Ver menos' : 'Ver más'}</button>` +
        `</div>` +
        `<div class="detalle">` +
        `<div>${escapeHtml(lote.descripcion)}</div>` +
        `<div>Ubicación: ${escapeHtml(lote.ubicacion)}</div>` +
        `<div><a href="${escapeHtml(mapsHref)}" target="_blank" rel="noopener noreferrer"><button type="button" class="btn-tarjeta-sec">Abrir en Google Maps</button></a></div>` +
        mapaHtml +
        `</div>`;

      if (estaAbierta) {
        montarMapaSiAplica(tarjeta);
      }

      const inputCant = tarjeta.querySelector('.input-cantidad');
      inputCant.addEventListener('input', () => {
        cantidadesPorLote.set(lote.id, inputCant.value);
      });

      panel.appendChild(tarjeta);
    });
  } catch (err) {
    manejarErrorPeticion(err);
  }
}

async function reservar(loteId, boton) {
  mostrarError('');
  const nombre_cliente = document.getElementById('nombre-cliente').value.trim();
  const tarjeta = boton.closest('.tarjeta');
  const cantidad = tarjeta.querySelector('.input-cantidad').value;

  boton.disabled = true;
  try {
    const res = await fetch('/api/reservas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lote_id: loteId, cantidad, nombre_cliente })
    });
    const data = await parseJsonSeguro(res);
    if (!data) throw new Error('Respuesta inválida del servidor.');
    if (!res.ok) throw new Error(data.error || 'No se pudo realizar la reserva.');
    limpiarErrorSiRed();

    abrirModalQr(data);
    await Promise.all([cargarLotes(), cargarMisReservas()]);
  } catch (err) {
    manejarErrorPeticion(err);
  } finally {
    boton.disabled = false;
  }
}

async function cargarMisReservas() {
  const nombreRaw = document.getElementById('nombre-cliente').value.trim();
  const nombre = nombreRaw.toLowerCase();
  const lista = document.getElementById('mis-reservas-lista');
  if (!nombre) {
    ultimoJsonReservas = '';
    lista.innerHTML = '<p class="reservas-vacio">Escribe tu nombre arriba para ver tus reservas.</p>';
    return;
  }

  try {
    const res = await fetch(`/api/reservas?cliente=${encodeURIComponent(nombreRaw)}`);
    const reservas = await parseJsonSeguro(res);
    if (!reservas) throw new Error('Respuesta inválida del servidor.');
    if (!res.ok) throw new Error(reservas.error || 'Error al cargar reservas.');
    limpiarErrorSiRed();

    const mias = reservas.filter((r) => String(r.nombre_cliente || '').trim().toLowerCase() === nombre);
    const claveActual = `${nombre}|${JSON.stringify(mias)}`;
    if (claveActual === ultimoJsonReservas) return;
    ultimoJsonReservas = claveActual;

    if (mias.length === 0) {
      lista.innerHTML = '<p class="reservas-vacio">No tienes reservas registradas con ese nombre.</p>';
      return;
    }

    lista.innerHTML = '';
    mias.forEach((r) => {
      const item = document.createElement('div');
      item.className = 'reserva-card';
      const simBadge = r.simulado ? '<span class="badge-simulado">DATOS DE PRUEBA SIMULADOS</span>' : '';
      const estado = String(r.estado || 'reservada').toLowerCase();
      const producto = r.nombre_lote || r.lote_nombre || 'Lote reservado';
      const btnCancelar = estado === 'reservada'
        ? `<button type="button" class="btn-peligro" onclick="cancelarReserva('${escapeHtml(r.id)}', this)">Cancelar</button>`
        : '';
      item.innerHTML =
        `<div class="reserva-cabecera">` +
        `<span class="reserva-producto">${escapeHtml(producto)}</span>` +
        `<span class="estado-badge estado-${escapeHtml(estado)}">${escapeHtml(r.estado)}</span>` +
        `</div>` +
        `<div class="reserva-codigo">${escapeHtml(r.codigo)}</div>` +
        `<div class="reserva-meta">Cantidad: ${escapeHtml(r.cantidad)}</div>` +
        simBadge +
        btnCancelar;
      lista.appendChild(item);
    });
  } catch (err) {
    manejarErrorPeticion(err);
  }
}

async function cancelarReserva(id, boton) {
  mostrarError('');
  if (boton) boton.disabled = true;
  try {
    const res = await fetch(`/api/reservas/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'cancelada' })
    });
    const data = await parseJsonSeguro(res);
    if (!data) throw new Error('Respuesta inválida del servidor.');
    if (!res.ok) throw new Error(data.error || 'No se pudo cancelar la reserva.');
    limpiarErrorSiRed();
    await Promise.all([cargarLotes(), cargarMisReservas()]);
  } catch (err) {
    manejarErrorPeticion(err);
  } finally {
    if (boton) boton.disabled = false;
  }
}

window.verMas = function (boton) {
  const tarjeta = boton.closest('.tarjeta');
  const id = tarjeta?.dataset.id;
  const abierta = tarjeta.classList.toggle('expandida');
  if (id) {
    if (abierta) {
      tarjetasAbiertas.add(id);
      montarMapaSiAplica(tarjeta);
    } else {
      tarjetasAbiertas.delete(id);
    }
  }
  boton.textContent = abierta ? 'Ver menos' : 'Ver más';
};

window.reservar = reservar;
window.cancelarReserva = cancelarReserva;

document.getElementById('btn-filtrar').addEventListener('click', cargarLotes);
document.getElementById('nombre-cliente').addEventListener('input', cargarMisReservas);

function refrescarTodo() {
  return Promise.all([cargarLotes(), cargarMisReservas()]);
}

function iniciarPolling() {
  if (pollingTimer || document.hidden) return;
  pollingTimer = setInterval(refrescarTodo, 20000);
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

refrescarTodo();
iniciarPolling();
