# Tareas mediante Supabase Realtime / Postgres Changes

> Datos personales anonimizados: los correos e identificadores son ejemplos ficticios.

## Funcionamiento

`TaskRealtimeService` se inicia desde AppComponent y permanece activo al
navegar entre dashboard, agenda y formulario. Reutiliza exclusivamente el
cliente de `SupabaseClientService`; no crea otro cliente ni añade dependencias.

Solo abre un canal cuando la autenticación local está lista y
`currentUser.remoteUserId === supabaseUser.id`. Registra dos listeners:

```text
postgres_changes / INSERT / public.tasks / owner_id=eq.<UUID remoto>
postgres_changes / UPDATE / public.tasks / owner_id=eq.<UUID remoto>
```

No escucha DELETE físico, Broadcast ni Presence. Las eliminaciones llegan
como UPDATE de deleted_at.

Valida la sesión, propietario, tabla y esquema, comprueba la fila con el mismo
validador que usa la sincronización manual y transforma snake_case a Task.
Aplica los eventos en una cola: espera la carga local, combina la fila mediante
TaskService y persiste en Preferences. No reemplaza la colección completa ni
las tareas de otros usuarios. Conserva ID y photoPath locales, incorpora GPS,
programación, revisión y demás campos remotos, y oculta los tombstones.

Los cambios aplicados quedan synced. No se invoca INSERT/UPDATE remoto ni
TaskSyncService.sync() desde el receptor. Los ecos de una escritura propia
equivalente reconcilian el pendiente; las revisiones duplicadas o anteriores
se ignoran. TaskService también impide que una respuesta HTTP atrasada
sobrescriba una revisión más reciente ya recibida por Realtime.

## Ediciones offline pendientes

Si el evento difiere de una edición local todavía pendiente, se conserva la
edición y su revisión base. Un aviso pide pulsar Sincronizar. El flujo manual
existente resolverá el conflicto con la copia local de respaldo y la regla
de prevalencia remota. Un evento no descarta silenciosamente trabajo offline
ni convierte una tarea recibida en un nuevo pendiente.

## Ciclo de sesión y conexión

Cada canal captura referencias de las sesiones y una generación propia.
Al cerrar sesión, cambiar cuenta o cambiar de sesión, el efecto invalida el
canal y llama removeChannel. Los callbacks tardíos se ignoran incluso antes
de terminar la retirada remota. La destrucción de la aplicación también lo
retira. Un error al abrir o retirar el canal no bloquea el uso local.

El dashboard reutiliza el área existente de sincronización para mostrar:
En tiempo real, Desconectado o Reconectando. El SDK gestiona el reintento del
canal. Realtime no condiciona isReady ni el arranque offline.

Los cambios ocurridos mientras el canal no estaba conectado no tienen un
replay garantizado: el botón Sincronizar sigue siendo la recuperación completa.
Tampoco se suben pendientes automáticamente al volver la red. Después de
recargar se mantiene el modelo anterior de tokens en memoria: hace falta un
login remoto válido para abrir el canal, sin impedir el acceso local.

## Activación de Supabase

La responsable del proyecto confirm?ó que activó `public.tasks` en la publicación `supabase_realtime`.
La prueba inicial conectaba el canal pero no entregaba el INSERT. Después de
la activación se recibieron eventos reales correctamente.

En un proyecto nuevo o si se desactiva:

1. Abrir Database → Publications.
2. Entrar en supabase_realtime.
3. Activar la tabla del esquema public llamada tasks.
4. Conservar RLS y las políticas SELECT/INSERT/UPDATE/DELETE por propietario.

Alternativa desde SQL Editor, solo si la tabla aún no pertenece a la publicación:

```sql
alter publication supabase_realtime add table public.tasks;
```

Consulta de comprobación desde el panel:

```sql
select pubname, schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'tasks';
```

El frontend no ejecuta este SQL ni utiliza claves administrativas. No se
añadieron políticas públicas ni se modificó RLS. La publicación y el filtro
del canal no sustituyen la autorización del servidor.

Documentación oficial:
[Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes),
[retirada de canales](https://supabase.com/docs/reference/javascript/removechannel).

## Evidencia real — Chrome, 9 de noviembre de 2026

Se utilizaron dos contextos aislados de Google Chrome, ambos ejecutando
TareaFácil desde localhost:8100. La instancia receptora inició sesión en la
aplicación. La escritora autenticó la misma cuenta mediante
SupabaseAuthService.signIn y utilizó su cliente existente, con la Publishable
Key y el JWT de usuario, para simular otra instancia autorizada. No hubo
clientes adicionales dentro de una instancia, mocks de servidor ni claves
administrativas.

Cuenta A: `usuario1@ejemplo.com`, UUID
`UUID_USUARIO_1`.

Cuenta B: `usuario2@ejemplo.com`, UUID
`UUID_USUARIO_2`.

| Prueba | Evidencia |
| --- | --- |
| INSERT de la segunda instancia | La primera recibió y persistió la tarea como synced, revisión 1 |
| UPDATE remoto | Cambiaron título, completado, GPS y programación sin pulsar Sincronizar |
| Fotografía local | Se conservó photoPath=task-photos/realtime-local.jpg |
| Sin bucles | Cero POST/PATCH/DELETE del receptor ante INSERT, UPDATE y tombstone remotos |
| Tombstone | Oculto automáticamente, con deletedAt persistido y fotografía conservada |
| Logout | Cero canales, Desconectado y colección persistida intacta ante eventos posteriores |
| Cambio de A a B | El canal de A se retiró y su evento no se aplicó bajo B; B recibió su propia fila |
| RLS Realtime | Una suscripción adicional de prueba autenticada como B y filtrada por A recibió cero eventos mientras A modificaba su fila; luego se retiró el canal de prueba |
| RLS REST | A no pudo leer ni modificar la tarea de B: cero filas devueltas/afectadas |
| Caída real | Se cerró el WebSocket y se desactivó la red de Chrome: Reconectando; CRUD local operativo y sincronización manual Sin conexión |
| Reconexión | El SDK reconectó; el siguiente UPDATE llegó sin sincronización manual, sin subir el pendiente offline |
| Recuperación manual | El pendiente offline se envió al pulsar Sincronizar y quedó synced |

Fila principal de la prueba: `UUID_TAREA_1`.
Repetición final de INSERT/UPDATE/tombstone:
`UUID_TAREA_2`, también confirmada con cero
escrituras automáticas del receptor y persistencia local correcta.
Fila privada de B: `UUID_TAREA_3`.
La verificación se hizo con el cliente autenticado; no se abrió Table Editor.

## Validación automática final

- 159/159 pruebas, en 20 archivos: 138 anteriores y 21 nuevas.
- TypeScript aplicación y tests con --noEmit: aprobado.
- Lint: aprobado.
- Build de producción: aprobado.
- Se mantienen avisos de Browserslist y presupuesto CSS de Home/Tareas.

Las pruebas nuevas cubren suscripción, INSERT, UPDATE, tombstone, photoPath,
pendientes, eco de escrituras, ausencia de bucles, revisiones atrasadas,
aislamiento, cambio de cuenta, logout, callbacks tardíos, fallos de canal,
persistencia y retirada al destruir la aplicación.
