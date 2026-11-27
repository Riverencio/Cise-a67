const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
let fallos = 0;

function reportar(nombre, ok, detalle = '') {
  const etiqueta = ok ? 'PASA' : 'FALLA';
  console.log(`[${etiqueta}] ${nombre}${detalle ? ` -> ${detalle}` : ''}`);
  if (!ok) fallos++;
}

async function req(ruta, opciones = {}) {
  const res = await fetch(`${BASE_URL}${ruta}`, {
    headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) },
    ...opciones
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function ejecutar() {
  const futuro = new Date(Date.now() + 3600 * 1000).toISOString();
  await req('/api/demo/reiniciar', { method: 'POST' });

  const resumenInicial = await req('/api/resumen');
  const base = resumenInicial.data;
  const sumaInicialOk =
    typeof base.disponible === 'number' &&
    base.unidades_publicadas === base.unidades_reservadas + base.unidades_recogidas + base.unidades_vencidas + base.disponible;
  reportar('0. Tras sembrar datos, publicado = reservado + recogido + vencido + disponible', sumaInicialOk, JSON.stringify(base));

  // 1. Publicar
  const pub1 = await req('/api/lotes', {
    method: 'POST',
    body: JSON.stringify({
      nombre: 'Pan dulce prueba',
      descripcion: 'DATOS DE PRUEBA SIMULADOS',
      categoria: 'Panadería',
      cantidad_total: 5,
      precio_descuento: 25,
      ubicacion: 'Centro',
      hora_limite: futuro,
      simulado: true
    })
  });
  reportar('1. Publicar lote', pub1.status === 201 && pub1.data.cantidad_disponible === 5, pub1.data.error);
  const loteId = pub1.data.id;

  // 2. Listar
  const lista = await req('/api/lotes?categoria=Panadería&precioMax=30');
  const encontrado = Array.isArray(lista.data) && lista.data.some((l) => l.id === loteId);
  reportar('2. Listar lotes filtrados', lista.ok && encontrado);

  // 3. Reservar
  const res1 = await req('/api/reservas', {
    method: 'POST',
    body: JSON.stringify({ lote_id: loteId, cantidad: 2, nombre_cliente: 'Ana', simulado: true })
  });
  reportar(
    '3. Reservar con QR',
    res1.status === 201 && /^RES-[A-F0-9]{6}$/.test(res1.data.codigo) && String(res1.data.qr).startsWith('data:image/png;base64,'),
    res1.data.error
  );

  // 4. Reserva mayor al stock rechazada
  const resExceso = await req('/api/reservas', {
    method: 'POST',
    body: JSON.stringify({ lote_id: loteId, cantidad: 10, nombre_cliente: 'Luis', simulado: true })
  });
  reportar('4. Reserva mayor al stock rechazada', resExceso.status === 400);

  // 5. Cantidad inválida rechazada
  const [inv0, invNeg, invDec] = await Promise.all([
    req('/api/reservas', { method: 'POST', body: JSON.stringify({ lote_id: loteId, cantidad: 0, nombre_cliente: 'X', simulado: true }) }),
    req('/api/reservas', { method: 'POST', body: JSON.stringify({ lote_id: loteId, cantidad: -2, nombre_cliente: 'X', simulado: true }) }),
    req('/api/reservas', { method: 'POST', body: JSON.stringify({ lote_id: loteId, cantidad: 1.5, nombre_cliente: 'X', simulado: true }) })
  ]);
  reportar('5. Cantidad inválida rechazada', inv0.status === 400 && invNeg.status === 400 && invDec.status === 400);

  // 6. Cancelar libera stock
  const cancel = await req(`/api/reservas/${res1.data.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ estado: 'cancelada' })
  });
  const listaPostCancel = await req('/api/lotes');
  const lotePostCancel = listaPostCancel.data.find((l) => l.id === loteId);
  reportar('6. Cancelar libera stock', cancel.ok && lotePostCancel && lotePostCancel.cantidad_disponible === 5);

  // 7. Dos reservas simultáneas sobre el mismo lote (stock = 5, piden 3 y 3)
  const [simA, simB] = await Promise.all([
    req('/api/reservas', { method: 'POST', body: JSON.stringify({ lote_id: loteId, cantidad: 3, nombre_cliente: 'C1', simulado: true }) }),
    req('/api/reservas', { method: 'POST', body: JSON.stringify({ lote_id: loteId, cantidad: 3, nombre_cliente: 'C2', simulado: true }) })
  ]);
  const exitosSim = [simA, simB].filter((r) => r.status === 201);
  const rechazosSim = [simA, simB].filter((r) => r.status === 400);
  reportar('7. Dos reservas simultáneas no exceden stock', exitosSim.length === 1 && rechazosSim.length === 1);

  // 8. Validar código (sobre la reserva exitosa de 3 unidades)
  const codigoValido = exitosSim[0]?.data?.codigo;
  const val = await req('/api/reservas/validar', {
    method: 'POST',
    body: JSON.stringify({ codigo: codigoValido })
  });
  const valRep = await req('/api/reservas/validar', {
    method: 'POST',
    body: JSON.stringify({ codigo: codigoValido })
  });
  reportar('8. Validar código (recogida) y rechazar doble validación', val.ok && val.data.estado === 'recogida' && valRep.status === 400);

  // 9. Vencer lote y rechazar reserva (quedan 2 disponibles en loteId)
  const vencer = await req(`/api/demo/vencer-lote/${loteId}`, { method: 'POST' });
  const resVencida = await req('/api/reservas', {
    method: 'POST',
    body: JSON.stringify({ lote_id: loteId, cantidad: 1, nombre_cliente: 'Tarde', simulado: true })
  });
  reportar('9. Vencer lote y rechazar reserva', vencer.ok && resVencida.status === 400);

  // 10. Resumen coherente (publicadas +5, reservadas +0, recogidas +3, vencidas +2)
  const resumenFinal = await req('/api/resumen');
  const fin = resumenFinal.data;
  const coherente =
    fin.unidades_publicadas === base.unidades_publicadas + 5 &&
    fin.unidades_reservadas === base.unidades_reservadas &&
    fin.unidades_recogidas === base.unidades_recogidas + 3 &&
    fin.unidades_vencidas === base.unidades_vencidas + 2;
  reportar('10. Resumen coherente', coherente, JSON.stringify({ base, fin }));

  // 11 y 12. Reporte IA en modo simulado
  const rep = await req('/api/reporte-ia', { method: 'POST' });
  const m = rep.data?.metricas;
  const metricasOk =
    rep.ok &&
    rep.data?.modo === 'simulado' &&
    m &&
    m.recogidas + m.vencidas === m.publicadas &&
    (m.tasa_rescate === null || (m.tasa_rescate >= 0 && m.tasa_rescate <= 100));
  reportar('11. Reporte IA: métricas coherentes', Boolean(metricasOk), JSON.stringify(m));

  const textoRep = String(rep.data?.reporte || '');
  const titulos = [
    '1. Resumen del periodo',
    '2. Tasa de rescate',
    '3. Productos críticos',
    '4. Patrones por día',
    '5. Recomendaciones'
  ];
  const titulosOk = titulos.every((t) => textoRep.includes(t));
  reportar('12. Reporte IA: cinco títulos presentes', titulosOk);

  // 13. Rechazar precio_descuento vacío y hora_limite pasada
  const pasado = new Date(Date.now() - 3600 * 1000).toISOString();
  const [pubPrecioVacio, pubPasado] = await Promise.all([
    req('/api/lotes', {
      method: 'POST',
      body: JSON.stringify({
        nombre: 'Prueba precio vacío',
        cantidad_total: 2,
        precio_descuento: '',
        hora_limite: futuro,
        simulado: true
      })
    }),
    req('/api/lotes', {
      method: 'POST',
      body: JSON.stringify({
        nombre: 'Prueba pasado',
        cantidad_total: 2,
        precio_descuento: 10,
        hora_limite: pasado,
        simulado: true
      })
    })
  ]);
  reportar('13. Rechazar precio_descuento vacío y hora_limite pasada', pubPrecioVacio.status === 400 && pubPasado.status === 400);

  // 14. Rechazar maps_url con usuario@host o dominio falso
  const [mapsUser, mapsEvil] = await Promise.all([
    req('/api/lotes', {
      method: 'POST',
      body: JSON.stringify({
        nombre: 'Prueba maps user',
        cantidad_total: 1,
        precio_descuento: 10,
        hora_limite: futuro,
        maps_url: 'https://evil.com@google.com/maps',
        simulado: true
      })
    }),
    req('/api/lotes', {
      method: 'POST',
      body: JSON.stringify({
        nombre: 'Prueba maps evil',
        cantidad_total: 1,
        precio_descuento: 10,
        hora_limite: futuro,
        maps_url: 'https://google.com.evil.com/maps',
        simulado: true
      })
    })
  ]);
  reportar('14. Rechazar maps_url con usuario@host y dominio falso', mapsUser.status === 400 && mapsEvil.status === 400);

  // 15. Normalizar hora_limite sin zona a ISO UTC
  const fechaLocalMx = new Date(Date.now() - 6 * 3600 * 1000 + 2 * 3600 * 1000).toISOString().slice(0, 16);
  const pubSinZona = await req('/api/lotes', {
    method: 'POST',
    body: JSON.stringify({
      nombre: 'Lote sin zona',
      cantidad_total: 2,
      precio_descuento: 15,
      hora_limite: fechaLocalMx,
      simulado: true
    })
  });
  const loteSinZonaId = pubSinZona.data?.id;
  reportar('15. Normalizar hora_limite sin zona a ISO UTC', pubSinZona.status === 201 && String(pubSinZona.data?.hora_limite).endsWith('Z'));

  // 16. No cancelar reserva si el lote ya venció
  const resParaVencer = await req('/api/reservas', {
    method: 'POST',
    body: JSON.stringify({ lote_id: loteSinZonaId, cantidad: 1, nombre_cliente: 'TestVenc', simulado: true })
  });
  await req(`/api/demo/vencer-lote/${loteSinZonaId}`, { method: 'POST' });
  const cancelVencida = await req(`/api/reservas/${resParaVencer.data?.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ estado: 'cancelada' })
  });
  reportar('16. Rechazar cancelación de reserva cuyo lote venció', cancelVencida.status === 400);

  // 17. Eliminar lote vencido sin reservas activas ni recogidas borra también sus reservas vencidas
  const delSinHuerfanas = await req(`/api/lotes/${loteSinZonaId}`, { method: 'DELETE' });
  const resHuerfanas = await req('/api/reservas?cliente=TestVenc');
  const quedanHuerfanas = Array.isArray(resHuerfanas.data) && resHuerfanas.data.some((r) => r.lote_id === loteSinZonaId);
  reportar('17. Eliminar lote borra sus reservas vencidas sin huérfanos', delSinHuerfanas.ok && !quedanHuerfanas);

  // 18. Demo vencer-lote rechaza lotes no simulados
  const pubRealTemp = await req('/api/lotes', {
    method: 'POST',
    body: JSON.stringify({
      nombre: 'Lote temporal no simulado',
      cantidad_total: 1,
      precio_descuento: 10,
      hora_limite: futuro,
      simulado: false
    })
  });
  const idRealTemp = pubRealTemp.data?.id;
  const vencerReal = await req(`/api/demo/vencer-lote/${idRealTemp}`, { method: 'POST' });
  await req(`/api/lotes/${idRealTemp}`, { method: 'DELETE' });
  reportar('18. Demo vencer-lote rechaza lotes no simulados', pubRealTemp.status === 201 && vencerReal.status === 403);

  await req('/api/demo/reiniciar', { method: 'POST' });

  // 19. Vencidas del reporte coinciden con las del resumen al vencer todos los lotes activos
  const activos = await req('/api/lotes');
  if (Array.isArray(activos.data)) {
    for (const l of activos.data) {
      await req(`/api/demo/vencer-lote/${l.id}`, { method: 'POST' });
    }
  }
  const [resTodosVencidos, repTodosVencidos] = await Promise.all([
    req('/api/resumen'),
    req('/api/reporte-ia', { method: 'POST' })
  ]);
  const rv = resTodosVencidos.data;
  const mv = repTodosVencidos.data?.metricas;
  const coincidenVencidas =
    Boolean(rv && mv) &&
    rv.disponible === 0 &&
    rv.unidades_reservadas === 0 &&
    rv.unidades_vencidas === mv.vencidas &&
    rv.unidades_publicadas === mv.publicadas &&
    rv.unidades_recogidas === mv.recogidas;
  reportar('19. Vencidas del reporte coinciden con resumen al cerrar todos los lotes', coincidenVencidas, JSON.stringify({ rv, mv: mv ? { publicadas: mv.publicadas, recogidas: mv.recogidas, vencidas: mv.vencidas } : null }));

  await req('/api/demo/reiniciar', { method: 'POST' });
  process.exit(fallos > 0 ? 1 : 0);
}

ejecutar().catch((err) => {
  console.error('Error ejecutando pruebas:', err);
  process.exit(1);
});
