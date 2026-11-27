ROL: Desarrollador full-stack. Proyecto: MVP web contra el desperdicio de alimentos para cafeterías (modelo pick-up, sin pagos en línea). Prioridad absoluta: que FUNCIONE. El diseño NO importa.

REGLAS
- Stack: Node.js + Express (solo JavaScript) en /backend; Firebase (Firestore) con firebase-admin; front-end existente en HTML/CSS/JS plano en /frontend.
- Mi front-end y mi base de datos existentes son la fuente de verdad: léelos antes de proponer nada. No inventes colecciones ni campos sin avisarme. Si falta información crítica, pregúntame.
- Mi front-end actual usa el SDK web de Firestore directamente (cafeteria.js y cliente.js, proyecto "datos-anuncios"). Migra esas llamadas al backend; no borres los datos que ya existan en Firestore.
- No rediseñes ni modifiques CSS. En el front-end solo agrega fetch() y los id/elementos mínimos que falten.
- AHORRA CUOTA: lee solo los archivos necesarios; no explores todo el repo; edita fragmentos, no reescribas archivos completos; no generes documentos ni archivos no pedidos; no repitas código en tus respuestas; al terminar cada fase responde en máximo 10 líneas.
- No uses git ni hagas commits. Deja los cambios listos y registra cada uno en CAMBIOS.md (una línea: archivo, qué cambió, por qué).
- NUNCA llames a la API real de Gemini durante el desarrollo; usa el modo simulado.
- Secretos solo en backend/.env (ignorado por git): GEMINI_API_KEY y la ruta de la clave de Firebase. El archivo JSON de la cuenta de servicio vive en backend/ y está en .gitignore; nunca lo abras, imprimas ni copies. Ningún secreto va en el front-end ni en el código. Mantén .gitignore y .env.example actualizados.
- Todo dato simulado debe estar etiquetado como "DATOS DE PRUEBA SIMULADOS" (en el JSON y en la interfaz).