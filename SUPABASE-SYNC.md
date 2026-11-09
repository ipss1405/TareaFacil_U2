# Sincronización manual de tareas

> Datos personales anonimizados: los correos e identificadores son ejemplos ficticios.

La etapa posterior de recepción mediante Realtime está documentada en
`SUPABASE-REALTIME.md`. El botón sigue siendo el único disparador de envío
de pendientes; Realtime añade únicamente recepción de cambios remotos.

Preferences mantiene la vista inmediata y el funcionamiento offline.
El botón **Sincronizar** de `/summary` es el único disparador de sincronización.
No hay Realtime, listeners de conectividad, Storage ni subida de fotografías.
No se modificaron tablas, triggers ni políticas RLS del proyecto remoto.

## Flujo local y migración

Crear, editar, completar e importar guardan el registro con `pending`, UUID
remoto estable, fecha de modificación y revisión local. Las escrituras locales
siguen serializadas. Eliminar crea un tombstone; las vistas y contadores lo
excluyen y su fotografía permanece intacta.

Al pulsar Sincronizar se espera la carga local, se conserva un respaldo en
`tareafacil_tasks_before_sync_v1` y se completan los metadatos ausentes de las
tareas del usuario activo. La operación es idempotente: conserva IDs locales,
UUIDs ya asignados, propietario, fechas, GPS, fotografías y procedencia externa.
Una tarea antigua sin createdAt recibe una fecha de migración porque su fecha
original no se puede reconstruir. No se migran ni envían las tareas de otros
usuarios locales. El identificador del dispositivo se guarda en
`tareafacil_sync_device_id`.

Antes del primer envío se exige que el estado completo quede persistido. Un
fallo local interrumpe el envío. No se eliminan las claves de datos existentes.

## Protocolo remoto

- INSERT con UUID estable y propietario obtenido de la identidad Supabase
  comprobada. No se usa el ID numérico como identidad remota.
- UPDATE filtrado por owner_id, UUID y revisión remota conocida. El trigger
  remoto mantiene revision y updated_at; el cliente no los incrementa.
- Eliminar usa UPDATE de deleted_at, nunca DELETE físico desde el sincronizador.
- Una respuesta perdida puede reintentarse: un UUID duplicado se reconcilia,
  y un UPDATE ya aplicado se reconoce comparando el contenido.
- Las importadas mantienen external_source/external_id. Si otro dispositivo
  importó la misma tarea, se adopta la fila remota sin duplicar el registro local.
- Descarga completa paginada de 500 filas, incluidas eliminaciones lógicas,
  filtrada por el propietario y combinada por UUID. Conserva las fotografías
  locales. Asigna un ID local libre a una tarea descargada nueva.
- Una edición producida durante el envío permanece pendiente para otro clic.
  Su revisión base solo avanza cuando hay confirmación de la escritura enviada.
- Una sola sincronización en curso. Se deshabilitan reintentos internos del
  SDK para estas consultas; el usuario reintenta con el botón. Cada petición
  tiene cancelación de transporte y un máximo total de 12 segundos.

## Conflictos y sesiones

Si una revisión conocida ya cambió en el servidor, prevalece la versión remota.
Antes de aplicarla se guarda una copia local en
`tareafacil_sync_conflicts_<localId>_<remoteIdUsuario>`. El aviso aparece en el
dashboard. Si no se puede guardar esa copia, se conserva el pendiente y se
informa del error. Una nueva edición local durante la petición no se sobrescribe.

La última sincronización se guarda por identidad local y remota en
`tareafacil_sync_<localId>_<remoteIdUsuario>`.

Se comprueban las referencias de las sesiones local y remota antes y después
de cada paso asíncrono. Cerrar sesión, cambiar cuenta o iniciar una nueva sesión
invalida la operación anterior, aunque el UUID de la cuenta sea el mismo.
RemoteTaskService valida además que las filas devueltas sean del propietario.
RLS sigue siendo la barrera definitiva del servidor.

Los tokens Auth siguen en memoria, como en la etapa anterior. Después de
recargar se restaura la sesión local inmediatamente; para sincronizar hace
falta volver a iniciar sesión remotamente. Las cuentas antiguas sin
remoteUserId conservan su acceso local y no se vinculan automáticamente.

## Evidencia real: Chrome y Supabase, 9 de noviembre de 2026

Pruebas en Chrome con perfil aislado, aplicación servida en localhost:8100,
Publishable Key y sesiones normales de usuario. Sin claves administrativas.

| Prueba | Resultado |
| --- | --- |
| Crear desde el formulario y pulsar Sincronizar | INSERT confirmado; synced y revisión 1 |
| Editar y completar localmente | UPDATE confirmado; completed=true y revisión 2 |
| Cambio remoto concurrente sobre la misma tarea | Revisión 3; conflicto detectado, remoto prevalece y copia local guardada |
| Eliminar y sincronizar | Tombstone local oculto; deleted_at remoto confirmado, revisión 4 |
| Importar JSONPlaceholder todo 1 | Sincronizado con external_source=jsonplaceholder y external_id=1 |
| B consulta la tarea de A | HTTP 200, cero filas |
| B intenta modificar o borrar la tarea de A | HTTP 200, cero filas afectadas |
| B intenta INSERT con owner_id de A | HTTP 403, PostgreSQL 42501, rechazo por RLS |
| A consulta la tarea de B | HTTP 200, cero filas |
| Sincronizar A después de B | Datos locales de B intactos; tarea remota de A no fue alterada por B |
| Chrome con red desactivada | CRUD local operativo; Sin conexión y pendientes persistidos |
| Reintentar al volver la red | Pendientes enviados y synced, incluidos tombstones creados offline |
| Descargar una tarea creada como otro dispositivo | Descarga correcta y sin colisión del ID local |
| Recargar | Misma colección local, UUIDs, tombstones y última sincronización; pide sesión remota |

Cuentas principales de comprobación:

- A: `usuario1@ejemplo.com`, UUID
  `UUID_USUARIO_1`.
- B: `usuario2@ejemplo.com`, UUID
  `UUID_USUARIO_2`.

Filas para localizar en Table Editor → tasks:

- A, tombstone: `UUID_TAREA_1`.
- B, tarea propia: `UUID_TAREA_2`.
- B, importación: `UUID_TAREA_3`.
- B, editada/completada offline: `UUID_TAREA_4`.
- B, eliminada offline: `UUID_TAREA_5`.

La evidencia remota se obtuvo leyendo y modificando la tabla mediante el SDK
autenticado del cliente. No se abrió el panel administrativo de Supabase.

## Validación final

- TypeScript aplicación y tests, ambos con `--noEmit`: aprobado.
- Lint: aprobado.
- Suite completa: 138/138 (110 anteriores y 28 nuevas), 19 archivos de tests.
- Build de producción: aprobado. Avisos de Browserslist y presupuestos CSS:
  Home 8,63 kB y Tareas 9,97 kB frente al umbral de advertencia de 8 kB.
- Comprobación final en Chrome: Sincronizado, cero pendientes y última
  sincronización visible. Las contraseñas aleatorias de las cuentas de prueba
  se retiraron del almacenamiento de diagnóstico del navegador.
