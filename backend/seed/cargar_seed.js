const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function borrarSimuladosColeccion(db, coleccion) {
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

async function escribirColeccion(db, coleccion, items) {
  let insertados = 0;
  for (let i = 0; i < items.length; i += 400) {
    const batch = db.batch();
    const trozo = items.slice(i, i + 400);
    for (const item of trozo) {
      const { id, ...datos } = item;
      const ref = id ? db.collection(coleccion).doc(id) : db.collection(coleccion).doc();
      batch.set(ref, { ...datos, simulado: true });
    }
    await batch.commit();
    insertados += trozo.length;
  }
  return insertados;
}

function fechaRelativa(ahoraMs, offsetDias = 0, offsetHoras = 0) {
  const ms = ahoraMs + (Number(offsetDias) * 24 + Number(offsetHoras)) * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

function resolverCafeteria(caf, ahoraMs) {
  const { suscripcion, ...resto } = caf;
  if (!suscripcion) return { ...resto };
  const { inicio_dias, fin_dias, ...subResto } = suscripcion;
  return {
    ...resto,
    suscripcion: {
      ...subResto,
      inicio: inicio_dias !== undefined ? fechaRelativa(ahoraMs, inicio_dias, 0) : subResto.inicio,
      fin: fin_dias !== undefined ? fechaRelativa(ahoraMs, fin_dias, 0) : subResto.fin
    }
  };
}

function resolverLote(lote, ahoraMs) {
  const { offset_dias, offset_horas, ...resto } = lote;
  const horaLimite =
    offset_dias !== undefined || offset_horas !== undefined
      ? fechaRelativa(ahoraMs, offset_dias || 0, offset_horas || 0)
      : resto.hora_limite;
  return { ...resto, hora_limite: horaLimite };
}

function resolverReserva(reserva, ahoraMs) {
  const { offset_dias, offset_horas, ...resto } = reserva;
  const creadaEn =
    offset_dias !== undefined || offset_horas !== undefined
      ? fechaRelativa(ahoraMs, offset_dias || 0, offset_horas || 0)
      : resto.creada_en;
  return { ...resto, creada_en: creadaEn };
}

async function cargarDatosSeed(db) {
  const rutaJson = path.join(__dirname, 'datos_prueba.json');
  const contenido = JSON.parse(fs.readFileSync(rutaJson, 'utf8'));
  const ahoraMs = Date.now();

  const cafeteriasRes = (contenido.cafeterias || []).map((c) => resolverCafeteria(c, ahoraMs));
  const lotesRes = (contenido.lotes || []).map((l) => resolverLote(l, ahoraMs));
  const reservasRes = (contenido.reservas || []).map((r) => resolverReserva(r, ahoraMs));

  await Promise.all([
    borrarSimuladosColeccion(db, 'cafeterias'),
    borrarSimuladosColeccion(db, 'lotes'),
    borrarSimuladosColeccion(db, 'reservas')
  ]);

  const [cafeterias, lotes, reservas] = await Promise.all([
    escribirColeccion(db, 'cafeterias', cafeteriasRes),
    escribirColeccion(db, 'lotes', lotesRes),
    escribirColeccion(db, 'reservas', reservasRes)
  ]);

  return { cafeterias, lotes, reservas };
}

if (require.main === module) {
  const serviceAccountPath = path.resolve(
    __dirname,
    '..',
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json'
  );
  if (!fs.existsSync(serviceAccountPath)) {
    console.error('Falta el archivo de credenciales de Firebase en:', serviceAccountPath);
    process.exit(1);
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(require(serviceAccountPath))
    });
  }
  const db = admin.firestore();
  cargarDatosSeed(db)
    .then((res) => {
      console.log('Seed cargado (DATOS DE PRUEBA SIMULADOS):', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Error al cargar seed:', err);
      process.exit(1);
    });
}

module.exports = { cargarDatosSeed, borrarSimuladosColeccion };
