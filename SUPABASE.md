# Supabase: etapa 1 (autenticación)

La recepción de tareas mediante Postgres Changes se describe en
`SUPABASE-REALTIME.md`; las exclusiones siguientes corresponden al alcance
histórico de la primera etapa.

La etapa posterior de sincronización manual está implementada y documentada
en `SUPABASE-SYNC.md`. Las exclusiones de tareas descritas aquí corresponden
únicamente al alcance original de autenticación.

La URL del proyecto y su Publishable Key pública están en
`src/environments/supabase.config.ts`. Ambos environments de Angular importan
esta configuración; producción continúa usando el reemplazo de `angular.json`.
Estos valores son públicos. Nunca introducir service_role, sb_secret,
contraseñas PostgreSQL ni cadenas administrativas.

El cliente es único y se crea bajo demanda. La sesión local y el verificador
PBKDF2 permanecen en las claves actuales de Preferences. Los tokens de Supabase
son solo de memoria en esta etapa (sin auto-refresh ni lectura de redirects).
Reiniciar restaura inmediatamente el acceso local sin llamadas a internet.
El siguiente login de una cuenta vinculada autentica de nuevo contra Supabase.

Registro requiere conexión y una sesión remota válida. Guarda un ID local
independiente y `remoteUserId` con el UUID remoto. Los usuarios anteriores sin
ese campo mantienen su autenticación local; no hay vinculación automática.

Solo los errores de transporte/timeout permiten login offline, verificando
siempre el hash local. Credenciales rechazadas, errores HTTP y errores de
configuración no activan ese fallback. Un login remoto válido actualiza el
verificador offline, incluso después de cambiar la contraseña remotamente.

Logout elimina la sesión local y solicita cierre remoto del dispositivo
actual; descarta los tokens de memoria también cuando no hay conexión.
No borra usuarios, tareas, fotografías ni otros datos. Sin conexión no puede
garantizarse la revocación en el servidor de tokens ya emitidos.

Panel esperado: Email/Password activo, Confirm email desactivado para la
evaluación, anonymous sign-ins desactivado. Esta etapa no consulta `tasks`,
no modifica SQL/RLS y no utiliza Storage, Realtime ni sincronización.

Validación local:

```text
node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit
node_modules\.bin\tsc.cmd -p tsconfig.spec.json --noEmit
npm.cmd run lint
npm.cmd test -- --watch=false
npm.cmd run build -- --configuration production
```

Los tests automáticos usan dobles o fetch interceptado, sin crear cuentas reales.
La investigación posterior en Chrome está documentada en
`SUPABASE-VALIDACION.md`: se reprodujo un HTTP 401 con la clave inicial,
se corrigió con la nueva clave proporcionada por Rosa y se verificaron
registro, consulta del usuario, logout y login contra Supabase real.
La interfaz ahora notifica a Angular al terminar las operaciones asíncronas,
captura errores inesperados y permite mostrar/ocultar cada contraseña.
La operación completa de Auth tiene un máximo de 12 segundos, además del
límite de 8 segundos por fetch. Un resultado tardío no confirma el registro
local ni modifica el usuario expuesto por SupabaseAuthService.
Prueba manual: registrar una cuenta de evaluación, comprobar su UUID en Auth
y en Preferences, cerrar sesión, entrar con red, cortar red y volver a entrar
con la contraseña correcta; una contraseña incorrecta debe fallar también
offline. Una cuenta antigua debe entrar sin llamadas a Supabase.
