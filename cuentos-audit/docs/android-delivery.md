# Cuentos Mágicos — estrategia Android

## Estado confirmado

- La aplicación actual usa Next.js App Router.
- Utiliza rutas de servidor, cookies de sesión, Supabase, OpenAI y webhooks de Recurrente.
- No existe una carpeta android, proyecto Gradle ni configuración de Capacitor.
- NEXT_PUBLIC_APP_URL en .env.example todavía es un dominio de ejemplo.

## Decisión técnica

No activar la exportación estática de Next.js: no admite las rutas API ni los encabezados que usa el proyecto.

Tampoco distribuir una build de Capacitor que use server.url como origen remoto. Capacitor reserva esa opción para live reload/desarrollo, no para producción.

La ruta de menor riesgo para obtener un APK instalable sin reescribir el backend es preparar la web como PWA y empaquetarla como Trusted Web Activity (TWA). El backend Next.js permanece en HTTPS y la aplicación Android abre el origen verificado con la experiencia de Chrome. Las funciones dinámicas requieren conexión a Internet.

## Requisitos para compilar

1. URL HTTPS de producción definitiva para Cuentos Mágicos.
2. Manifest PWA con nombre, iconos 192/512, start_url, scope y display.
3. Archivo /.well-known/assetlinks.json con el SHA-256 del certificado Android que firmará el APK.
4. Identificador Android definitivo y nombre comercial final.
5. Compilación de release con Android SDK/Bubblewrap, instalación en dispositivo real y validación de login, cookies, generación, almacenamiento y enlaces externos.
6. Custodiar el keystore y su contraseña fuera de GitHub.

## Alcance de la primera APK

- Instalación manual en Android mediante APK firmado.
- Backend y datos alojados en HTTPS.
- Autenticación del adulto y generación online.
- No se promete funcionamiento offline para generar cuentos, imágenes o sincronizar progreso.
- La versión web permanece disponible y comparte cuentas/datos con Android.

Una versión Android con interfaz completamente nativa o assets web totalmente locales será una segunda fase: requeriría separar/refactorizar la capa móvil del servidor Next.js.
