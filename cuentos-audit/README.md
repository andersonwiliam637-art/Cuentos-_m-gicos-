# Cuentos Mágicos AI v2

Aplicación educativa creativa infantil para cuentas administradas por adultos responsables.

## Estado de este paquete

Incluye correcciones de seguridad estática, RPCs con permisos reforzados, rate limiting para generación de cuentos y actividades, health check corregido y checkout/webhook de Recurrente. **No debe considerarse producción verificada hasta completar los pasos de despliegue y las pruebas de sandbox descritas abajo.**

## Requisitos

- Node.js 20.11 o posterior.
- Proyecto Supabase dedicado a staging y otro para producción.
- Cuenta Recurrente verificada, dos productos recurrentes configurados (Family y Premium), llave de API y signing secret de webhook.
- API key de OpenAI y límites de gasto configurados.
- URL HTTPS pública.

## Instalación

```bash
npm install
cp .env.example .env.local
npm run typecheck
npm run lint
npm run build
```

Configura `.env.local` con valores reales; nunca commits secretos.

## Supabase

Proyecto Supabase identificado por el usuario: `uoiugltuadzfntzscihh` (`https://uoiugltuadzfntzscihh.supabase.co`). La URL no concede acceso administrativo y no confirma el estado de la base. Antes de migrar, ejecuta `supabase/PRODUCTION_PREFLIGHT.sql` en SQL Editor y revisa las tablas, RLS, políticas y RPCs. No ejecutes migraciones a ciegas sobre una base con datos.

1. En un proyecto de **staging**, aplicar en orden `supabase/migrations/001_initial_schema.sql` a `007_production_hardening_recurrente.sql`.
2. Ejecutar pruebas de aislamiento entre dos usuarios y pruebas de cuota/rate limit.
3. Verificar políticas RLS en tablas de cuentos, personajes, actividades, ilustraciones, perfiles y billing.
4. Aplicar la misma secuencia a producción únicamente después de validar staging y hacer backup.

## Recurrente

Configura `PAYMENT_PROVIDER=recurrente`, `RECURRENTE_SECRET_KEY`, `RECURRENTE_WEBHOOK_SECRET`, `RECURRENTE_FAMILY_PRODUCT_ID`, `RECURRENTE_PREMIUM_PRODUCT_ID` y `NEXT_PUBLIC_APP_URL`.

Registra en Recurrente el webhook `https://TU-DOMINIO/api/recurrente/webhook` y guarda su signing secret como `RECURRENTE_WEBHOOK_SECRET`. Primero usar Sandbox. Confirma los payloads de checkout y de suscripción en la cuenta real antes de habilitar cobros live.

El endpoint de portal de facturación devuelve 501 deliberadamente: no debe aparentar que existe un portal de cliente que aún no está integrado. La activación inicial de plan depende de un webhook `intent.succeeded` correlacionado al checkout persistido. La renovación/cancelación de suscripciones debe verificarse con los eventos concretos de la cuenta antes de comercializar planes recurrentes.

## Pruebas de aceptación antes de producción

- `npm install`, `npm run typecheck`, `npm run lint`, `npm run build` sin errores.
- Login, cierre, renovación y expiración de sesión.
- Dos usuarios no pueden leer, editar ni borrar datos ajenos.
- Cuotas concurrentes de cuentos y rate limit fallan de forma segura.
- Moderación y casos adversariales para entrada y salida de IA.
- Recurrente Sandbox: checkout exitoso, cancelado, fallido, webhook con firma inválida, duplicado y retrasado.
- Confirmar que el plan nunca se activa por la URL de retorno del navegador, solo por webhook firmado.
- Verificar backups, logs sin contenido infantil/secretos, alertas, política de privacidad y términos.

## Seguridad infantil

La moderación basada en patrones es solo una defensa básica, no una garantía de seguridad. Antes de abrir a menores, completar evaluación adversarial, revisar privacidad y retención de datos, y obtener revisión legal aplicable.
