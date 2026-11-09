# Diagnóstico real del registro — 9 de noviembre de 2026

> Datos personales anonimizados: los correos e identificadores son ejemplos ficticios.

Prueba en Google Chrome instalado, modo headless y perfil aislado, contra
`http://127.0.0.1:8100/register` servido por `ng serve` en desarrollo.
Se activó el botón de RegisterPage y se observó la petición real del SDK;
no se utilizaron claves administrativas ni se modificaron RLS o tablas.

## Evidencia inicial

- POST real a `https://nenpucbbwkfcuqhdbkil.supabase.co/auth/v1/signup`.
- Respuesta HTTP 401, `Invalid API key`.
- Comprobación independiente con GET público `/auth/v1/settings`: mismo 401.
- RegisterPage ya tenía `isSubmitting: false` y `message: 'Invalid API key'`.
- Sin embargo, el DOM conservaba `Creando cuenta...` y no mostraba el error.
- Ningún usuario local guardado.

Esto distingue dos problemas: la clave configurada es rechazada por el servidor,
y los cambios de campos tras await no notificaban a Angular sin Zone.js.
No se observó una Promise infinita en este intento real.

## Corrección y comprobaciones en Chrome

- Tras notificar con `ChangeDetectorRef.markForCheck()`, el mismo 401 muestra:
  `Supabase rechazó la clave pública (HTTP 401). Revisa Project URL y Publishable Key.`
- El botón vuelve a `Crear cuenta`, con `isSubmitting: false`.
- El límite de 12 segundos abarca la Promise completa del SDK, además del
  timeout de 8 segundos de transporte ya existente.
- Se interceptó solo para otra prueba el fetch de signup con una Promise que
  nunca resuelve: al terminar el límite, se muestra el mensaje de timeout,
  se libera el botón y no se guarda usuario local.
- Ambos ojos de Registro cambian a text, actualizan aria-label y mantienen
  los valores escritos en los inputs nativos de Ionic.
- El ojo de Login también se verificó en Chrome: alterna password/text,
  conserva el valor y actualiza su nombre accesible. El botón de login vuelve
  a su estado normal ante un resultado fallido.

## Verificación automática final

- TypeScript aplicación y tests con `--noEmit`: aprobado.
- Lint: aprobado.
- Suite completa: 110/110 (99 anteriores y 11 nuevas).
- Build de producción: aprobado. Conserva avisos de Browserslist y de
  presupuesto CSS en Home y Tareas, ajenos a este cambio.

## Configuración

Desarrollo importa `environment.ts`; producción reemplaza ese archivo por
`environment.prod.ts`. Ambos usan `supabase.config.ts`, de modo que la URL
y la clave comprobadas son las mismas. No se cambió la clave por conjeturas.

## Registro real exitoso con la clave corregida

La responsable del proyecto proporcion?ó la Publishable Key correcta: la anterior contenía una `I`
adicional. Se actualizó únicamente ese valor en `supabase.config.ts`.

Prueba en Chrome contra el proyecto real, usando los inputs nativos y el botón
de Registro de TareaFácil (sin interceptar fetch):

- Nombre: Usuario de ejemplo.
- Correo: `usuario1@ejemplo.com`.
- POST `/auth/v1/signup`: HTTP 200.
- Mensaje: `Cuenta creada correctamente.`; `isSubmitting: false`.
- Navegación automática a `/summary`.
- UUID remoto: `UUID_USUARIO_1`.
- ID local distinto: `UUID_LOCAL_USUARIO_1`.
- `remoteUserId` coincide con el UUID remoto y quedó persistido en Preferences.
- Consulta real `supabase.auth.getUser()` a `/auth/v1/user`: HTTP 200,
  mismo UUID/correo y correo confirmado.
- Logout del cliente: HTTP 204.
- Login desde el formulario de la aplicación: HTTP 200, mismo UUID y retorno
  a `/summary`, sin dejar el botón bloqueado.

La contraseña aleatoria solo se usó en la memoria del navegador de prueba.
No se guardó en documentación ni se utilizaron credenciales administrativas.
No se accedió al panel autenticado de Supabase: la existencia remota se
verificó con el endpoint de usuario autenticado. La responsable del proyecto puede localizar la
cuenta anterior en Authentication → Users por correo o UUID.
