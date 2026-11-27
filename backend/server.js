const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const QRCode = require('qrcode');
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');
const { cargarDatosSeed } = require('./seed/cargar_seed');
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('Falta el archivo backend/.env. Copia backend/.env.example a backend/.env y configura tus variables.');
  process.exit(1);
}
require('dotenv').config({ path: envPath });

const app = express();
const PORT = process.env.PORT || 3000;
const DEMO_MODE = process.env.DEMO_MODE === 'true';

const uploadsDir = path.join(__dirname, 'uploads');
const frontendDir = path.join(__dirname, '..', 'frontend');
fs.mkdirSync(uploadsDir, { recursive: true });

const envFirebasePath = (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
if (!envFirebasePath) {
  console.error('Falta definir FIREBASE_SERVICE_ACCOUNT_PATH en backend/.env (ej. ./serviceAccountKey.json).');
  process.exit(1);
}
const serviceAccountPath = path.resolve(__dirname, envFirebasePath);
if (!fs.existsSync(serviceAccountPath)) {
  console.error('No existe el archivo de credenciales de Firebase en:', serviceAccountPath, '(revisa FIREBASE_SERVICE_ACCOUNT_PATH en backend/.env).');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath))
});
const db = admin.firestore();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(frontendDir));

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIMES.has(file.mimetype) || !ALLOWED_EXTS.has(ext)) {
      return cb(new Error('Formato de imagen inválido. Solo se permiten jpg, png o webp.'));
    }
    cb(null, true);
  }
});

/** Convierte hora_limite (ISO, timestamp, datetime-local en UTC-6 o HH:MM) a objeto Date. */
function parseHoraLimite(valor) {
  if (!valor) return null;
  if (typeof valor.toDate === 'function') return valor.toDate();
  if (typeof valor === 'string') {
    const limpio = valor.trim();
    const matchHora = /^(\d{1,2}):(\d{2})$/.exec(limpio);
    if (matchHora) {
      const fecha = new Date();
      fecha.setHours(Number(matchHora[1]), Number(matchHora[2]), 0, 0);
      return fecha;
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(limpio)) {
      const conZona = new Date(`${limpio}-06:00`);
      return Number.isNaN(conZona.getTime()) ? null : conZona;
    }
  }
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

const CADUCIDAD_TTL_MS = 30 * 1000;
const RESUMEN_TTL_MS = 10 * 1000;
let ultimaRevisionCaducidad = 0;
let resumenCache = null;
let resumenCacheTs = 0;

function invalidarResumenCache() {
  resumenCache = null;
  resumenCacheTs = 0;
}

function invalidarCachesDemo() {
  invalidarResumenCache();
  ultimaRevisionCaducidad = 0;
}

function validarMapsUrl(valor) {
  if (valor === undefined || valor === null) return '';
  const limpia = String(valor).trim();
  if (!limpia) return '';
  let parsed;
  try {
    parsed = new URL(limpia);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  const hostValido =
    host === 'google.com' ||
    host.endsWith('.google.com') ||
    host === 'maps.app.goo.gl' ||
    host === 'goo.gl';
  return hostValido ? limpia : null;
}

function logLecturas(endpoint, lecturas) {
  if (DEMO_MODE) {
    console.log(`[DEMO_MODE] ${endpoint} - lecturas Firestore: ${lecturas}`);
  }
}

/** Marca como vencidos los lotes cuya hora_limite ya pasó y sus reservas activas. */
async function actualizarCaducidad(forzar = false) {
  const ahora = Date.now();
  if (!forzar && ahora - ultimaRevisionCaducidad < CADUCIDAD_TTL_MS) {
    return { lecturas: 0, vencidos: 0 };
  }

  const lotesActivos = await db.collection('lotes').where('estado', '==', 'activo').get();
  let lecturas = lotesActivos.size;
  if (lotesActivos.empty) {
    ultimaRevisionCaducidad = Date.now();
    return { lecturas, vencidos: 0 };
  }

  const batch = db.batch();
  let operaciones = 0;
  let vencidos = 0;

  for (const docLote of lotesActivos.docs) {
    const limite = parseHoraLimite(docLote.data().hora_limite);
    if (limite && limite.getTime() < ahora) {
      batch.update(docLote.ref, { estado: 'vencido' });
      operaciones++;
      vencidos++;

      const reservasSnap = await db.collection('reservas').where('lote_id', '==', docLote.id).get();
      lecturas += reservasSnap.size;
      for (const docRes of reservasSnap.docs) {
        if (docRes.data().estado === 'reservada') {
          batch.update(docRes.ref, { estado: 'vencida' });
          operaciones++;
        }
      }
    }
  }

  if (operaciones > 0) {
    await batch.commit();
    invalidarResumenCache();
  }

  ultimaRevisionCaducidad = Date.now();
  return { lecturas, vencidos };
}

function generarCodigoReserva() {
  return `RES-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function borrarSimulados(coleccion) {
  const snap = await db.collection(coleccion).where('simulado', '==', true).get();
  if (snap.empty) return 0;

  let borrados = 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    const trozo = snap.docs.slice(i, i + 400);
    trozo.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    borrados += trozo.length;
  }
  return borrados;
}

app.get('/api/cafeteria', async (_req, res, next) => {
  try {
    const snap = await db.collection('cafeterias').limit(1).get();
    logLecturas('GET /api/cafeteria', snap.size);
    if (snap.empty) {
      return res.json({
        nombre: 'Sin cafetería configurada',
        suscripcion: null,
        demo_mode: DEMO_MODE
      });
    }
    const data = snap.docs[0].data();
    res.json({
      id: snap.docs[0].id,
      nombre: data.nombre,
      suscripcion: data.suscripcion || null,
      simulado: Boolean(data.simulado),
      demo_mode: DEMO_MODE
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/lotes', async (req, res, next) => {
  try {
    const cad = await actualizarCaducidad();
    const categoria = (req.query.categoria || '').trim().toLowerCase();
    const precioMaxRaw = req.query.precioMax;
    const precioMax = precioMaxRaw !== undefined && precioMaxRaw !== '' ? Number(precioMaxRaw) : null;

    const snap = await db.collection('lotes').where('estado', '==', 'activo').get();
    logLecturas('GET /api/lotes', cad.lecturas + snap.size);
    const lotes = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((lote) => {
        if (lote.estado !== 'activo') return false;
        if (Number(lote.cantidad_disponible) <= 0) return false;
        if (categoria && String(lote.categoria || '').toLowerCase() !== categoria) return false;
        if (precioMax !== null && !Number.isNaN(precioMax) && Number(lote.precio_descuento) > precioMax) {
          return false;
        }
        return true;
      });

    res.json(lotes);
  } catch (err) {
    next(err);
  }
});

function limpiarArchivoSubido(file) {
  if (file && file.path && fs.existsSync(file.path)) {
    fs.unlink(file.path, () => {});
  }
}

app.post('/api/lotes', upload.single('imagen'), async (req, res, next) => {
  try {
    const {
      nombre,
      descripcion = '',
      categoria = 'General',
      cantidad_total,
      precio_descuento,
      precio_original,
      ubicacion = '',
      maps_url,
      hora_limite,
      simulado = false
    } = req.body;

    const nombreLimpio = String(nombre || '').trim();
    const descripcionLimpia = String(descripcion || '').trim();
    const categoriaLimpia = String(categoria || '').trim() || 'General';
    const ubicacionLimpia = String(ubicacion || '').trim();

    const totalNum = Number(cantidad_total);
    const tienePrecioDesc =
      precio_descuento !== undefined &&
      precio_descuento !== null &&
      String(precio_descuento).trim() !== '';
    const precioNum = tienePrecioDesc ? Number(precio_descuento) : NaN;
    const tienePrecioOriginal =
      precio_original !== undefined &&
      precio_original !== null &&
      String(precio_original).trim() !== '';
    const precioOriginalNum = tienePrecioOriginal ? Number(precio_original) : null;
    const mapsUrlValidada = validarMapsUrl(maps_url);
    const limite = parseHoraLimite(hora_limite);

    const responderError = (msg) => {
      limpiarArchivoSubido(req.file);
      return res.status(400).json({ error: msg });
    };

    if (!nombreLimpio || nombreLimpio.length > 120) {
      return responderError('El nombre del lote es obligatorio (máximo 120 caracteres).');
    }
    if (categoriaLimpia.length > 50) {
      return responderError('La categoría no puede exceder 50 caracteres.');
    }
    if (descripcionLimpia.length > 500) {
      return responderError('La descripción no puede exceder 500 caracteres.');
    }
    if (ubicacionLimpia.length > 200) {
      return responderError('La ubicación no puede exceder 200 caracteres.');
    }
    if (!Number.isInteger(totalNum) || totalNum <= 0) {
      return responderError('La cantidad_total debe ser un número entero mayor a 0.');
    }
    if (!tienePrecioDesc || Number.isNaN(precioNum) || precioNum < 0) {
      return responderError('El precio_descuento es obligatorio y debe ser mayor o igual a 0.');
    }
    if (tienePrecioOriginal) {
      if (Number.isNaN(precioOriginalNum) || precioOriginalNum <= 0) {
        return responderError('El precio_original debe ser un número mayor a 0.');
      }
      if (precioOriginalNum <= precioNum) {
        return responderError('El precio_original debe ser mayor que el precio_descuento.');
      }
    }
    if (mapsUrlValidada === null) {
      return responderError(
        'El enlace maps_url debe usar https y pertenecer a google.com, maps.app.goo.gl o goo.gl.'
      );
    }
    if (!limite || limite.getTime() <= Date.now()) {
      return responderError('La hora_limite es obligatoria y debe ser una fecha futura válida.');
    }

    const imagenBody = typeof req.body.imagen === 'string' ? req.body.imagen.trim() : '';
    const imagenSegura = /^(\/uploads\/|https:\/\/)/i.test(imagenBody) ? imagenBody : '';
    const imagenRuta = req.file ? `/uploads/${req.file.filename}` : imagenSegura;
    const nuevoLote = {
      nombre: nombreLimpio,
      descripcion: descripcionLimpia,
      categoria: categoriaLimpia,
      cantidad_total: totalNum,
      cantidad_disponible: totalNum,
      precio_descuento: precioNum,
      ...(tienePrecioOriginal ? { precio_original: precioOriginalNum } : {}),
      ubicacion: ubicacionLimpia,
      ...(mapsUrlValidada ? { maps_url: mapsUrlValidada } : {}),
      hora_limite: limite.toISOString(),
      imagen: imagenRuta,
      estado: 'activo',
      simulado: simulado === true || simulado === 'true'
    };

    const docRef = await db.collection('lotes').add(nuevoLote);
    invalidarCachesDemo();
    logLecturas('POST /api/lotes', 0);
    res.status(201).json({ id: docRef.id, ...nuevoLote });
  } catch (err) {
    limpiarArchivoSubido(req.file);
    next(err);
  }
});

app.delete('/api/lotes/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const loteRef = db.collection('lotes').doc(id);
    const loteSnap = await loteRef.get();
    if (!loteSnap.exists) {
      return res.status(404).json({ error: 'Lote no encontrado.' });
    }

    const reservasSnap = await db.collection('reservas').where('lote_id', '==', id).get();
    logLecturas('DELETE /api/lotes/:id', 1 + reservasSnap.size);
    const tieneBloqueantes = reservasSnap.docs.some((doc) => {
      const estado = doc.data().estado;
      return estado === 'reservada' || estado === 'recogida';
    });

    if (tieneBloqueantes) {
      return res.status(400).json({
        error: 'No se puede eliminar el lote porque tiene reservas en estado reservada o recogida.'
      });
    }

    const batch = db.batch();
    reservasSnap.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(loteRef);
    await batch.commit();
    invalidarCachesDemo();
    res.json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

app.get('/api/reservas', async (req, res, next) => {
  try {
    const cad = await actualizarCaducidad();
    const cliente = String(req.query.cliente || req.query.nombre_cliente || '').trim();
    const snap = cliente
      ? await db.collection('reservas').where('nombre_cliente', '==', cliente).get()
      : await db.collection('reservas').get();
    logLecturas('GET /api/reservas', cad.lecturas + snap.size);
    const reservas = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => String(b.creada_en || '').localeCompare(String(a.creada_en || '')));
    res.json(reservas);
  } catch (err) {
    next(err);
  }
});

app.post('/api/reservas', async (req, res, next) => {
  try {
    const cad = await actualizarCaducidad(true);
    const { lote_id, cantidad, nombre_cliente, simulado = false } = req.body;
    const cantidadNum = Number(cantidad);

    const nombreClienteLimpio = String(nombre_cliente || '').trim();
    if (!lote_id || !String(lote_id).trim()) {
      return res.status(400).json({ error: 'El campo lote_id es obligatorio.' });
    }
    if (!nombreClienteLimpio || nombreClienteLimpio.length > 100) {
      return res.status(400).json({ error: 'El nombre del cliente es obligatorio (máximo 100 caracteres).' });
    }
    if (!Number.isInteger(cantidadNum) || cantidadNum <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser un número entero mayor a 0.' });
    }

    const loteRef = db.collection('lotes').doc(String(lote_id).trim());
    const reservaRef = db.collection('reservas').doc();

    const resultado = await db.runTransaction(async (tx) => {
      const loteSnap = await tx.get(loteRef);
      if (!loteSnap.exists) {
        const err = new Error('El lote seleccionado no existe.');
        err.status = 404;
        throw err;
      }

      const lote = loteSnap.data();
      const limite = parseHoraLimite(lote.hora_limite);
      if (lote.estado !== 'activo' || (limite && limite.getTime() < Date.now())) {
        const err = new Error('El lote está vencido y no acepta reservas.');
        err.status = 400;
        throw err;
      }

      if (cantidadNum > Number(lote.cantidad_disponible)) {
        const err = new Error('No hay suficiente stock disponible para la cantidad solicitada.');
        err.status = 400;
        throw err;
      }

      const codigo = generarCodigoReserva();
      const nuevaReserva = {
        lote_id: loteRef.id,
        cantidad: cantidadNum,
        nombre_cliente: String(nombre_cliente).trim(),
        codigo,
        estado: 'reservada',
        creada_en: new Date().toISOString(),
        simulado: simulado === true || simulado === 'true'
      };

      tx.update(loteRef, {
        cantidad_disponible: Number(lote.cantidad_disponible) - cantidadNum
      });
      tx.set(reservaRef, nuevaReserva);
      return { id: reservaRef.id, ...nuevaReserva };
    });

    invalidarResumenCache();
    logLecturas('POST /api/reservas', cad.lecturas + 1);
    const qr = await QRCode.toDataURL(resultado.codigo);
    res.status(201).json({ ...resultado, qr });
  } catch (err) {
    next(err);
  }
});

app.post('/api/reservas/validar', async (req, res, next) => {
  try {
    const cad = await actualizarCaducidad(true);
    const codigo = String(req.body.codigo || '').trim().toUpperCase();
    if (!codigo) {
      return res.status(400).json({ error: 'Debes proporcionar el código de reserva.' });
    }

    const snap = await db.collection('reservas').where('codigo', '==', codigo).limit(1).get();
    if (snap.empty) {
      logLecturas('POST /api/reservas/validar', cad.lecturas + snap.size);
      return res.status(404).json({ error: 'Código de reserva no encontrado.' });
    }

    const reservaRef = snap.docs[0].ref;
    const actualizada = await db.runTransaction(async (tx) => {
      const docSnap = await tx.get(reservaRef);
      const data = docSnap.data();
      if (data.estado !== 'reservada') {
        const err = new Error(`No se puede validar una reserva en estado "${data.estado}".`);
        err.status = 400;
        throw err;
      }
      tx.update(reservaRef, { estado: 'recogida' });
      return { id: docSnap.id, ...data, estado: 'recogida' };
    });

    invalidarResumenCache();
    logLecturas('POST /api/reservas/validar', cad.lecturas + snap.size + 1);
    res.json(actualizada);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/reservas/:id', async (req, res, next) => {
  try {
    const cad = await actualizarCaducidad(true);
    const { id } = req.params;
    const { estado } = req.body || {};
    if (estado !== undefined && estado !== 'cancelada') {
      return res.status(400).json({ error: 'Solo se permite cancelar la reserva (estado: "cancelada").' });
    }

    const reservaRef = db.collection('reservas').doc(id);
    const resultado = await db.runTransaction(async (tx) => {
      const reservaSnap = await tx.get(reservaRef);
      if (!reservaSnap.exists) {
        const err = new Error('Reserva no encontrada.');
        err.status = 404;
        throw err;
      }

      const reserva = reservaSnap.data();
      if (reserva.estado !== 'reservada') {
        const err = new Error(`No se puede cancelar una reserva en estado "${reserva.estado}".`);
        err.status = 400;
        throw err;
      }

      const loteRef = db.collection('lotes').doc(reserva.lote_id);
      const loteSnap = await tx.get(loteRef);
      if (!loteSnap.exists) {
        const err = new Error('El lote asociado ya no existe.');
        err.status = 400;
        throw err;
      }

      const lote = loteSnap.data();
      const limite = parseHoraLimite(lote.hora_limite);
      if (lote.estado !== 'activo' || (limite && limite.getTime() < Date.now())) {
        const err = new Error('El lote ya venció; la reserva vencida no se puede cancelar.');
        err.status = 400;
        throw err;
      }

      const disp = Number(lote.cantidad_disponible || 0);
      const total = Number(lote.cantidad_total || disp + Number(reserva.cantidad));
      tx.update(reservaRef, { estado: 'cancelada' });
      tx.update(loteRef, {
        cantidad_disponible: Math.min(total, disp + Number(reserva.cantidad))
      });

      return { id: reservaSnap.id, ...reserva, estado: 'cancelada' };
    });

    invalidarCachesDemo();
    logLecturas('PATCH /api/reservas/:id', cad.lecturas + 2);
    res.json(resultado);
  } catch (err) {
    next(err);
  }
});

/**
 * Regla única de inventario por lote:
 * cantidad_total = disponible + reservada pendiente + recogida + vencida
 * (las reservas canceladas regresan al stock; no son un estado aparte).
 * Al vencer un lote, el stock disponible y las reservas pendientes pasan a vencido; lo recogido no cambia.
 */
function calcularTotalesLote(lote, reservas = []) {
  const publicado = Number(lote.cantidad_total || 0);
  const dispLote = Number(lote.cantidad_disponible || 0);

  let reservadaPendiente = 0;
  let recogido = 0;
  let vencidaRes = 0;

  for (const r of reservas) {
    const cant = Number(r.cantidad || 0);
    if (r.estado === 'reservada') reservadaPendiente += cant;
    else if (r.estado === 'recogida') recogido += cant;
    else if (r.estado === 'vencida') vencidaRes += cant;
  }

  if (lote.estado === 'vencido') {
    return {
      publicado,
      reservado: 0,
      recogido,
      vencido: dispLote + vencidaRes + reservadaPendiente,
      disponible: 0
    };
  }

  return {
    publicado,
    reservado: reservadaPendiente,
    recogido,
    vencido: vencidaRes,
    disponible: dispLote
  };
}

function calcularTotalesLotes(lotes, reservasPorLote) {
  let publicado = 0;
  let reservado = 0;
  let recogido = 0;
  let vencido = 0;
  let disponible = 0;

  for (const { id, lote } of lotes) {
    const t = calcularTotalesLote(lote, reservasPorLote.get(id) || []);
    publicado += t.publicado;
    reservado += t.reservado;
    recogido += t.recogido;
    vencido += t.vencido;
    disponible += t.disponible;
  }

  return { publicado, reservado, recogido, vencido, disponible };
}

app.get('/api/resumen', async (_req, res, next) => {
  try {
    const cad = await actualizarCaducidad();
    if (resumenCache && Date.now() - resumenCacheTs < RESUMEN_TTL_MS) {
      logLecturas('GET /api/resumen', cad.lecturas);
      return res.json(resumenCache);
    }

    const [lotesSnap, reservasSnap] = await Promise.all([
      db.collection('lotes').get(),
      db.collection('reservas').get()
    ]);
    logLecturas('GET /api/resumen', cad.lecturas + lotesSnap.size + reservasSnap.size);

    const reservasPorLote = new Map();
    for (const doc of reservasSnap.docs) {
      const r = doc.data();
      if (!reservasPorLote.has(r.lote_id)) reservasPorLote.set(r.lote_id, []);
      reservasPorLote.get(r.lote_id).push(r);
    }

    const lotes = lotesSnap.docs.map((doc) => ({ id: doc.id, lote: doc.data() }));
    const totales = calcularTotalesLotes(lotes, reservasPorLote);

    const resumen = {
      unidades_publicadas: totales.publicado,
      unidades_reservadas: totales.reservado,
      unidades_recogidas: totales.recogido,
      unidades_vencidas: totales.vencido,
      disponible: totales.disponible
    };
    resumenCache = resumen;
    resumenCacheTs = Date.now();
    res.json(resumen);
  } catch (err) {
    next(err);
  }
});

const DIAS_SEMANA_ORDEN = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MAPA_DIA_EN = {
  Mon: 'lunes',
  Tue: 'martes',
  Wed: 'miércoles',
  Thu: 'jueves',
  Fri: 'viernes',
  Sat: 'sábado',
  Sun: 'domingo'
};

const SYSTEM_INSTRUCTION_IA =
  'Redactas un reporte breve para el dueño o encargado de una cafetería. Español sencillo, tono cercano y respetuoso, sin tecnicismos. Máximo unas 250 palabras. Texto plano: sin markdown, sin asteriscos, sin tablas; títulos en una línea y guiones para listas. Usa EXCLUSIVAMENTE el JSON que recibes y copia los números tal cual; no calcules ni inventes cifras. Estructura, en este orden y con estos títulos:\n' +
  '1. Resumen del periodo: 2 a 3 líneas con las unidades publicadas como excedente, las recogidas (entregadas al validar el código de la reserva) y las vencidas sin entregarse.\n' +
  '2. Tasa de rescate: copia tasa_rescate y explica en una línea qué significa (qué parte de lo publicado se entregó).\n' +
  '3. Productos críticos: hasta 3 productos con más unidades vencidas o menor tasa de rescate, según por_producto.\n' +
  '4. Patrones por día: los días con más excedente o más vencidas, según por_dia_semana; si un día tiene pocos lotes, dilo.\n' +
  '5. Recomendaciones: 2 o 3 sugerencias concretas y accionables basadas en lo anterior, presentadas como ideas para probar, sin prometer resultados.\n' +
  'Reglas: el sistema solo registra excedentes publicados, no toda la producción: nunca calcules ni menciones porcentajes sobre la producción total, ventas totales ni ahorro en dinero. No afirmes que la plataforma ya redujo el desperdicio. Una reserva no es una entrega: solo cuenta lo recogido. Si pocos_datos es true, empieza con una advertencia honesta de que hay pocos registros y las tendencias pueden no ser confiables, y no supongas tendencias. Si datos_simulados es \'todos\' o \'parte\', empieza con el aviso \'Este reporte se basa en datos de prueba simulados\' (o \'en parte\'). No inventes horarios ni precios concretos en las recomendaciones. Si los datos no bastan para una conclusión, dilo.';

function obtenerDiaSemanaTZ(fecha, tz) {
  try {
    const corto = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(fecha);
    return MAPA_DIA_EN[corto] || 'lunes';
  } catch {
    const corto = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/Mexico_City' }).format(fecha);
    return MAPA_DIA_EN[corto] || 'lunes';
  }
}

function calcularTasaRescate(recogidas, publicadas) {
  if (!publicadas) return null;
  return Number(((recogidas / publicadas) * 100).toFixed(1));
}

function normalizarNombreProducto(nombre) {
  const limpio = String(nombre || 'sin nombre').trim().toLowerCase().replace(/\s+/g, ' ');
  return limpio || 'sin nombre';
}

async function calcularMetricasReporteIA() {
  const ahora = new Date();
  const hace30Dias = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ahoraIso = ahora.toISOString();
  const hace30DiasIso = hace30Dias.toISOString();
  const tz = (process.env.TZ || 'America/Mexico_City').trim() || 'America/Mexico_City';

  const [lotesPeriodoSnap, lotesActivosSnap] = await Promise.all([
    db.collection('lotes').where('hora_limite', '>=', hace30DiasIso).where('hora_limite', '<=', ahoraIso).get(),
    db.collection('lotes').where('estado', '==', 'activo').get()
  ]);

  let lecturas = lotesPeriodoSnap.size + lotesActivosSnap.size;

  const lotesCerrados = [];
  for (const doc of lotesPeriodoSnap.docs) {
    const lote = doc.data();
    const fecha = parseHoraLimite(lote.hora_limite);
    if (!fecha || fecha > ahora || fecha < hace30Dias) continue;
    lotesCerrados.push({ id: doc.id, lote, fecha });
  }

  const reservasPorLote = new Map();
  const loteIds = lotesCerrados.map((item) => item.id);
  for (let i = 0; i < loteIds.length; i += 30) {
    const bloque = loteIds.slice(i, i + 30);
    const resSnap = await db.collection('reservas').where('lote_id', 'in', bloque).get();
    lecturas += resSnap.size;
    for (const rDoc of resSnap.docs) {
      const r = rDoc.data();
      if (!reservasPorLote.has(r.lote_id)) reservasPorLote.set(r.lote_id, []);
      reservasPorLote.get(r.lote_id).push(r);
    }
  }

  const totales = calcularTotalesLotes(lotesCerrados, reservasPorLote);
  const publicadas = totales.publicado;
  const recogidas = totales.recogido;
  const vencidas = totales.vencido;
  let simuladosCount = 0;
  const mapaProductos = new Map();
  const mapaDias = new Map();
  for (const dia of DIAS_SEMANA_ORDEN) {
    mapaDias.set(dia, { dia, n_lotes: 0, publicadas: 0, recogidas: 0, vencidas: 0 });
  }

  for (const { id, lote, fecha } of lotesCerrados) {
    const tLote = calcularTotalesLote(lote, reservasPorLote.get(id) || []);
    if (lote.simulado === true) simuladosCount += 1;

    const prodKey = normalizarNombreProducto(lote.nombre);
    if (!mapaProductos.has(prodKey)) {
      mapaProductos.set(prodKey, { nombre: prodKey, lotes: 0, publicadas: 0, recogidas: 0, vencidas: 0, tasa_rescate: null });
    }
    const gProd = mapaProductos.get(prodKey);
    gProd.lotes += 1;
    gProd.publicadas += tLote.publicado;
    gProd.recogidas += tLote.recogido;
    gProd.vencidas += tLote.vencido;

    const diaKey = obtenerDiaSemanaTZ(fecha, tz);
    const gDia = mapaDias.get(diaKey);
    gDia.n_lotes += 1;
    gDia.publicadas += tLote.publicado;
    gDia.recogidas += tLote.recogido;
    gDia.vencidas += tLote.vencido;
  }

  const tasa_rescate = calcularTasaRescate(recogidas, publicadas);

  const por_producto = Array.from(mapaProductos.values())
    .map((p) => ({
      nombre: p.nombre,
      lotes: p.lotes,
      publicadas: p.publicadas,
      recogidas: p.recogidas,
      vencidas: p.vencidas,
      tasa_rescate: calcularTasaRescate(p.recogidas, p.publicadas)
    }))
    .sort((a, b) => b.vencidas - a.vencidas)
    .slice(0, 5);

  const por_dia_semana = DIAS_SEMANA_ORDEN.map((dia) => {
    const d = mapaDias.get(dia);
    return {
      dia: d.dia,
      n_lotes: d.n_lotes,
      publicadas: d.publicadas,
      recogidas: d.recogidas,
      vencidas: d.vencidas
    };
  });

  const dias_con_pocos_lotes = por_dia_semana.filter((d) => d.n_lotes < 3).map((d) => d.dia);
  const pocos_datos = lotesCerrados.length < 5;
  let datos_simulados = 'ninguno';
  if (lotesCerrados.length > 0) {
    if (simuladosCount === lotesCerrados.length) datos_simulados = 'todos';
    else if (simuladosCount > 0) datos_simulados = 'parte';
  }

  return {
    metricas: {
      periodo_dias: 30,
      lotes_cerrados: lotesCerrados.length,
      lotes_activos_excluidos: lotesActivosSnap.size,
      publicadas,
      recogidas,
      vencidas,
      tasa_rescate,
      por_producto,
      por_dia_semana,
      pocos_datos,
      dias_con_pocos_lotes,
      datos_simulados
    },
    lecturas
  };
}

function construirReporteSimulado(m) {
  const lineas = ['[REPORTE SIMULADO]'];
  if (m.datos_simulados === 'todos') {
    lineas.push('Este reporte se basa en datos de prueba simulados.');
  } else if (m.datos_simulados === 'parte') {
    lineas.push('Este reporte se basa en parte en datos de prueba simulados.');
  }
  if (m.pocos_datos) {
    lineas.push('Advertencia: hay pocos registros cerrados en el periodo, por lo que las tendencias pueden no ser confiables.');
  }

  lineas.push('');
  lineas.push('1. Resumen del periodo');
  lineas.push(
    `En los últimos 30 días se registraron ${m.lotes_cerrados} lotes cerrados con ${m.publicadas} unidades publicadas como excedente.`
  );
  lineas.push(
    `De ese total, ${m.recogidas} unidades fueron recogidas al validar el código de reserva y ${m.vencidas} quedaron vencidas sin entregarse.`
  );

  lineas.push('');
  lineas.push('2. Tasa de rescate');
  const tasaTexto = m.tasa_rescate === null ? 'sin datos (0 unidades publicadas)' : `${m.tasa_rescate}%`;
  lineas.push(
    `La tasa de rescate fue de ${tasaTexto}, lo que indica qué parte de lo publicado como excedente se entregó efectivamente.`
  );

  lineas.push('');
  lineas.push('3. Productos críticos');
  if (m.por_producto.length === 0) {
    lineas.push('- No hay suficientes datos de productos en el periodo.');
  } else {
    for (const p of m.por_producto.slice(0, 3)) {
      const pTasa = p.tasa_rescate === null ? 'N/A' : `${p.tasa_rescate}%`;
      lineas.push(`- ${p.nombre}: ${p.vencidas} vencidas de ${p.publicadas} publicadas (tasa de rescate: ${pTasa}).`);
    }
  }

  lineas.push('');
  lineas.push('4. Patrones por día');
  const diasOrdenados = [...m.por_dia_semana].sort((a, b) => b.vencidas - a.vencidas);
  const topDia = diasOrdenados[0];
  if (!topDia || m.lotes_cerrados === 0) {
    lineas.push('- No hay suficientes registros por día para identificar patrones.');
  } else {
    lineas.push(`- Día con más unidades vencidas: ${topDia.dia} (${topDia.vencidas} vencidas en ${topDia.n_lotes} lotes).`);
    if (m.dias_con_pocos_lotes.length > 0) {
      lineas.push(`- Días con pocos lotes (menos de 3): ${m.dias_con_pocos_lotes.join(', ')}.`);
    }
  }

  lineas.push('');
  lineas.push('5. Recomendaciones');
  lineas.push('- Probar publicar antes o en porciones más pequeñas los productos con más unidades vencidas.');
  lineas.push('- Revisar la cantidad preparada en los días con mayor excedente sin recoger.');

  return lineas.join('\n');
}

app.post('/api/reporte-ia', async (_req, res, next) => {
  try {
    const cad = await actualizarCaducidad();
    const { metricas, lecturas } = await calcularMetricasReporteIA();
    logLecturas('POST /api/reporte-ia', cad.lecturas + lecturas);

    const usarSimulado = process.env.GEMINI_MOCK === 'true' || !process.env.GEMINI_API_KEY;
    if (usarSimulado) {
      return res.json({
        reporte: construirReporteSimulado(metricas),
        metricas,
        modo: 'simulado'
      });
    }

    const modelo = (process.env.GEMINI_MODEL || '').trim();
    if (!modelo) {
      return res.status(400).json({ error: 'Falta configurar GEMINI_MODEL en backend/.env.' });
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const respuesta = await ai.models.generateContent({
        model: modelo,
        contents: JSON.stringify(metricas),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION_IA,
          temperature: 0.3
        }
      });
      return res.json({
        reporte: respuesta.text || '',
        metricas,
        modo: 'ia'
      });
    } catch (apiErr) {
      return res.status(502).json({
        error: `No se pudo generar el reporte con IA en este momento: ${apiErr.message || 'Error desconocido.'}`
      });
    }
  } catch (err) {
    next(err);
  }
});

if (DEMO_MODE) {
  app.post('/api/demo/vencer-lote/:id', async (req, res, next) => {
    try {
      const loteRef = db.collection('lotes').doc(req.params.id);
      const snap = await loteRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'Lote no encontrado.' });
      }
      if (snap.data().simulado !== true) {
        return res.status(403).json({ error: 'Solo se pueden vencer lotes simulados en modo demo.' });
      }
      const pasado = new Date(Date.now() - 60 * 1000).toISOString();
      await loteRef.update({ hora_limite: pasado });
      invalidarCachesDemo();
      const cad = await actualizarCaducidad(true);
      invalidarCachesDemo();
      logLecturas('POST /api/demo/vencer-lote/:id', 1 + cad.lecturas);
      res.json({ ok: true, id: req.params.id, estado: 'vencido' });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/demo/reiniciar', async (_req, res, next) => {
    try {
      const cargados = await cargarDatosSeed(db);
      invalidarCachesDemo();
      res.json({ ok: true, etiqueta: 'DATOS DE PRUEBA SIMULADOS', cargados });
    } catch (err) {
      next(err);
    }
  });
}

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'La imagen excede el tamaño máximo de 5 MB.' });
    }
    return res.status(400).json({ error: `Error al subir archivo: ${err.message}` });
  }
  const status = err.status || (err.message?.includes('Formato de imagen') ? 400 : 500);
  if (status >= 500) {
    console.error('Error interno del servidor:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
  res.status(status).json({ error: err.message || 'Error en la solicitud.' });
});

const server = app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  actualizarCaducidad(true)
    .then((cad) => logLecturas('Arranque actualizarCaducidad', cad.lecturas))
    .catch((err) => console.error('Error al revisar caducidad inicial:', err.message));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`El puerto ${PORT} ya está ocupado. Cierra la otra instancia o cambia PORT en backend/.env.`);
    process.exit(1);
  }
  console.error('Error al iniciar el servidor:', err.message);
  process.exit(1);
});
