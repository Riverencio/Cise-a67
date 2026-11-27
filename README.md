# Rescate Café — Plataforma contra el desperdicio de alimentos

Plataforma web (MVP) enfocada en cafeterías locales para publicar y reservar excedentes de alimentos bajo un modelo *pick-up* (recolección en tienda, sin pagos en línea).

## Stack tecnológico

- **Backend:** Node.js + Express (JavaScript)
- **Base de datos:** Firebase Firestore (`firebase-admin`)
- **Frontend:** HTML, CSS y JavaScript plano

Se eligió JavaScript en todo el proyecto (backend y frontend) para mantener un solo lenguaje de programación, simplificar la curva de desarrollo y facilitar el mantenimiento del MVP.

---

## Requisitos previos

- **Node.js** (versión LTS recomendada)
- **Cuenta de Firebase** con un proyecto y **Firestore** habilitado
- *(Opcional, solo para modo real)* **Clave de API de Google AI Studio (Gemini)** para redactar reportes sin usar el modo simulado

---

## Instalación y configuración (sin secretos)

### 1. Instalar dependencias

Desde la carpeta `backend`:

```bash
cd backend
npm install
```

### 2. Obtener la clave de cuenta de servicio de Firebase

1. Abre tu proyecto en la consola de Firebase.
2. Ve a **Configuración del proyecto** → **Cuentas de servicio**.
3. Haz clic en **Generar nueva clave privada** y descarga el archivo JSON.
4. Guarda ese archivo dentro de la carpeta `backend/` (por ejemplo, `backend/serviceAccountKey.json`). Este archivo está protegido por `.gitignore` y nunca debe subirse al repositorio.

### 3. Configurar variables de entorno

Copia `backend/.env.example` a `backend/.env` y ajusta los valores según tu entorno:

```bash
cp backend/.env.example backend/.env
```

Variables disponibles en `backend/.env`:

| Variable | Descripción | Valor por defecto en `.env.example` |
| --- | --- | --- |
| `PORT` | Puerto HTTP donde escucha el servidor Express | `3000` |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Ruta relativa al archivo JSON de la cuenta de servicio de Firebase | `./serviceAccountKey.json` |
| `DEMO_MODE` | Habilita botones y endpoints de demostración (`/api/demo/*`) | `true` |
| `GEMINI_MOCK` | Si es `true`, genera el reporte IA con plantilla simulada sin llamar a la API de Gemini | `true` |
| `GEMINI_API_KEY` | Clave de Google AI Studio (requerida solo si `GEMINI_MOCK=false`) | *(vacío)* |
| `GEMINI_MODEL` | Identificador del modelo Gemini a utilizar cuando `GEMINI_MOCK=false` | *(vacío)* |
| `TZ` | Zona horaria usada para calcular días de la semana y métricas en el backend | `America/Mexico_City` |

---

## Ejecución y comandos

Todos los comandos se ejecutan desde la carpeta `backend/`:

1. **Cargar datos de prueba iniciales (seed):**
   ```bash
   npm run seed
   ```
2. **Arrancar el servidor (backend + frontend estático) con un solo comando:**
   ```bash
   npm start
   ```
3. **Abrir las interfaces locales en el navegador:**
   - Vista de cafetería: `http://localhost:3000/cafeteria.html`
   - Vista de cliente: `http://localhost:3000/cliente.html`
4. **Ejecutar las pruebas automáticas (20 casos):**
   ```bash
   npm run test:flujo
   ```

---

## Flujo principal de demostración

1. **Publicar excedente (`cafeteria.html`):** La cafetería registra un lote con nombre, categoría, cantidad, precio original, precio con descuento, hora límite de recolección, imagen opcional y enlace/ubicación en mapa.
2. **Explorar catálogo (`cliente.html`):** El cliente visualiza los lotes activos, filtra por categoría o precio máximo y consulta el descuento calculado y la ubicación.
3. **Reservar (`cliente.html`):** El cliente ingresa su nombre y cantidad; el backend descuenta el stock mediante transacción en Firestore y genera un código único `RES-XXXXXX` junto con su código QR.
4. **Validar entrega (`cafeteria.html`):** Al llegar el cliente a la tienda y pagar en caja, la cafetería ingresa el código `RES-XXXXXX` para marcar la reserva como recogida.
5. **Revisar resumen y reporte con IA (`cafeteria.html`):** La cafetería consulta las métricas del resumen (disponible, reservado, recogido y vencido) y genera un reporte con recomendaciones basado en las cifras calculadas en el backend.

---

## Qué es real y qué es simulado

- **Real:**
  - Persistencia y lectura en **Firebase Firestore**.
  - **Transacciones de stock** al reservar, validar o cancelar para evitar sobreventa.
  - **Caducidad automática** de lotes según su hora límite.
  - **Generación de códigos QR** (`qrcode`) y **subida local de imágenes** (`multer`).
  - **Cálculo de métricas y agregados** en el backend (`/api/resumen` y `/api/reporte-ia`), así como la redacción mediante la API de Gemini cuando `GEMINI_MOCK=false`.
- **Simulado:**
  - Datos iniciales cargados por el *seed*, etiquetados explícitamente como `"DATOS DE PRUEBA SIMULADOS"`.
  - Redacción del reporte IA cuando `GEMINI_MOCK=true` (usa una plantilla fija con las métricas reales calculadas).
  - Suscripción mensual y aviso de prueba gratuita de 30 días mostrados en la interfaz de cafetería.

---

## Limitaciones declaradas (decisiones de alcance del MVP)

- **Sin cuentas ni autenticación:** La interfaz de cafetería está abierta y representa a una sola cafetería de demostración. Es un riesgo conocido de acceso abierto asumido de forma intencional en el MVP para validar primero el flujo operativo de excedentes.
- **Suscripción mensual y prueba gratuita simuladas:** No existe pasarela de cobro ni verificación de suscripción en el backend.
- **Sin pagos en línea:** Todas las reservas se pagan de forma presencial en caja al recoger el pedido.
- **Almacenamiento local de imágenes:** Las fotografías de los lotes se guardan en `backend/uploads/` en lugar de un servicio de almacenamiento en la nube.
- **Vista previa de mapa sin clave:** Se muestra una vista previa de Google Maps sin API key y se ofrece un botón **"Abrir en Google Maps"** como respaldo.

---

## Próximos pasos

- Implementar autenticación de cafeterías con **Firebase Authentication** y aislar los datos por negocio.
- Integrar el cobro real de la suscripción mensual.
- Agregar sugerencias y ordenamiento de cafeterías por distancia geográfica.
- Sustituir los datos iniciales del *seed* por registros reales de cafeterías participantes.
