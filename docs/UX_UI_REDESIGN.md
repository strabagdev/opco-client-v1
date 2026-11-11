# Auditoría y propuesta UX/UI de Opco Client

Estado: auditoría/propuesta del 07-11-2026; **etapa 1 implementada localmente el 08-11-2026, sin publicar**. Las etapas posteriores siguen NO IMPLEMENTADAS. Este documento no sustituye los cierres técnicos anteriores.

## Alcance y calidad de la evidencia

Revisión estática del árbol local y sus diferencias Git. Base Client `ecbf18a1061c1eab2a31e028bfedb7e20da3c557`; Core `07184c3db6522bc25b443cf94a410c25d5d60b0e`, consultado sólo para identificar la referencia. La propuesta afecta exclusivamente a presentación Client. Los cambios pendientes anteriores no forman parte de ella.

Se inventariaron las rutas de `app/`, los renderers registrados y los controles compartidos, y se leyeron sus composiciones, estilos y acciones relevantes. Esto permite demostrar estructura, textos, duplicaciones y propiedades declaradas; **no acredita su apariencia final, usabilidad, rendimiento, accesibilidad completa ni comportamiento en un dispositivo concreto**. No se ejecutaron aplicación, navegador, suites, builds, fixtures ni consultas productivas. Las medidas propuestas son objetivos de diseño, no resultados observados.

Referencias existentes: [DESKTOP_INTERFACE](DESKTOP_INTERFACE.md), [STATE_UPDATE](STATE_UPDATE.md), [matriz de aceptación offline](OFFLINE_ACCEPTANCE_MATRIX.md). La evidencia visual histórica sigue limitada a sus versiones, fixtures y navegadores; no se presenta como una inspección visual nueva del HEAD actual. En particular, sigue documentado el recorte de una opción SELECT larga en móvil; esta auditoría no demuestra una solución.

## 1. Inventario de pantallas y superficies

| Superficie | Archivos responsables | Contenido y comportamiento que se conserva |
| --- | --- | --- |
| Arranque | `app/_layout.tsx`, `app/index.tsx`, `src/state/session.tsx` | Restauración de sesión, proveedores, apertura local y redirecciones. No introducir otra sesión ni abrir SQLite desde componentes de diseño. |
| Acceso y organización | `app/(auth)/login.tsx` | Credenciales y selección de organización autorizada; recuperación de errores. |
| Shell y navegación | `app/(app)/_layout.tsx`, `src/components/desktop-navigation.tsx` | Contrato, volver, actividad central, usuario, categorías del catálogo asignado, modales de diagnóstico y errores. |
| Inicio | `app/(app)/index.tsx`, `src/lib/home-experiences.ts` | Experiencias asignadas agrupadas en Registros, Flujos y Análisis; avisos de disponibilidad y preparación automática existente. |
| Apertura de experiencia | `app/(app)/view/[appViewId].tsx`, `src/renderers/use-app-view.ts`, `registry.ts` | Definición, carga/error/soporte y elección de renderer por tipo y `workflowKey`. |
| RECORDS: lista | `src/renderers/records/RecordsRenderer.tsx` | Buscar, crear, abrir, cargar más, estado local, problemas y sincronización permitida. |
| RECORDS: crear/editar | Rutas `view/[appViewId]/record/new.tsx`, `record/[recordId]/edit.tsx`; `RecordFormScreen.tsx` | Campos configurados, requeridos, errores, guardar local y retorno. |
| RECORDS: detalle | Ruta `view/[appViewId]/record/[recordId].tsx`; `RecordDetailScreen.tsx` | Valores tipados, etiquetas, estado, editar y acciones de recuperación existentes. |
| Problemas y conflictos RECORDS | Rutas `view/[appViewId]/problems.tsx`, `record/[recordId]/conflict.tsx`; `RecordProblemsScreen.tsx`, `RecordConflictScreen.tsx` | Pendientes, fallos, ambas versiones y decisiones explícitas; conservar enlaces desde Diagnóstico. |
| Consulta directa de entidad | `app/(app)/entity/[entityTypeId].tsx` y `entity/[entityTypeId]/record/[recordId].tsx`; `src/lib/entity-record-display.ts` | Dos pantallas con implementación propia de lista/detalle. No son simples alias de RECORDS. Comparten necesidades visuales, pero sus cargas no se deben sustituir como parte del diseño. Su uso efectivo desde el catálogo actual no fue acreditado. |
| Attendance | `src/renderers/workflows/attendance/AttendanceWorkflow.tsx` | Fecha, contexto SELECT/RELATION, búsqueda manual/lector, sujeto, estados, observación, confirmación/conflicto, resumen y últimas actualizaciones. |
| STATE_UPDATE | `src/renderers/workflows/state-update/StateUpdateWorkflow.tsx`, `state-update-presentation.tsx` | Modos e identidad configurados, contexto simple/compuesto, búsqueda, formulario, horario aplicado, preparación automática, pendientes, conflictos y cancelación local autorizada. |
| REPORT | `src/renderers/reports/ReportRenderer.tsx` | Consultas TABLE/MATRIX y presentación de estado actual; filtros de mes/rango y visualización configurada. Sólo lectura. |
| PANEL | `src/renderers/panels/PanelRenderer.tsx` | Filtros tipados, módulos TABLE/KPI, búsqueda, paginación, snapshots exactos y reintentos. Sólo lectura; respetar layout configurado. |
| No soportado | `src/renderers/unsupported/UnsupportedRenderer.tsx`, `workflows/unsupported/UnsupportedWorkflow.tsx` | BOARD/DASHBOARD y workflows desconocidos conservan salida controlada; no diseñar nuevas capacidades bajo esos nombres. |
| Soporte técnico | Modal global en el shell; `app/(app)/diagnostics/state-update.tsx`, `src/state/session.tsx` | Problemas, sincronización, rendimiento, PWA, STATE_UPDATE, RECORDS y recuperación de almacenamiento. Mantener información avanzada y acciones con sus condiciones de seguridad. |
| Superficies transitorias | `CompactSelect`, entradas temporales, `CodeReader`, diálogos de confirmación y menú de usuario | Teclado, foco, selección, cámara, confirmaciones y recuperación. Deben auditarse también abiertas, no sólo cerradas. |

El inventario comprende las 14 rutas/layouts actuales de `app/`. No presupone que todas sean accesibles para todos los usuarios. RELATION es un tipo de campo y un servicio/control reutilizado, no una nueva AppView. La interfaz sigue derivándose de las definiciones y permisos existentes.

## 2. Hallazgos y prioridad

P1: comprensión de la tarea o seguridad de la decisión. P2: consistencia, eficiencia de interacción y accesibilidad. P3: consolidación posterior. Las prioridades no certifican severidad de incidentes productivos.

| Prioridad | Evidencia comprobable en código | Problema o riesgo UX | Cambio propuesto, sin cambiar comportamiento |
| --- | --- | --- | --- |
| P1 | `AttendanceWorkflow.tsx:231,1452`: título fijo en compacto y `appView.name` en desktop | Una experiencia reutilizada lleva un título principal distinto según dispositivo. | Usar el nombre configurado como título principal en ambos; conservar subtítulos útiles y estados configurados. |
| P1 | `AttendanceWorkflow.tsx:1718–1734`, `ConflictModal`: muestra sólo estado actual/solicitado | Al cambiar únicamente observación, los estados visibles pueden ser iguales y no explicar qué se autoriza. | Mostrar resumen del comando ya capturado y diferencias de campos configurados, incluidos extras/contexto cuando correspondan. Conservar exactamente confirmar/cancelar, autorización, base e idempotencia. |
| P1 | `app/(app)/_layout.tsx:395–417`: progreso de AppViews «procesadas»; varias fuentes de actividad y escritura | Un contador de preparación y un indicador global pueden interpretarse como garantía de todos los datos o envío completado. | Explicar «Preparando copia para uso sin conexión» y su alcance real; separar lectura, guardado local y ACK. No sustituir «procesadas» por «disponibles» sin evidencia de cobertura. |
| P1 | `RecordFieldInput.tsx:56–68`: BOOLEAN como Pressable Sí/No sin rol/estado de selección explícitos | La semántica del control no está declarada en este componente. | Mantener valor/handler y añadir semántica de checkbox o switch adecuada, etiqueta y estado. Verificar con tecnología asistiva. |
| P1 | `app/(auth)/login.tsx:93–110`: Email/Password como placeholders, sin etiquetas persistentes | El significado desaparece al escribir y mezcla idiomas. | Etiquetas visibles «Correo»/«Contraseña», nombres accesibles y errores asociados; conservar autenticación y autocompletado seguro. |
| P2 | `app/(app)/_layout.tsx:463–491`: cabecera compacta con filas de identidad, usuario y actividad | Mucha estructura fija antes del contenido de la tarea. La altura real no se midió. | Cabecera contextual compacta; cuenta fuera de la fila principal; estado resumido accesible con detalle bajo demanda. |
| P2 | `app/(app)/_layout.tsx:379,479–485`: indicador y botón Diagnóstico abren el mismo modal; cambian la pestaña inicial | Dos accesos próximos con destino común y propósito poco diferenciable. | Un acceso claro al estado y uno a los cambios pendientes sólo cuando corresponda; detalle técnico dentro del mismo soporte. Conservar todos los destinos existentes. |
| P2 | `app/(app)/_layout.tsx:467–469`: volver es texto `←` sin etiqueta accesible explícita | El nombre accesible puede ser insuficiente. | Icono compartido y etiqueta «Volver»; no alterar historial ni fallback de navegación. |
| P2 | `app/(auth)/login.tsx:68,127–130`: «Cliente generico movil», base y bundle visibles normalmente en web | Información de implementación ocupa el acceso principal. | Introducción breve orientada a uso; base/bundle en «Información técnica» accesible antes de iniciar sesión, conservando copia. |
| P2 | `app/(app)/index.tsx:293–324,365–379`: bloque amplio de organización/contrato en móvil, compacto en desktop | Identidad y contexto repetidos entre shell e Inicio. | Un selector visible y consistente de contrato; mostrar organización como contexto secundario. Mantener selección, asignaciones y aislamiento. |
| P2 | `RecordFieldInput.tsx:268` y estilos de campos; `RecordFormScreen.tsx:406–465` | Cada campo tiene superficie/borde/espaciado propio dentro de otro formulario; formulario genérico esencialmente apilado. | Campo sin tarjeta propia y secciones semánticas; dos columnas sólo si caben, con texto largo y errores a fila completa. No inventar secciones de negocio. |
| P2 | `RecordFormScreen.tsx:341–343`: asigna errores y retorna, sin enfoque al primer inválido en ese camino | El usuario puede no descubrir un error fuera del viewport. | Resumen y enlace/enfoque al primer campo inválido; mantener validadores y momento de validación. |
| P2 | `RecordsRenderer.tsx:552–559` y ruta de entidad: búsqueda basada visualmente en placeholder | Falta una etiqueta persistente junto al buscador. | Etiqueta visible y ayuda contextual breve; conservar debounce, paginación y semántica global/dirigida. |
| P2 | `RecordDetailScreen.tsx:128–149`: Volver/Editar antes del título; shell también tiene volver | Jerarquía y navegación repetidas. | Título seguido de acciones del registro; un único volver equivalente. No retirar rutas ni resolución de errores. |
| P2 | `RecordsRenderer.tsx:707`, `RecordDetailScreen.tsx:195`, `RecordProblemsScreen.tsx:419` | Badges locales implementados por separado, aunque reutilizan `getRecordSyncLabel`. | Unificar sólo apariencia/semántica del badge sobre el mismo mapper. No calcular de nuevo el estado de sincronización. |
| P2 | `AttendanceWorkflow.tsx:1573–1584` y selección del sujeto | Observación colapsable usa «Agregar observación», incluso al recuperar contenido existente. | Vista previa cuando ya existe y «Editar observación»; mantener borrador protegido y handlers. |
| P2 | `ReportRenderer.tsx:202–223,305–347`: scroll horizontal en tablas/matrices; `PanelRenderer.tsx:736–792`: scroll anidado y textos de una línea | Lectura móvil exige desplazamiento lateral y puede ocultar contenido largo. No se comprobó overflow real nuevo. | TABLE en filas con etiquetas/expansión conservando todas las columnas; MATRIX mantiene desplazamiento contenido por su naturaleza bidimensional. Acceso al texto completo sin depender de hover. |
| P2 | `PanelRenderer.tsx:398–403` frente a `app-shell-layout.ts` | PANEL cambia de composición a 760 px, shell/otros a 900; la decisión es por ancho. | Adoptar criterios comunes de contenedor y capacidad táctil/teclado, respetando el layout Core. Los cortes distintos no son por sí solos un defecto. |
| P2 | `desktop-presentation.ts`, estilos locales, `app/_layout.tsx` | Paleta desktop azul acotada, otros estilos turquesa y fondos blancos; StatusBar oscuro fijo; no hay tema global por esquema. | Tokens semánticos y variante oscura por etapas, sin aplicar un reemplazo global de colores sobre todos los renderers. |
| P2 | Modales de Attendance, selección, cámara y soporte con implementaciones distintas | Roles, foco, Escape, retorno de foco y teclado necesitan una comprobación transversal. | Marco accesible compartido donde falte; conservar funcionalidades ya presentes en CompactSelect/cámara. No se demuestra aquí que todos fallen ni que RN Web Modal carezca de gestión de foco. |
| P3 | Rutas `entity/…` con lista/detalle propios; dos componentes unsupported | Composición duplicada y posibilidad de divergencia visual. | Reutilizar marcos de lista/detalle/estado no soportado; no fusionar cargas, permisos o contratos bajo una refactorización visual. |
| P3 | `RecordConflictScreen.tsx:242` y diagnósticos | IDs y detalles internos visibles en superficies de resolución/soporte | Etiquetas y explicación primero; identificadores y diagnóstico completos en detalle avanzado. No inventar etiquetas ni ocultar la información necesaria para soporte. |

No se midieron peticiones, renderizados, latencias ni interacción real. Estos hallazgos **no demuestran que el estilo cause demoras**. Antes de atribuir lentitud a un componente se necesita una traza del mismo recorrido y fixture.

## 3. Navegación y composición adaptable recomendadas

Una sola arquitectura de rutas, catálogo y workflow montado. Cambiar de tamaño sólo modifica composición y estilo; no cambia keys, scopes, contexto, búsqueda, borradores ni dependencias de preparación. La navegación sigue usando las experiencias ya asignadas; no crea lecturas remotas para pintar el menú.

### Teléfono

- Cabecera de la pantalla con volver cuando corresponda, nombre de experiencia/contrato legible y actividad resumida. Cuenta deja de ocupar una fila completa.
- Barra inferior propuesta con **Inicio / Cambios / Cuenta**: usa Inicio, problemas/diagnóstico y menú de usuario existentes. «Cambios» lleva sólo el contador acreditado y permite acceder al detalle; no es otro motor de sincronización. No añadir favoritos, recientes ni pantallas de negocio.
- Un único desplazamiento principal por pantalla cuando sea posible. Contexto configurado antes del buscador; formulario vertical. Resultados con título, secundarios y acción próxima.
- Acción principal al final del formulario; barra de acciones accesible cerca del pulgar en edición larga sólo si no tapa campos, teclado ni mensajes. Acciones de estado de Attendance siguen representando sus comandos actuales; no reemplazarlas por un Guardar ambiguo.
- No abrir automáticamente el teclado al entrar ni depender de tooltip/hover. Filtros extensos pueden contraerse con resumen de valores activos, sin cambiar cuándo se consulta ni añadir un paso de «Aplicar» que altere handlers.

### Tablet e interacción híbrida

- Evaluar ancho **del área útil**, longitud de etiquetas, zoom/fuente y espacio que ocupa la navegación; no identificar tablet por user-agent.
- Mantener controles táctiles amplios aunque exista sidebar. Dos columnas cuando cada campo sea utilizable; como punto inicial de prototipo, ancho de campo cercano a 280 px, no una restricción de negocio.
- Contexto horizontal con wrap; búsqueda y lista junto al formulario sólo si ambos conservan ancho suficiente. Es la misma instancia y estado, no dos workflows.
- Rail compacto o menú desplegable de navegación si una sidebar completa comprime la tarea. No ocultar acciones esenciales en hover; permitir touch, teclado y mouse simultáneamente.

### Escritorio

- Conservar sidebar por categorías y contrato existente, sin listas de todas las experiencias expandidas permanentemente.
- Workspace de lectura con límite de ancho razonable; reutilizar Inicio max. 1280 px y buscador max. 560 px. Formularios pueden limitarse a unos 800–960 px según contenido; no estirar inputs a todo el monitor.
- Contexto compacto horizontal, resultados alineados y edición en dos columnas; acciones de ancho natural cerca de la sección que afectan. Encabezados y separadores discretos en lugar de tarjeta por valor.
- El teclado recorre el mismo orden semántico que en móvil; foco visible y texto íntegro. Mouse/hover es una mejora, nunca requisito.

Los cortes existentes 900/1200 px son el punto de partida de migración, no un detector de dispositivo. Para web se pueden considerar `any-pointer` y `any-hover`: un híbrido puede admitir más de un tipo de puntero; esas capacidades no sustituyen la navegación por teclado ni justifican reducir blancos táctiles. [MDN any-pointer](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/any-pointer), [MDN any-hover](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/any-hover).

## 4. Sistema de diseño recomendado

Es una especificación visual inicial, **no un tema implementado ni certificado**. Reutilizar `desktopPalette` y `visual-stability.ts`; sustituir usos por roles semánticos gradualmente en los componentes que se migren. No continuar ampliando un mapa de sustitución de colores por cadenas como mecanismo de tema universal.

| Área | Propuesta |
| --- | --- |
| Tipografía | Fuente de sistema actual; cuerpo/input 16, etiqueta 14 semibold, ayuda 14, sección 18–20, pantalla 24, acceso 28. 12 sólo para metadatos no esenciales. Interlineado aproximado 1,4–1,5; respetar escalado del sistema. |
| Jerarquía | Un título principal por pantalla, secciones por tarea, etiqueta persistente por campo; no repetir tipo, entidad y AppView como tres títulos equivalentes. Mantener metadata útil en segundo nivel. |
| Espaciado | Escala 4/8/12/16/24/32. 8 entre etiqueta y control; 12–16 entre campos; 24 entre secciones. Padding de pantalla 16 compacto y 24 amplio, ajustado a espacio útil. |
| Superficies | Fondo, superficie y selección; borde discreto de sección y borde reconocible de control. Radio 8 en controles y 12 en paneles. Evitar sombras y tarjetas anidadas sin función. |
| Controles | Altura cómoda 44–48 px, texto 16, etiqueta/ayuda/error asociados. Reutilizar mínimos actuales de `visual-stability.ts`. Botones primario/secundario/texto/peligro con estados normal, pressed, hover, focus, disabled y busy. |
| Estados | Diferencia por texto/icono además de color; disabled no se distingue sólo por opacidad. Busy explica la operación y evita dobles comandos usando las guardas existentes. No añadir animación por campo o tarjeta. |
| Iconos | Lucide mediante `AppIcon` y su whitelist/fallback; tamaño coherente 18/20/24. Icono con etiqueta cuando la acción no sea inequívoca; nombre accesible para botones sólo icono. |
| Movimiento | Reutilizar `useReducedMotion`; transiciones breves sólo si aclaran un cambio. No añadir movimiento mientras se muestran datos ya disponibles sin operación activa. |
| Claro/oscuro | Roles comunes; esquema inicial del sistema. Una preferencia manual persistida requeriría alcance posterior: no añadir ajustes, claves SQLite ni almacenamiento por esta propuesta. |

Paleta inicial de referencia:

| Rol | Claro | Oscuro propuesto |
| --- | --- | --- |
| Fondo / superficie | `#F4F6F8` / `#FFFFFF` | `#0F172A` / `#18263A` |
| Texto / secundario | `#202B3A` / `#536174` | `#F1F5F9` / `#CBD5E1` |
| Primario / texto sobre primario | `#315DA8` / `#FFFFFF` | `#90B8FF` / `#10213E` |
| Selección | `#E8EFFA` | `#263F64` |
| Borde de control | `#7B879A` | `#8191A8` |
| Éxito: texto / fondo | `#166534` / `#F0FDF4` | `#86EFAC` / `#123525` |
| Advertencia: texto / fondo | `#854D0E` / `#FFFBEB` | `#FCD34D` / `#3A2B0A` |
| Error: texto / fondo | `#B42318` / `#FEF3F2` | `#FCA5A5` / `#421F24` |
| Información: texto / fondo | `#1D4ED8` / `#EFF6FF` | `#BFDBFE` / `#172E4D` |

Cada combinación efectiva, foco y estado se medirá antes de acreditarlo. Objetivo WCAG AA: contraste de texto normal 4,5:1, texto grande 3:1 y elementos gráficos/controles relevantes 3:1. No se interpreta un borde decorativo como el único límite de un control. [Contraste de texto](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [contraste no textual](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

44–48 px es la recomendación de comodidad del producto; no se confunde con el mínimo AA de WCAG 2.2 de 24×24 CSS px, que además tiene excepciones. El diseño deberá reflow a 320 CSS px, salvo contenido esencialmente bidimensional, y no ocultar el foco tras barras fijas. [Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

### Vocabulario de estados y errores

Reutilizar los mappers `app-shell-feedback.ts`, `write-feedback.ts`, `state-update-operation-feedback.ts` y `getRecordSyncLabel` de `src/sync/records-sync.ts`. El diseño no crea una segunda interpretación del estado.

| Hecho acreditado existente | Presentación propuesta |
| --- | --- |
| Persistencia local confirmada | «Guardado en este dispositivo». |
| Intención durable pendiente | «Pendiente de enviar»; acción sólo si el flujo la permite. |
| Envío activo real | «Enviando cambios…»; separado de descarga/preparación. |
| ACK válido de Core | «Sincronizado con Opco». Un check global no certifica cada fila. |
| Lectura/preparación activa | «Actualizando copia local…», con alcance al abrir el detalle. |
| Conflicto | «Hay dos versiones. Revisa el cambio»; mostrar ambas y las decisiones existentes. |
| Fallo remoto con copia válida | «No pudimos actualizar. Puedes consultar la copia guardada», con fecha/alcance disponible. |
| Datos preparados vacíos | Mensaje de resultado vacío; no mensaje de fallo ni descarga pendiente. |
| Caché ausente/parcial | «Estos datos aún no están disponibles sin conexión» y límite concreto. Una página o snapshot exacto no acredita toda una colección. |
| Error de almacenamiento | Mensaje específico de lectura/guardado y recuperación segura existente. No prometer que se conservó algo sin confirmación de escritura. |

No ocultar errores bajo un toast que desaparece antes de poder actuar. Mensaje breve junto al contenido, borrador/copia preservados según la lógica actual y recuperación contextual. Detalle técnico disponible, sin IDs personales ni payloads en telemetría. No ofrecer reset como recuperación normal del almacenamiento.

## 5. Reutilización y consolidación

| Pieza actual | Decisión propuesta |
| --- | --- |
| `CompactSelect` | Reutilizar selección simple/múltiple, opciones no disponibles, required, foco y limpieza opcional. Evolucionar su tema, no construir otro dropdown. Revisar etiqueta larga en popup nativo como limitación específica. |
| `temporal-input.web/native`, lógica temporal | Reutilizar calendario/mes/hora y composición DATETIME. DATE sigue siendo `YYYY-MM-DD`; no conversión de zona. Mantener el límite futuro de Attendance sólo donde ya aplica. |
| `RecordFieldInput` | Conservar adaptación tipada y validadores; extraer marco visual de campo con variantes compacta/plana, ayuda, error y semántica accesible. No duplicar SELECT, MULTISELECT, precisión o RELATION. |
| Servicios `use-extra-relations`, `use-context-relations` y catálogos existentes | Reutilizar paginación, búsqueda autorizada, IDs/labels y avisos de cobertura; nunca descargar toda la entidad para llenar un menú. Compartir composición visual sólo si los contratos lo permiten. |
| `CodeReader` | Conservar permiso explícito, recursos locales, cancelación y ciclo de vida. El resultado sólo completa la búsqueda según configuración; nunca selecciona ni guarda. |
| `SubjectIdentity` / `subject-presentation-display.ts` | Reutilizar título/secundarios configurados y fallbacks autorizados, sin recalcular `displayName`, habilitar campos ni pedir etiquetas por cada fila. |
| `StateUpdateFormGrid` / `StateUpdateReadRows` | Base de layout de campos/filas y ancho disponible, no nuevo workflow. Usar en otras superficies sólo mediante datos de presentación equivalentes. |
| `DesktopNavigationProvider` / sidebar | Mantener proyección de asignaciones y rutas; añadir variantes visuales, no otro catálogo o fetch. |
| `ReadLoadingState`, `useReducedMotion`, indicador central | Conservar; no agregar spinners competidores ni vincular carga a mera navegación. |
| Badges, botones, avisos y marcos de sección locales | Fusionar gradualmente en componentes de presentación con tokens y semántica comunes. Mantener props/handlers/mappers existentes. |
| Modales y confirmaciones | Marco accesible común, pero contenidos y decisiones siguen en cada workflow. No fusionar conflicto, descarte de borrador y revisión de horario como una autorización genérica. |
| UnsupportedRenderer / UnsupportedWorkflow | Fusionar presentación de estado no soportado; resolución y guards permanecen separados. |
| Tarjetas individuales de campo, títulos repetidos, accesos equivalentes duplicados | Retirar sólo envoltorios y redundancia visual demostrada. No eliminar información, handlers, rutas ni acciones que sólo parecen similares. |
| Diagnóstico y recuperación OPFS | Mantener completos en detalle avanzado. No convertir una propuesta visual en reintentos, recargas o borrados genéricos. |

Los botones de estados de Attendance no son un grupo SELECT redundante: ejecutan comandos con semántica propia. Tampoco corresponde fusionar el runtime Attendance con STATE_UPDATE ni reescribir sus hooks para compartir estilos.

## 6. Bocetos estructurales

Son esquemas de propuesta, **no capturas, maquetas de la aplicación en ejecución ni evidencia funcional**. Los nombres entre corchetes representan configuración existente. No fijan campos de negocio ni nuevas capacidades.

### Teléfono — Inicio y navegación

```text
┌───────────────────────────────────┐
│ Opco          [Contrato ▾] [Estado]│
│ Inicio                            │
│ [Aviso de copia local si aplica]   │
│ Registros                         │
│ [icono] [Experiencia]           ›  │
│         [límite offline si aplica] │
│ Flujos                            │
│ [icono] [Experiencia]           ›  │
│ Análisis                          │
│ [icono] [Experiencia]           ›  │
├───────────────────────────────────┤
│ Inicio      Cambios (n)      Cuenta│
└───────────────────────────────────┘
```

### Teléfono — workflow

```text
┌───────────────────────────────────┐
│ ‹ [Experiencia]          [Estado] │
│ [Contrato]                        │
│ Contexto                          │
│ [Fecha / campos configurados]     │
│ [Selector] [Selector si existe]    │
│ Buscar                            │
│ [Texto                        ]   │
│ [Escanear código, si configurado] │
│ [Resultado: título + secundarios] │
│ [Resultado: título + secundarios] │
│                                   │
│ [Sujeto seleccionado]             │
│ [Campos / observación existentes] │
│ [Estado/acción] [Otra acción]      │
│ [Resultado local o conflicto]     │
└───────────────────────────────────┘
```

Contexto antes de buscar no significa el mismo bloqueo en todos los workflows: Attendance exige sus campos obligatorios al confirmar sin bloquear búsqueda; STATE_UPDATE compuesto conserva sus condiciones actuales de contexto completo. No añadir un paso de preparación manual.

### Tablet — contexto común, lista y edición si caben

```text
┌───────┬──────────────────────────────────────────────────┐
│ Inicio│ [Experiencia]                           [Estado]│
│ Grupos│ [Fecha] [Contexto 1] [Contexto 2] [más si existen] │
│       ├────────────────────────┬─────────────────────────┤
│       │ Buscar [          ][⌁] │ [Sujeto seleccionado]   │
│       │ Resultado              │ [Campo]                 │
│       │ Resultado              │ [Campo largo]           │
│       │ Resultado              │ [Acciones existentes]   │
└───────┴────────────────────────┴─────────────────────────┘
```

Si no caben, se apila; no se crean dos renderers ni se pierde la selección. El rail es una variante del menú actual, no un segundo árbol de navegación.

### Escritorio — shell y experiencia

```text
┌────────────────┬─────────────────────────────────────────────────┐
│ Opco           │ [Actividad de lectura / cambios]        [Cuenta]│
│ [Organización] ├─────────────────────────────────────────────────┤
│ [Contrato ▾]   │ [Experiencia]                       [Acción]   │
│ Inicio         │ [Contexto 1] [Contexto 2] [Fecha]  (wrap)       │
│ Registros      │ Buscar [máx. 560 px                 ] [Escanear]│
│ Flujos         │ Título / secundarios     Estado       Acción   │
│ Análisis       │ ─────────────────────────────────────────────── │
│                │ Resultado              [dato]          [abrir] │
│ Cambios (n)    │ Resultado              [dato]          [abrir] │
└────────────────┴─────────────────────────────────────────────────┘
```

La columna Estado sólo existe cuando la definición/renderer ya la ofrece. La sidebar muestra únicamente categorías presentes, no entradas ficticias vacías.

### Formulario genérico y confirmación

```text
Formulario amplio                   Confirmación existente
[Título]                            [Título contextual]
[Estado local acreditado]           Sujeto / fecha / contexto
[Etiqueta 1]       [Etiqueta 2]      Campo       Actual → Solicitado
[Control]          [Control]         [cambios configurados]
[Etiqueta de texto largo]           [mensaje de conflicto si aplica]
[Control a fila completa]           [Cancelar] [Confirmar cambio]
[Error junto al campo]
[Volver] [Guardar]
```

En teléfono cada campo pasa a una fila. La confirmación lee el comando capturado: editar el formulario no autoriza silenciosamente otro comando. Cancelar, rechazar o fallar conserva el comportamiento y las protecciones existentes.

### REPORT/PANEL y problemas

```text
Consulta sólo lectura                 Cambios / problemas
[Título]           [Estado copia]     [Cantidad y alcance actuales]
Filtros [resumen] [Mostrar filtros]    [Registro / experiencia]
[Campos configurados]                 Pendiente / Fallo / Conflicto
[Buscar cuando ya exista]             [Acción principal existente]
Fila: [título]                         [Otras acciones permitidas]
  Etiqueta: valor                      [Detalle técnico ▾]
  Etiqueta: valor completo
[Anterior] Página n [Siguiente]
[Alcance y fecha del snapshot]
```

Expansión o apilado no oculta columnas: todas siguen accesibles. MATRIX conserva ejes y desplazamiento contenido. El detalle técnico conserva revisiones, fingerprints, códigos y herramientas actuales. No aparece un botón de edición en consultas de sólo lectura.

## 7. Plan incremental recomendado

| Etapa separable | Alcance | Verificación y salida |
| --- | --- | --- |
| 0. Aprobar estructura | Validar estos bocetos y vocabulario con tareas representativas; inventario por configuración corta/extensa. | Sin implementación ni configuración productiva. Congelar contratos y handlers a preservar. |
| 1. Claridad y accesibilidad básica | Nombre AppView consistente, etiquetas persistentes, nombres de acciones, semántica BOOLEAN, resumen de confirmación y observación existente. | Lote pequeño sin mover estado/hooks; regresiones de mismas llamadas, payloads y comandos. **Primera implementación recomendada.** |
| 2. Primitivas visuales | Tokens, botones, campos, avisos y badges; migración de una superficie cada vez. Variante oscura con contraste medido. | Sin normalizador de datos ni refactor de sincronización; verificar SELECT/RELATION/fechas y mensajes. |
| 3. Shell/Inicio adaptable | Compactar cabecera y contexto; variantes de navegación y acceso a cambios/cuenta existentes. | Mantener mismo Stack y catálogo; resize/foco/navegación no añade peticiones ni remonta el workflow. |
| 4. Formularios y resultados | Layout de campo sin tarjeta propia, grid, foco de errores, títulos/secundarios y acciones cercanas. | No cambiar búsqueda, guardado, contexto persistido ni confirmaciones. Comparar filas/valores íntegros en ambos tamaños. |
| 5. Consultas | TABLE adaptable, MATRIX contenida, filtros compactables y texto completo. | Igual consulta/página/orden/caché y columnas; PANEL sigue basado en snapshots exactos, sin preparación nueva. |
| 6. Aceptación por dispositivo | Recorridos con usuarios no técnicos y dispositivos reales. | Acreditar sólo navegador/versión/entorno probados; ajustar composición antes de ampliar a otras superficies. |

No consolidar todas las etapas en una reescritura. Cada lote debe mantener su inventario, evidencia y delta separable. Nada de esta propuesta autoriza activación por contrato, reordenamiento de estados de negocio ni nuevos permisos.

## 8. Riesgos y validación necesaria antes de implementar/publicar

| Riesgo | Comprobación focalizada requerida |
| --- | --- |
| Resize/remontaje pierde borrador o inicia lecturas | Workflow real con contexto, búsqueda y edición; tamaños 390/768/820/1024/1440 y límites 899/900,1199/1200; PANEL 759/760. Misma instancia, identidad, borrador y cero llamadas adicionales atribuibles al resize. |
| Compactar oculta acciones/contexto | Campos 0/1/muchos, títulos/opciones largos, estados/extras configurados, relaciones una/varias. Todas las acciones anteriores accesibles, sin defaults nuevos. |
| Tema o barra fija degrada acceso | Claro/oscuro, zoom 200/400%, reflow 320 CSS px, teclado virtual, landscape, safe areas, alto reducido, contraste efectivo de cada estado. |
| Modales/foco/teclado | Tab/Shift+Tab, Enter/Space/Escape, foco inicial/retorno, etiquetas y errores anunciados. Usar patrón de diálogo modal como referencia, sin asumir conformidad por usar Modal. [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). |
| Confundir guardado con sincronización | Persistencia local, pendiente, envío, ACK, fallo y conflicto con datos sintéticos; no inferir éxito por red disponible ni preparación terminada. |
| Romper comandos o autorización | Attendance observación/estado/ambos, confirmar/cancelar/error, contexto SELECT/RELATION; STATE_UPDATE modos actuales y conflicto. Mismos payloads, base, autorización e idempotencia; respuestas tardías siguen protegidas. |
| Perder información al adaptar tablas | TABLE/MATRIX/KPI con texto largo, vacíos, errores, última página y snapshot ausente/parcial; todas las columnas y etiquetas disponibles, sin IDs como sustitutos ni nuevas agregaciones. |
| Romper cachés o pendientes | Guardado local → cierre/reapertura SQLite/OPFS → reconexión con el mismo fixture. No cambiar base, namespace, outbox, conflictos ni intenciones por una preferencia visual. No borrar almacenamiento para pasar la prueba. |
| Confundir búsqueda manual y lector | Sólo UI afectada: misma búsqueda global/manual y dirigida/configurada; múltiples resultados y cero guardados automáticos. Revalidar ciclo de cámara únicamente si se modifica su composición/lifecycle. |
| Uso de relaciones | Catálogo autorizado paginado, valores no disponibles, etiquetas y datos preparados offline; abrir dropdown no descarga todo ni inicia una consulta por fila. |
| Certificar dispositivos sin probar | Chrome desktop, Android y Safari/iPhone/PWA sólo con evidencia real de cada uno; emulación de viewport no equivale a cámara, teclado virtual, VoiceOver o Safari físico. Si se entrega native, validar también sus controles específicos. |
| Reestructuración invade otras capas | Revisar diff y handlers antes/después. Ningún cambio en API, schema, permisos, asignaciones, sincronización o política de preparación se incluye para justificar una mejora visual. |

Para accesibilidad: comprobar al menos teclado y lector de pantalla representativo por plataforma (por ejemplo NVDA/VoiceOver/TalkBack según entorno), no sólo atributos estáticos. Para uso: medir tiempo hasta contenido utilizable, pasos por tarea, errores y capacidad de recuperación con el mismo fixture antes/después. No se fijan mejoras porcentuales sin línea base.

## Resultado de esta revisión

Existe una base reutilizable suficiente. Se recomienda empezar por **claridad del título, etiquetas/semántica de controles y contenido de confirmación**, antes de modificar navegación. La compactación del shell, los tokens y las consultas adaptables siguen en lotes separados. No es necesario cambiar Core, APIs, esquemas ni infraestructura offline para los cambios visuales propuestos; cualquier necesidad distinta debe revisarse antes de ampliar el alcance.

Quedan pendientes aprobación del diseño, inspección visual actual, aceptación de usuarios, mediciones y pruebas de dispositivos/accesibilidad. Esta auditoría no declara estabilidad offline general, no cierra la auditoría vigente y no reabre V11.


## Etapa 1 — claridad y accesibilidad, implementación local 08-11-2026

Alcance autorizado: presentación, sin reorganizar navegación ni aplicar todavía el sistema de diseño de etapas posteriores.

| Antes | Ahora |
| --- | --- |
| Attendance: título fijo en compacto y nombre configurado en desktop. | Nombre de AppView como título principal en todos los tamaños. El formulario RECORDS conserva ese título y presenta Crear/Editar como operación secundaria. |
| Correo/contraseña sólo como placeholders; campos con nombre accesible sin asociación al mensaje. | Etiquetas persistentes y referencias únicas a etiqueta/error; required e invalid visibles para tecnología asistiva web, incluidos SELECT, MULTISELECT, RELATION y entradas temporales. DATETIME distingue sus dos partes. |
| Booleanos como botones sin estado explícito. | Checkbox con estado marcado/no marcado; Espacio y Enter conservan un único cambio de valor. No se introducen valores predeterminados. |
| Foco desigual y volver representado sólo por una flecha. | Foco web visible compartido y nombre accesible de volver; acciones principales y confirmación con rol/estado. |
| Confirmación Attendance sólo comparaba estados visibles. | Explica corrección de un registro existente y muestra estado, observación configurada y contextos actuales/solicitados. Compara identidad de opciones, no etiquetas. No presenta como conocido un valor que no llegó en la lectura. |
| Observación existente colapsada detrás de Agregar. | Vista previa y Editar observación; creación/actualización distinguidas en la acción principal. STATE_UPDATE distingue Crear/Actualizar registro según el sujeto seleccionado y conserva Registrar cambio para append; explica diferencias de datos, no sólo de estado. |

El resumen lee `confirmedEntry`, la versión remota del conflicto y etiquetas ya disponibles. Nunca crea una autorización ni modifica el comando. SELECT usa sus opciones; RELATION conserva etiquetas de catálogo/lectura del mismo ID y evita mostrar IDs como sustitutos. Valores históricos incompatibles se muestran como no disponibles, sin truncarlos o repararlos. No se añade confirmación a altas normales ni se retira ninguna decisión de conflicto/descarte existente.

Los handlers comparados por AST de Attendance, STATE_UPDATE, formularios, sincronización de RECORDS y login permanecen idénticos: guardado, confirmar/cancelar, selección, cambios de contexto/fecha y resolución. No hay cambios de API, Core, paquetes, esquema, SQLite/OPFS/outbox, base/autorización/clientRequestId, búsquedas, preparación de Inicio ni configuración productiva.

Validación local y comparación antes/después: informe, inventario/parche y capturas en `backups/ux-ui-stage1/2026-11-08/`. Navegador Chromium real sobre Linux con API/datos sintéticos, renderers exportados reales y OPFS propio; tamaños 390/1024/1440, foco, teclado, cancelación, rechazo y recuperación. El antes reutiliza un export con 147 fuentes funcionales idénticas al HEAD inicial. Esta evidencia no acredita Core productivo, Safari/iPhone físico, native ni una auditoría accesible completa. Los fallos de los arneses ampliados que también aparecen en HEAD y los errores globales de lint previos se conservan separados en el informe; no se presentan como PASS global.

Etapa 2 sigue pendiente de revisión de este lote. La composición de la cabecera, las tarjetas, navegación, tema oscuro y tablas adaptables conservan el comportamiento anterior. No se declara estabilidad offline general ni se reabre V11.

## Etapa 2 — navegación y organización, implementación local 08-11-2026

Esta autorización adelanta el shell/Inicio que el plan original enumeraba como etapa 3. Los tokens, tema oscuro y rediseño de consultas/formularios siguen siendo etapas separadas. Delta sobre la Etapa 1 local; no publicado.

- Cabecera única, con el mismo Stack en todos los anchos: volver, ubicación configurada, estado principal y menú. Contrato visible en compacto; en desktop permanece en la barra lateral. Nombre/correo de cuenta y acceso secundario a Diagnóstico pasan al menú existente. Se mantienen el título semántico del contenido y los títulos configurados de Etapa 1.
- El menú de cuenta reúne Inicio/categorías asignadas, contexto/selector de contrato, Diagnóstico y cerrar sesión. Se presenta abajo en teléfono y alineado a la derecha en tablet/desktop; contenido desplazable, controles de 44 px y cierre/foco de Modal. Desktop conserva su navegación lateral y evita repetir sus categorías en el menú. Se reutilizan catálogo con scope, CompactSelect, rutas y handlers de sesión; no hay otro fetch de navegación.
- Categorías de Inicio utilizables también en compacto, filtradas por asignaciones existentes. Se retira el bloque organizacional repetido cuando ya hay contrato válido, conservando selección/errores sin contexto. Tablet usa dos columnas si caben tarjetas de al menos 260 px; se respeta el ancho medido. La adaptación es de composición, no una detección de capacidad física del dispositivo.
- Un indicador abre el Diagnóstico existente. «Sin operaciones en curso» es neutral: no acredita ACK, cobertura ni frescura. Se conservan guardado local, envío, ACK y actividad de lectura/preparación; fallos de envío y conflictos conocidos tienen texto específico. El envío RECORDS se representa con su `syncingCount` existente del usuario/contrato; el diagnóstico visual usa esa misma señal. No se modifica el motor ni se deducen éxitos de conectividad. Las barras/acciones locales RECORDS conservan su alcance, cobertura y herramientas de recuperación, diferentes del indicador global.

No se mueven formularios, filtros ni acciones de negocio. No se añaden confirmaciones, defaults, permisos, áreas permanentes ni una barra inferior superpuesta. Efectos de shell/Inicio/proveedor y handlers existentes idénticos por AST; sólo cambia el memo de presentación del envío/diagnóstico. Renderers, búsquedas, command/base/autorización/clientRequestId, preparación, sync, API, paquetes y SQLite/OPFS permanecen fuera del delta.

Evidencia e inventario incremental: `backups/ux-ui-stage2/2026-11-08/REVIEW.md`. Chrome 153 Linux headless real, renderers exportados reales y OPFS, con API y registros sintéticos; 390/768/1024/1440, teclado, foco, touch CDP, contexto/edición y estados. Cierre completo y reapertura offline del mismo perfil conservaron payload íntegro e identidad de un pendiente; integridad SQLite `ok`, un ACK simulado al reconectar. No acredita Core real ni tiempos productivos. Las capturas antes/después corresponden a aplicaciones reales, no bocetos.

Se conservan los controles de ensayos no concluyentes y sus límites en REVIEW: lecturas concurrentes observadas sin atribución causal al resize, y transporte PATCH incompleto de un arnés adicional corregido sólo en el fixture. No se cambió la política de actualización para obtener menos lecturas. Safari/iPhone/Android físicos, native, lectores de pantalla y validación de usuarios siguen pendientes; no se declara accesibilidad completa ni estabilidad offline general. Recomendación: revisión visual del lote y después primitivas visuales/formularios en otro lote; tablas móviles y tema oscuro aún pendientes.

<a id="revision-visual-etapa3"></a>

## Revisión visual y preparación de Etapa 3 — 08-11-2026

**Sólo revisión y planificación; Etapa 3 NO IMPLEMENTADA.** Se mantienen las implementaciones locales y respaldos de etapas 1/2, sin autorizar su publicación. La numeración vigente es Etapa 1 claridad/accesibilidad, Etapa 2 navegación/organización, Etapa 3 componentes de contenido/formularios. El plan inicial tenía otra distribución; sus secciones se conservan como historial.

### Evidencia efectivamente inspeccionada

Se abrieron mediante visor de imágenes **las 52 PNG de Etapa 2 y las 19 de Etapa 1: 71/71**, no sólo sus índices o informes. Hashes de ambos respaldos verificados. Etapa 2: 20 pares antes/después —Inicio, RECORDS, Attendance, STATE_UPDATE y PANEL en 390/768/1024/1440— y 12 capturas de menú/categoría, preparación, envío, conflicto, error y reapertura. Etapa 1: cuatro pares Attendance/confirmación en 390/1440 y once imágenes de formularios, login, selección múltiple, rechazo, STATE_UPDATE y foco. Catálogo y huellas de esta inspección: `backups/ux-ui-stage3-review/2026-11-08/visual-review.json`.

La evidencia corresponde a Chromium Linux, aplicaciones exportadas reales y datos/API sintéticos. Esta ejecución no abrió navegador ni creó fixtures. Las capturas permiten evaluar composición, texto, foco visible y estados capturados; no prueban la experiencia física, foco/teclado en movimiento, permisos, tiempos productivos, lectores de pantalla, cámara, Core ni sincronización real. Se conserva separada la evidencia funcional previa de OPFS. No hay capturas REPORT, MATRIX, filtros PANEL extensos, tablas con muchas columnas, catálogos largos ni una lista RECORDS online poblada comparable antes/después: su evaluación aquí es de código o un riesgo por validar, no un defecto visual acreditado en esos casos.

### Comparación y decisión sobre etapas 1/2

| Superficie y capturas inspeccionadas | Mejora visual demostrada | Qué permanece / decisión |
| --- | --- | --- |
| E1 `before/after-attendance-{390,1440}` | Nombre configurado como título, etiqueta de búsqueda, obligatoriedad explícita y observación existente visible. Crear/actualizar se distingue mejor. | El título largo ocupa más altura en móvil; no retirar etiquetas útiles para aparentar menor densidad. Los contextos y la observación siguen necesitando mejor composición. |
| E1 `before/after-confirmation-{390,1440}`; `after-rejection-390` | Se entiende que se corrige el mismo registro y qué observación cambia aunque Actual/Solicitado tengan el mismo estado. Rechazo legible y edición recuperable. | El modal es más alto, pero la información adicional aporta seguridad. Conservar contenido del comando capturado y decisiones; no regresar al diálogo breve ambiguo ni ocultar los datos sin cambios sólo para acortarlo. |
| E2 `before/after-home-{390,768,1024,1440}` | Contrato/ubicación más claros; desaparece el bloque organizacional repetido. Dos tarjetas de flujos en tablet aprovechan el ancho. Cabecera de Inicio 390: 129→104 px, según medición archivada. | Badges de tipo repiten información de las categorías. La muestra tiene cuatro experiencias: el espacio restante no demuestra desperdicio con el catálogo real de trece. No rellenarlo con widgets inventados. |
| E2 `before/after-ux-att-*` | El contexto de navegación permanece visible sin la fila separada de cuenta. En 768, cabecera 137→61 px; en 390 con título largo 137→124: mejora más limitada. | Mucha altura antes de buscar; fecha/resumen/contextos se fragmentan. En desktop SELECT ocupa la fila y RELATION queda en una tarjeta pequeña dentro de otra, con espacio lateral vacío. Prioridad alta para contenido, no otra navegación. |
| E2 `before/after-ux-state-*`; E1 `after-state-update-*` | El shell es más claro; las dos columnas desktop existentes funcionan en esta muestra. | Tarjeta por campo y tarjetas anidadas en móvil. A 768 aún se estiran campos en una columna. El booleano lleno «Sí» parece una acción primaria. Actual y valor editable cumplen funciones diferentes y deben conservarse. |
| E2 `before/after-ux-records-*`; E1 `after-form-{390,1440}` | Título configurado, etiqueta de búsqueda y estados de copia conservados. | Buscador de lista ocupa casi todo el desktop y aleja Crear. Formulario de 1440 sigue en una columna con tarjetas por campo, sin aprovechar el espacio; Guardar queda al final de una página larga. La lista vacía no permite juzgar tablas/listas grandes. |
| E2 `before/after-ux-panel-*` | Ubicación y estado del shell más legibles; la tabla de dos columnas cabe en 390. | Buscador sin borde parece texto; paginación muy lejos de la única fila; mucho espacio dentro del módulo. No se observó overflow de página en esta muestra, ni se acredita adaptación de muchas columnas. El alto tiene origen configurado: no ignorarlo. |
| E2 `after-menu-{390,768,1024,1440}` y `after-category-390` | Navegación/contexto/cuenta tienen secciones reconocibles y un solo nivel de menú; Inicio/categorías accesibles en compacto. Cierre con foco visible. | Contrato se repite en sidebar y menú abierto desktop, de bajo impacto. Icono de menú sin texto visible requiere aceptación con usuarios; no añadir otro menú/bottom bar sin necesidad. No cambiar Etapa 2 en esta revisión. |
| E2 envío/offline/conflicto/error/diagnóstico | Texto distingue guardado local, pendiente, envío y conflicto. «Sin operaciones en curso» evita un falso ACK. Reintentar y Revisar conflicto están próximos al problema. | Frase larga de estado puede dejar el icono solo en una línea; conflicto repite literalmente su mensaje en rojo y en el aviso. Cabecera, badge del registro y error de lectura expresan scopes diferentes: no eliminarlos indiscriminadamente. |
| E1 `after-login-{390,1440}`, MULTISELECT y sidebar con foco | Etiquetas, selección marcada y foco visibles. Popup MULTISELECT encaja en el 390 capturado. | Login se estira excesivamente en desktop y muestra detalles técnicos permanentemente. No hay prueba de textos largos en opciones ni de teclado virtual; no declarar resuelto el recorte histórico de SELECT. |

**Conclusión visual:** conservar etapas 1/2 como base. Hay mejoras de orientación y comprensión verificables, pero el resultado aún no es un rediseño integral de los contenidos. La siguiente ganancia debe venir de distribución y jerarquía, sin retirar información o recuperación necesaria. El aspecto más compacto no demuestra por sí solo menos pasos ni mejor usabilidad.

### Hallazgos vinculados al código actual

| Hallazgo / prioridad | Responsable y evidencia | Adaptación propuesta / límite |
| --- | --- | --- |
| Tarjeta por campo y fragmentación — P1 | `RecordFieldInput`/`RelationFieldInput`, `styles.fieldGroup` en `records/RecordFieldInput.tsx`: borde y padding 14 compartidos por cada tipo. `RecordFormScreen` mapea campos en una única columna. `StateFieldInput` añade wrappers propios. | Campo sin superficie individual dentro de una sección común. Conservar borde del control, etiqueta, ayuda/error y asociaciones. Migración optativa por consumidor, sin cambiar de golpe todos los usos de RecordFieldInput. |
| Contextos desproporcionados — P1 | `AttendanceContextSelectors` dentro de `AttendanceWorkflow.tsx`: SELECT propio frente a RELATION vía RecordFieldInput. Fecha/resumen y contextBlock se componen por separado. | Una sección de contexto con wrap, tamaños útiles para fecha/SELECT/RELATION. Mantener orden antes del buscador, contexto entre registros, validación al confirmar y todos los handlers. No confundirlo con identidad compuesta STATE_UPDATE. |
| Booleano parece botón de guardar — P1 | Rama BOOLEAN de `RecordFieldInput` y `StateFieldInput`: Pressable con semántica checkbox, pero superficie llena y texto Sí/No. Capturas E1/E2. | Marca de checkbox reconocible y texto de estado, mismos valores/onChange/rol. No convertir un valor ausente a false al montar ni agregar un default. |
| Conflicto duplicado — P1 | `RecordDetailScreen`: `record.syncErrorMessage` y `conflictBanner` repiten el mismo texto en la captura. | Un aviso local con contexto y acción existente. Suprimir únicamente la repetición comprobada de la misma causa; conservar errores distintos, versiones y navegación a resolver. |
| Búsquedas con apariencia distinta — P1 | `RecordsRenderer` toolbar; búsqueda Attendance/STATE_UPDATE; `PanelModule`/`ReportRenderer`. `PanelRenderer.styles.searchInput` sólo tiene marginBottom, sin borde/padding. | Presentación SearchField común: etiqueta, borde, foco, ancho máximo inicial 560 px y slots para acciones existentes. Los callers conservan debounce, criterio global/dirigido, scopes y callbacks; lector intacto. |
| Detalle con exceso de tarjetas — P2 | `RecordDetailScreen.getRecordDetailFields` → `styles.fieldRow`; E2 capturas offline/conflicto/error. | Lista etiqueta/valor con separadores discretos; todas las propiedades visibles/permitidas y etiquetas se conservan. Reutilizar formatters actuales; no mostrar IDs para rellenar un label ausente. |
| Dos Volver — P2, verificar antes de consolidar | Global `goBack` en shell usa back con fallback Inicio; RecordForm/RecordDetail usan `router.back()`. Se ven ambos en el detalle. | Coinciden cuando hay historia, pero sus caminos sin historia no son idénticos. No eliminarlos por apariencia. Comparar navegación/deep link/abandono de borrador antes de decidir un único acceso contextual. Mantenerlo fuera del primer lote. |
| Paginación lejos y alto del PANEL — P2 | `PanelTable` tiene viewport flexible; `buildPanelModuleLayoutPlan` usa `layout.h × rowHeight`, altura desktop y mínimo móvil. Fixture con módulo de seis filas. | Acercar controles de página al contenido dentro del módulo si se conserva su área/scroll. No reducir h, reemplazar el layout configurado por autoaltura ni alterar Core como arreglo visual. Si hace falta cambiar ese contrato, separar y solicitar autorización. |
| Texto truncable en tablas — riesgo P2 | `PanelTable` usa `numberOfLines=1`; REPORT usa celdas de ancho fijo y scroll horizontal. | Vista de lectura adaptable para TABLE conservando cada columna/valor/orden; valores completos sin depender de hover. Es riesgo estático: las capturas sólo muestran dos columnas y textos cortos. MATRIX conserva ejes y scroll contenido. |
| Colores/acciones no uniformes — P2 | `desktopPalette`/`desktopStyleColors`, `visual-stability.ts`; estilos locales teal y grises de PANEL/RECORDS. | Tokens semánticos adoptados sólo por componentes migrados, no reemplazo global de cadenas ni tema universal. No añadir tema oscuro en el primer lote. Mantener error/conflicto/pendiente diferenciados con texto, no sólo color. |
| Detalles técnicos y verbos — P2 | Login estirado con namespace/bundle y «Cliente genérico móvil»; badge Panel/Flujo; acciones de estado con texto de longitud desigual. | Login con ancho acotado en lote posterior, información técnica accesible también sin autenticar. Textos de acción derivados de la operación/configuración, sin inventar significado para A/B o campos concretos. No retirar herramientas que permiten identificar el runtime. |

RELATION busca y pagina un catálogo; su selector elige entre opciones disponibles. Son funciones complementarias. El botón Sincronizar RECORDS invoca `synchronizeRecords` y existe por pendientes, incluso en el offline capturado: su presencia no acredita envío posible. No cambiar sus condiciones/handler o prometer una cola nueva en un lote visual. El estado global y la cobertura local tampoco son equivalentes. En la captura reconectada con cero filas, la API era sintética: no concluir pérdida de datos o aceptación de Core a partir de esa imagen.

### Sistema mínimo de componentes compartidos — propuesto, no creado

Los componentes de presentación reciben valores, acciones y estados de sus consumidores; no consultan API/SQLite, normalizan datos, calculan permisos, eligen identidad ni resuelven conflictos.

| Pieza / reutilización | Contrato visual mínimo | Archivos de adopción previstos |
| --- | --- | --- |
| `FormLayout` / `FormSection` | Ancho útil medido, wrap, slots con clave estable y `fullWidth`. Columna simple en móvil; dos sólo si caben campos útiles. Reutilizar la estructura de `StateUpdateFormGrid`, conservando su wrapper/API durante migración. | Nuevo `components/form-layout.tsx`; RecordFormScreen; posteriormente StateUpdateFormGrid y contexto Attendance. |
| `FieldFrame` | Etiqueta persistente, control, ayuda y error; variante plain/boxed optativa. Reutilizar **una sola** instancia de `useFieldAccessibility` por control y sus IDs, sin generar asociaciones paralelas. | Nuevo `components/field-frame.tsx` o junto a FormLayout; RecordFieldInput y, después, StateFieldInput/PanelFilters. |
| `ActionButton` / `ActionRow` | Primaria, secundaria, recuperación/destructiva según acción ya existente; busy/disabled y nombre accesible aportados por caller; ancho natural desktop y wrap táctil. No interpretar el resultado del comando. | Nuevo `components/actions.tsx`; primera adopción en RecordFormScreen, siguientes por superficie. |
| SearchField / toolbar | TextInput existente con etiqueta, foco y límite de ancho; lector/acción como slots. Sin debounce ni extracción nueva; no unir todos los motores de búsqueda. | `components/search-field.tsx`; RecordsRenderer, workflows y módulos TABLE por lotes separados. |
| `InlineNotice` | Mensaje con alcance, severidad y acción existente, con región accesible apropiada. No inventa eventos ni éxitos; conserva copia válida y distingue actualización fallida. | `components/inline-notice.tsx`; RecordDetailScreen primero; avisos de otros renderers sólo tras contrastar sus causas. Reutilizar ReadLoadingState para cargas. |
| Lectura de campos/filas | Valores ya formateados/autorizados con fieldId/rowId y orden; lista etiqueta/valor móvil y columnas cuando quepan. Reutilizar SubjectIdentity y StateUpdateReadRows, sin convertir sus resultados en un modelo de registros nuevo. | RecordDetailScreen; después `components/read-only-rows.tsx` para TABLE PANEL/REPORT. `entity-record-display`, `buildPanelTableModel`, `buildReportTableModel` y `displayPanelValue` mantienen interpretación actual. |
| PageControls / filtros | Controles sólo visuales con página/hasMore/disabled/acciones suministrados; filtros usan controles existentes con valores controlados. No aplica ni limpia filtros por sí mismo. | Tabla PANEL y REPORT sólo donde actualmente corresponda. PeriodControl de REPORT conserva mes/rango; PanelFilters conserva filtros tipados. |
| Tokens mínimos existentes | Fuente de sistema, escala 4/8/12/16/24/32, input 16 y acción 44 como punto de partida; medir contraste efectivo. Extender roles desde desktopPalette/visual-stability de manera local. | `lib/desktop-presentation.ts`, `lib/visual-stability.ts` o módulo de tokens aditivo; sin cambiar toda la app ni bibliotecas. |

**Se reutilizan sin reemplazo funcional:** CompactSelect simple/múltiple; Date/Time/DateTimeFieldInput; RecordFieldInput/RelationFieldInput y servicios de catálogo; CodeReader; SubjectIdentity; AppIcon/registro de iconos; KeyboardFocusStyles/useFieldAccessibility; ReadLoadingState; comparadores y formatters ya existentes. Los iconos iguales de estas capturas son fallback de fixtures sin icono; no demuestran que falten iconos configurados en producción.

No crear un megacomponente que gestione el ciclo completo de todos los renderers. No extraer controladores, efectos, búsqueda o persistencia como efecto secundario de consolidar estilos. Campos y orden siguen EntityField/configuración de Core, `showInList` y visibilidad/permiso efectivos; no reglas por nombre/contrato.

### Plan incremental recomendado

| Lote futuro | Alcance concreto | Condición para continuar |
| --- | --- | --- |
| **3A — primero** | FormLayout/FieldFrame y apariencia de acciones; RecordFormScreen como primer consumidor. Variante sin tarjeta por campo **optativa**, legacy por defecto para consumidores aún no migrados. BOOLEAN reconocible con el mismo handler. Dos columnas según área útil; textarea/ayudas/errores largos completos. | Misma selección y validación tipada, mismos IDs/valores/payloads/onBlur/guardado; sin cambios en Attendance, STATE_UPDATE, PANEL ni shell por compartir RecordFieldInput. Revisar captura equivalente antes de migrar otros consumidores. |
| 3B — workflows | Adoptar sección de contexto coherente en Attendance; grilla y campos sin tarjetas en STATE_UPDATE. Conservar resultados, sujeto seleccionado, todos sus extras/acciones y confirmación de E1. | Contexto antes de buscar, persistencia entre registros, identidad intacta, corrección/conflicto y resize sin reset ni nuevas lecturas. No imponer fecha ni turno a modos que no los usan. |
| 3C — lectura y recuperación | RecordDetailScreen con valores ordenados y un aviso por causa; buscador RECORDS acotado y Crear junto a la cabecera del contenido. | No confundir error de lectura con fallo de escritura ni esconder conflictos. Comparar ambos Volver antes de consolidar. Mantener acciones de recuperación y cobertura local. |
| 3D — consultas, separado | SearchField/filtros, TABLE responsive y PageControls en PANEL; después REPORT TABLE. Valores completos y mismo conjunto de columnas; respetar área configurada del módulo. | Fixture equivalente con muchas columnas, textos largos y paginación. MATRIX/KPI/mes/rango conservados hasta tener evidencia específica; no cambiar su semántica ni preparar resultados automáticamente. |
| 3E — posteriores | Login acotado, detalle técnico bajo demanda accesible sin login, revisión de vocabulario e iconos opcionales. Tema oscuro como lote independiente. | Mantener acceso a diagnóstico/runtime y auth. Evaluación de usuarios/dispositivos antes de otra revisión de navegación. |

**Única siguiente implementación recomendada: 3A**, después de autorización. No implementar de una vez toda la tabla anterior. Anchos iniciales para prototipo: formulario operativo máximo 960 px, campo mínimo aproximado 280–320 para permitir dos columnas cuando quepan, búsqueda máximo 560, login posterior máximo 480. Son objetivos de composición a validar, no reglas de campos o de dispositivo. Mantener un solo árbol y orden DOM, sin duplicar inputs para obtener otra disposición; usar wrap y ancho real del contenido.

### Riesgos y aceptación verificable antes de aprobar cada lote

| Riesgo / garantía | Criterio comprobable en el lote que la afecte |
| --- | --- |
| Menor altura a costa de claridad | Etiquetas, obligatoriedad, ayuda, errores y todos los valores siguen visibles. Un único contorno de sección y borde de control; sin tarjeta individual por campo en la variante migrada. Guardar/confirmar conserva su descripción; no recortar el modal de corrección por contar menos elementos. |
| Responsive y textos largos | Capturas comparables 390/768/1024/1440 y límites existentes; 320/zoom 200% en aceptación accesible. Sin overflow de página; filas/controles envuelven y texto completo disponible por acción explícita si no cabe. No ocultar columnas para que parezca que cabe. |
| Valores/editabilidad | Misma cantidad/orden de campos admitidos y mismos required/disabled/errores. DATE continúa YYYY-MM-DD sin UTC; TIME/DATETIME y límites Attendance intactos. No confundir formato nativo dependiente del navegador con un cambio de fecha almacenada. |
| Tipos e identidad | SELECT usa el contrato actual de estado/extra; múltiples conservan todos los valores, ceros e IDs. RELATION simple/múltiple conserva IDs y etiquetas; ausente/no disponible distinto de vacío, sin nueva descarga completa. No exponer ID como label. |
| Formulario/draft | Tab/Shift+Tab/Enter/Space/Escape, foco/etiquetas/error anunciables; objetivos táctiles al menos 44 según diseño. Cambiar ancho no desmonta controles, pierde selección/borrador o dispara solicitudes. No ordenar por columnas de manera que cambie el orden de teclado. |
| Escritura y confirmación | Comparar comandos/handlers antes/después: mismo clientRequestId, base, autorización, contexto y valores. Confirmar/cancelar/error, observación sola y conflictos siguen igual. No inferir éxito del spinner o de estar online. |
| Offline y scope | En implementación, reutilizar evidencia válida o comparar guardado offline→cierre/reapertura→reconexión, payload íntegro e identidad sin duplicados. Scopes usuario/contrato/AppView/contexto intactos; no mezclar cobertura/frescura o snapshot exacto/colección completa. Ninguna nueva cola/caché. |
| Lectura y paginación | Mismas filas, columnas, orden, filtros, conteos y página/tamaño que antes. Renderizar TABLE como lista no vuelve a consultar ni filtra después de paginar. Cambiar disposición no modifica la clave del snapshot PANEL. MATRIX no se aplana a tarjetas perdiendo ejes. |
| Mensajes y recuperación | En conflicto, una sola repetición del mismo mensaje local, manteniendo acción y ambas versiones. Mensajes globales y por registro se conservan si representan scopes distintos. Error remoto no oculta copia local ni se presenta como fallo del guardado local. |
| Layout configurado | PANEL conserva h/w/posición/orden; primero acercar controles internos y mejorar lectura. Una reducción del área configurada exige propuesta separada, no se da por autorizada. |
| Reutilización invasiva | Variante optativa conserva el default de todos los consumidores no migrados. Sin efectos nuevos en componentes de diseño, sin fetch por fila, sin callbacks a onChange al montar/medir. Medir llamadas al redimensionar y comparar bytes del outbox. |
| Calidad y evidencia | Regresiones funcionales afectadas, typecheck/lint/build/diff-check en la implementación; no tests que sólo copien estilos. Capturas reales del mismo fixture/estado, muestras vacías y pobladas. Contraste medido, lectores de pantalla y Safari físico acreditados sólo tras probarlos. Los errores previos de lint/arneses permanecen separados. |

Esta revisión no ejecuta los criterios: define la aceptación futura. No hay nuevo resultado de pruebas, build, navegador, OPFS ni validación productiva; no se reabre la auditoría offline o V11. Las etapas 1/2 y sus hashes funcionales permanecen intactos.

<a id="etapa-3a-formularios"></a>

## Etapa 3A — formularios RECORDS, implementación local 08-11-2026

Lote incremental y reversible sobre etapas 1/2 y la revisión visual; **sin publicar**. La adopción se limita a `RecordFormScreen`. `RecordFieldInput.presentation="form"` es optativa y su default `legacy` mantiene los usos de Attendance, STATE_UPDATE, PANEL y otros consumidores. Ninguno de esos renderers se migra en este lote.

| Componente / archivo | Comportamiento visual |
| --- | --- |
| `components/form-layout.tsx`: FormLayout/FormGrid | Formulario máximo 960 px, una sección común y slots con claves estables. Dos columnas cuando el ancho interior medido alcanza 600 px; TEXTAREA/DATETIME ocupan fila completa. Mismo árbol en todos los anchos, sin efectos de datos. |
| `components/field-frame.tsx`: FieldFrame | Etiqueta, obligatoriedad, descripción opcional y error asociados a los IDs aportados por el caller. Foco en etiqueta y control; error visible, estado visual disabled. El bloqueo efectivo del control sigue perteneciendo al caller; el Frame no sustituye permisos ni cambia eventos. |
| `components/form-actions.tsx`: FormAction/FormActions | Acciones agrupadas al final, alineadas a la derecha y con wrap; primaria/secundaria, mínimo 44 px, busy/disabled y nombres accesibles. Sin barra flotante ni invocaciones automáticas. |
| `records/RecordFieldInput.tsx` | Sólo la variante form retira tarjetas por campo y muestra BOOLEAN como checkbox reconocible. CompactSelect, fechas/horas, errores de catálogo, cardinalidad, búsqueda de relaciones y ayudas existentes se reutilizan. No se inventa descripción desde metadata nueva. |
| `records/RecordFormScreen.tsx` | Activa la variante, compone slots con `field.key` conservada y reutiliza los mismos handlers de guardar, volver y reintentar. Ningún campo/default/validación nueva. |

Comparación por AST: efectos/memos y funciones de negocio idénticos en los dos archivos de adopción; 34 atributos controlados/eventos de RecordFieldInput y siete de RecordFormScreen sin cambios. FormGrid sólo mide ancho; FieldFrame sólo pinta foco. No cambia valores, displayName, fieldId/key, opción canónica, contexto, payload, autorización/base/idempotencia, servicios RELATION, API, esquema, paquetes, almacenamiento o sincronización.

**Evidencia nueva:** mismo fixture sintético en el export anterior y candidato, renderers reales Chrome 153 Linux/OPFS. Capturas 390/768/1024/1440: en tablet/desktop el formulario aprovecha dos columnas y las acciones caben en el mismo cuadro del fixture; móvil sigue desplazable con campos completos, sin pretender comprimir toda una definición en una pantalla. También se comprobaron 320 y límites 899/900/1199/1200: mismos nodos, valores y foco, cero solicitudes durante resize. DATETIME conservó una fecha parcial antes de completar la hora. Espacio cambia BOOLEAN una sola vez; MULTISELECT conserva ambas opciones y cierra con Escape. Validación required muestra tres errores del fixture sin escribir.

Antes y después generan exactamente la misma huella de valores canónicos. Ambos perfiles propios se cerraron completamente y reabrieron offline: intención y payload conservados, formulario de edición con TEXT/DATE/SELECT/RELATION/BOOLEAN/MULTISELECT/DATETIME restaurados, SQLite integrity `ok`. Reconexión: un POST/ACK **simulado**, mismo clientRequestId y ningún duplicado. No se acredita aceptación Core/productiva ni se borró almacenamiento para aprobar el ensayo.

Checks: **212/212** focalizadas (incluyendo SELECT, RELATION ONE/MANY, valores no disponibles, accesibilidad, formulario, persistencia/sync y consumidores legacy); typecheck, lint afectado, build habitual y diff-check PASS. Lint global ejecutado: dos errores anteriores de Buffer en `design/validation/opfs-lifecycle-diagnosis-2026-10-26/reproduce.mjs` y seis warnings ajenos, intactos. Revisión ampliada de consumidores: 37/39; dos asserts de cabecera anteriores a Etapa 2 fallan también sobre la base local aislada sin 3A. No se atribuyen a HEAD publicado ni se cambian en este lote. La aserción afectada que exigía un spinner inline se actualiza para comprobar la señal busy/onPress del botón compartido; su render accesible se prueba aparte. No suite completa. Artefacto final `entry-8fed24805e392da8da2ebf0f3f5e0b81.js`, API pública y epoch2 correctos, index/sw y lector JS/WASM locales verificados.

Se conserva un ensayo inicial que falló al comparar la huella del pendiente al reabrir, antes de instrumentar propiedades. El primer corte tenía tres claves de payload; los controles instrumentados muestran además `lastErrorDetails`/`lastErrorHttpStatus` nulos, escritos por el tratamiento de error/reintento existente (`setOperationError`), y acreditan valores/identidad idénticos antes/después. Esa mutabilidad diagnóstica no equivale a cambiar el comando. No se dispone de comparación por propiedad del primer corte ni se atribuye una causa única a él; registro preservado y sin cambio de motor para lograr PASS. También se corrigieron el tipo readonly de una prueba nueva y la exposición explícita aria-busy del botón nuevo, detectada por su regresión.

Informe, inventario/parche incremental, base reconstruible, hashes y capturas en `backups/ux-ui-stage3a/2026-11-08/`. Las fuentes ajenas, 402 exclusiones, etapas 1/2 y respaldos permanecen conservados; en los archivos compartidos se añade únicamente la variante y su adopción autorizada. Documentos anteriores conservados por prefijo; no commit/push/deploy ni producción. Safari/iPhone/Android físicos, native, lector de pantalla, textos/catálogos muy extensos y teclado virtual quedan sin acreditar; no estabilidad offline general. Recomendación: revisar las comparaciones y luego Etapa 3B por separado para contextos/formularios de workflows, conservando sus reglas y confirmaciones.

### Ajustes finales de 3A — RELATION e indicadores, 08-11-2026

Dentro del mismo lote 3A: la variante `presentation="form"` distingue **Buscar opciones** de **Selección actual**, con etiquetas visibles y asociaciones accesibles que incluyen el nombre del campo. ONE/MANY conservan selección, IDs, errores, búsqueda, carga de más opciones y limpieza existentes. El texto buscado no se presenta como selección. `CompactSelect.indicatorPlacement="end"` separa el resumen de una flecha decorativa a la derecha; SELECT web conserva el control nativo y su flecha derecha. Optativo desde RecordFieldInput: el default de otros workflows sigue intacto. Sin cambios en handlers, valores, cardinalidad ni comandos; AST verifica también 21 atributos controlados/eventos del selector compartido.

242/242 pruebas afectadas (239 de controles/formulario/persistencia/sync/consumidores y tres de contextos Attendance); regresiones nuevas de etiquetas ONE/MANY RED→GREEN y de resumen accesible/indicador decorativo. Typecheck, lint afectado, build y diff-check PASS. Se reutilizan los límites ya documentados de lint global y los dos asserts de shell de Etapa 2: no se han corregido ni se declara suite completa aprobada. Artefacto final `entry-77746a2e980acddab1fc7b7d6ee67b35.js`; API pública, epoch2, referencias index/sw y lector local JS/WASM verificados.

Comparaciones del export previo de 3A y el ajustado, mismo fixture sintético ampliado con RELATION MANY: Chrome 153/OPFS reales a 390/768/1024/1440. Se conserva búsqueda «dos» mientras ONE selecciona «uno» y MANY mantiene ambos; limpieza opcional, teclado y modal sin recortes. Capturas del pie en viewport real 390×844 con ambos botones completos y margen inferior; capturas de contenido completo amplían **sólo la altura** y se identifican como tales, sin simular un dispositivo físico. Detalle después del guardado capturado ya cargado, tanto offline pendiente como online tras ACK sintético y navegación: el renderer de detalle no migrado aún muestra IDs RELATION, igual antes/después. No se corrige fuera del alcance.

Valores canónicos antes/después idénticos; guardado offline, cierre completo y reapertura del mismo perfil conservan payload/identidad por propiedad, todos los tipos y SQLite integrity `ok`; una escritura/ACK simulado al reconectar. Resize mantiene nodos/foco/valores y cero solicitudes. Un primer control falló por exigir un orden fijo de etiquetas MANY al reabrir: el payload era byte a byte idéntico y ambas etiquetas estaban presentes en otro orden de catálogo. Se conserva ese resultado; la comprobación corregida exige ambas etiquetas y mantiene íntegra la comparación estricta del payload. Sin cambios de motor, timeouts o almacenamiento para aprobar.

Respaldo separado e inmutable del anterior: `backups/ux-ui-stage3a-final-adjustments/2026-11-08/`, con delta de ajustes y parche/inventario 3A combinado reconstruibles. Etapas 1/2, respaldo 3A inicial, Core, 402 exclusiones y pendientes conservados. No adopción 3B ni publicación. API/cámara del dispositivo real, aceptación Core real, Safari físico/native y lectores de pantalla siguen sin acreditar. DATETIME y detalle permanecen con su presentación previa; no se eliminan sus acciones.

<a id="etapa-3b-attendance"></a>

## Etapa 3B — contextos Attendance, implementación local 08-11-2026

Adopción acotada a `AttendanceContextSelectors`: FormLayout/FormGrid con claves de campo estables, FieldFrame para SELECT y RecordFieldInput variante form para RELATION. `FormGrid.appearance="plain"` evita un segundo contorno dentro del bloque desktop existente; su default section conserva RECORDS 3A. Una columna en móvil, dos con ancho interior suficiente, máximo delimitado por el contenedor existente. Labels/required/error junto al control, búsqueda y selección de relación separadas, sin tarjeta por campo. Fecha, resumen, buscador/lector, sujeto seleccionado, acciones y confirmaciones no se rediseñan.

Sólo cambia composición: mismos handlers, funciones de negocio, efectos/memos y 36 atributos controlados/eventos en Attendance. SELECT recuerda optionId y envía el valor canónico; RELATION conserva ID/label y servicios de catálogo/búsqueda/páginas. Contexto antes de buscar; búsqueda no bloqueada por obligatorios, validados al registrar/confirmar. Se conserva contexto entre sujetos, cambio para nuevos registros y restauración del contexto propio al editar. La capacidad actual es SELECT simple/RELATION ONE (incluyendo lectura histórica ONE/true); **MANY no se habilita**. Sin Core/API/esquema/SQLite/outbox/namespace/identidad/fecha/turno/sync/configuración.

Chromium153/OPFS reales, mismo fixture sintético antes/después a390/768/1024/1440: pares de contexto, sujeto seleccionado y confirmación; etiquetas alineadas, sin overflow. Cancelación conserva borrador; corrección B mantiene fila/base original; nuevas capturas A/B conservan contexto y el cambio posterior no altera anteriores. Guardado offline→cierre completo→reapertura del mismo perfil conserva contexto, intención/payload/clientRequestId e integridad SQLite `ok`; reconexión con un ACK simulado y pendiente cero. Resize conserva nodos/valores/foco y cero solicitudes. Tab/Shift+Tab, SELECT nativo por teclado y B mediante touch CDP; no prueba física. Mismas huellas de comandos online y de replay antes/después, excluyendo sólo claves aleatorias al comparar perfiles distintos. Transporte/estado remoto sintéticos, no aceptación Core real. Cobertura del día parcial explícita en el fixture; no se certifica preparación completa.

Checks: ampliada196/218, con22 fallos también presentes en el control HEAD archivado de Etapa1, sin nombres nuevos y con handlers idénticos a la base local inicial. Se conservan esos RED; no se declara suite completa ni aprobación global. Contextos finales4/4 y servicios RELATION4/4 PASS. Typecheck/build/diff-check PASS; lint afectado sin errores y con un warning de dependencia useCallback ya presente, fuera de la composición cambiada. Se corrigió el tipo de una prueba nueva, sin modificar contratos. Primer ensayo del arnés falló al buscar un href exacto antes de esperar navegación; el arnés pasó a esperar y resolver el pathname real, conservando el resultado previo y sin cambios de aplicación/timeouts/bases.

Artefacto `entry-0a2cdf8ea6e5db09842962a159484a09.js`: API pública, epoch2, index/sw y lector JS/WASM locales verificados. Respaldo incremental/reversible con base, hashes, parche, checks y capturas: `backups/ux-ui-stage3b/2026-11-08/`. No aplicar a HEAD desnudo: continúa etapas1/2/3A, cuyos respaldos se preservan. Core, 402 exclusiones y pendientes ajenos intactos; modificación compartida de FormGrid optativa. Sin producción, commit/push/deploy. Safari físico/native, lectores de pantalla y cámara no revalidados. Siguiente paso: revisar capturas; la adopción visual de STATE_UPDATE del plan general sigue siendo un lote separado, antes de ampliar a lectura/recuperación 3C. No se reabre V11 ni la auditoría offline.


<a id="etapa-3c-state-update"></a>

## Etapa 3C — STATE_UPDATE, implementación local 08-11-2026

Esta etapa usa la numeración solicitada para **STATE_UPDATE**; la propuesta anterior de detalle RECORDS no se ejecuta aquí. Lote incremental independiente sobre las etapas1/2/3A final/3B, sin publicar. Antes de modificar se inspeccionaron18 capturas archivadas de3B: contextos antes/después y seleccionado/confirmaciónB a390/768/1024/1440, required1440 y reapertura390. No aparece un bloqueo visual importante en ese fixture; móvil requiere desplazamiento, tablet distribuye contexto y desktop limita el ancho. Esa revisión no acredita dispositivos físicos.

| Adopción | Alcance y preservación |
| --- | --- |
| Contexto compuesto | FormLayout + FormGrid plain; fecha y SELECT de identidad en1/2/3 columnas por ancho interior, etiquetas obligatorias y asociación accesible. Sólo opta a3 columnas este contexto (820 px interiores); default compartido2 columnas desde600 intacto. No incorpora RELATION a la identidad compuesta ni cambia combinaciones. |
| Edición | StateUpdateFormGrid conserva su API y claves, delega a FormGrid plain. FieldFrame retira tarjetas por estado/fecha; RecordFieldInput form aplica la presentación3A a extras SELECT/MULTISELECT/RELATION ONE/MANY y demás tipos admitidos. Buscar opciones/Selección actual explícitos, flechas a derecha, BOOLEAN reconocible. |
| Acciones | FormActions/FormAction agrupan guardado y salida junto al editor; mismos handlers y busy/disabled. Crear/Actualizar registro y Registrar cambio conservan su modo. Cancelación local/revisión de horario y mensajes siguen disponibles. |
| Lectura | Resultados, últimas actualizaciones, búsqueda/lector, preparación automática y actividad de cabecera conservan sus componentes/efectos existentes. No nueva carga ni petición por medida/resize. |

Comparación AST contra la base3B:118 sentencias del workflow anteriores al render idénticas, efectos/memos y funciones de negocio intactos,61 atributos controlados/eventos sin cambios. El estado SELECT sigue usando optionId; los extras usan sus valores canónicos y fieldId/key existentes. No se inicializan BOOLEAN/DECIMAL ni se cambia vacío por falso/cero. Mismos comandos, bases, permisos, identidad, scopes, confirmaciones, outbox y sincronización; Core/API/paquetes/SQLite/OPFS/namespace no modificados. Los controles de contexto siguen bloqueados durante edición; se evita aplicar opacidad dos veces en Frame y control.

**Validación visual y funcional:** renderer real Chrome153 Linux a390/768/1024/1440, perfiles propios aislados y OPFS/SQLite/SW reales, API/estado remoto/ACK **sintéticos**. Comparación del export3B `entry-0a2cdf8ea6e5db09842962a159484a09.js` frente al final `entry-a9452278def97ee57ee774fc57fcf4f2.js`. Simple update-current, compuesto y append sin fecha: búsqueda/selección, required sin escritura, crear, corregir con base explícita, cancelar, proteger borrador al salir, valores cero/BOOLEAN/SELECT/MULTISELECT/RELATION. Huellas semánticas antes/después idénticas. Dos intenciones offline aisladas (simple/compuesto), cierre completo del proceso y reapertura offline del mismo perfil conservan payload/identidad/clientRequestId y controles; integrity_check=ok. Reconexión: exactamente dos ACK sintéticos correspondientes, pendientes0. Resize a los4 anchos y899/900/1199/1200 conserva nodos/valores/foco, sin nuevas solicitudes. Tab/Shift+Tab/Espacio y Enter/Escape en selectores, foco visible y pie real390×844 inspeccionados. Capturas de contenido completo amplían sólo altura y se identifican; no son maquetas ni cámara/dispositivo físico.

**Checks:**62/62 de campos/controles PASS, incluidos11 casos nuevos del StateFieldInput real aislado. Ampliada222/229: seis asserts de `state-update-conflict-handlers.test.ts` y uno de `state-update-schedule-handlers.test.ts` siguen RED y coinciden con el control HEAD archivado en etapa1; archivos de prueba idénticos y ninguna nueva falla por nombre. Typecheck, lint afectado sin errores/warnings, build habitual y diff-check PASS; no suite completa. Deuda global de lint previamente acreditada (dos Buffer y seis warnings ajenos), sin cambios ni repetición. Primer export retirado tras observar doble opacidad; se repitió build para la pintura corregida y todos los ensayos finales usan el bundle final. Artefacto: API pública efectiva, epoch2, referencias index/sw y lector localJS/WASM3.1.6 precacheado correctos.

Controles iniciales archivados: selector del arnés alcanzaba una pantalla Expo oculta; selección de contexto omitía fecha obligatoria; ACK compuesto sintético omitía identidad y fue rechazado correctamente con STATE_UPDATE_IDENTITY_MISMATCH. Sólo se corrigieron arnés/fixture y se conservaron esos resultados, sin retirar guards ni borrar bases para aprobar. La corrección visual propia elimina la doble opacidad del contexto bloqueado sin habilitar controles. El informe distingue cada caso.

**Límites:** diálogo de conflicto existente aún muestra IDs/JSON de RELATION en este fixture, también antes de3C; no se alteró su resolución/payload para ocultarlo. Definiciones/catálogos extensos y combinaciones de tipos no recorridas, contraste completo/lector de pantalla, Safari/iPhone/Android físicos/native/teclado virtual/cámara no acreditados. OPFS real con transporte simulado no equivale a aceptación Core ni sincronización productiva. No estabilidad offline general, publicación o activación. Próxima etapa: revisar tablas/filtros o presentación del diálogo de conflicto como lote separado, sin alterar su contrato.

Informe, inventario/parche/base reconstruible, hashes, comparación de comandos, capturas e incidencias del arnés en `backups/ux-ui-stage3c/2026-11-08/`. Base incluye las etapas locales previas: no aplicar directamente sobre HEAD desnudo ni preparar archivos completos con pendientes ajenos. Documentos anteriores conservados por prefijo; Core,402 exclusiones y demás pendientes preservados. Sin commit/push/deploy ni producción; V11 pausado.


<a id="state-update-conflictos-legibles"></a>

## Revisión3C y conflictos STATE_UPDATE — local 08-11-2026

Antes de cambiar código se completó la inspección de las42capturas3C:28 inspecciones previas reutilizadas por hash y14restantes revisadas ahora, registradas antes de modificar. Grilla/etiquetas/acciones legibles en390/768/1024/1440; móvil sigue desplazable, tablet aprovecha columnas, contexto1024 envuelve para evitar controles estrechos. No se considera mejora sólo reducir altura. Problemas concretos: conflicto mostraba IDs/JSON, procedencia poco clara y densidad móvil; required/Retry global y repetición de títulos son deuda previa separada. La revisión inicial está en el respaldo; no se alteran las etapas anteriores.

**Ajuste exclusivamente visual:** `state-update-conflict-presentation.ts` proyecta las filas ya calculadas por el comparador original; `state-update-conflict-values.tsx` presenta servidor y cambio local propuesto tanto en modal como lista durable. El contrato sólo tiene esas dos versiones: el cambio propuesto es la intención local capturada, no una tercera versión inventada. Servidor significa la versión recibida en el conflicto, también cuando se consulta offline, sin garantía de frescura posterior. Una nota distingue edición por confirmar/intención guardada en el dispositivo. Se conserva el mismo Cancelar/Confirmar cambio/Usar mi cambio/Usar Opco y sus handlers.

RELATIONONE/MANY: displayName del propio valor, etiquetas del mismo campo/snapshot en ambos lados y catálogo ya cargado por el servicio existente. Mantiene cada entrada/orden, incluso valores sin etiqueta, sin cambiar IDs/cardinalidad ni inferir equivalencias. SELECT usa optionId de estados y resolver canónico/procedencia existente de extras; MULTISELECT conserva todos sus valores. Ausencia/ambigüedad de etiqueta o metadata se comunica explícitamente; ID/valor técnico sólo secundario para localizar lo no resuelto. No JSON de objetos en el contenido principal, ni etiquetas inventadas. No crea consultas por fila ni escrituras/cache nuevas. Puede quedar sin resolver una etiqueta fuera del catálogo/página cargados; no se acredita que se haya leído todo el catálogo ni se activa red para presentarla.

Comparación por columnas cuando caben (base235 por lado), apilada en móvil, separadores discretos. Sólo este modal admite máximo620 también en tablet; otros modales conservan su ancho. Se consolidó una nota repetida tras inspección visual. Las listas largas se desplazan dentro del diálogo manteniendo acciones accesibles; foco visible original conservado.

**Preservación:**118sentencias anteriores al render, efectos/memos, funciones de negocio y61atributos controlados/eventos idénticos a3C. `buildStateUpdateConflictRows` y todos sus comparadores permanecen byteidénticos. El nuevo formateador no devuelve comandos ni interviene en autorización/base/clientRequestId/identidad/resolución. Sin Core/API/esquema/SQLite/OPFS/outbox/namespace/paquetes/sync ni tablas/filtros.

**Validación:** dos regresiones del modal real RED contra3C→GREEN;21/21casos finales de presentación con entradas congeladas, labels ONE/MANY, scopes por campo, ID/key, opciones ambiguas/antiguas, metadata ausente, múltiples, vacío/cero/falso y objetos desconocidos. Ampliada145/147: dos asserts antiguos de caracterización schema-v10 en `state-update-conflict-resolution.test.ts` fallan igualmente en base3C aislada; no cambios en ese archivo ni motor. Los siete RED de3C permanecen documentados y no se repitieron aquí. Typecheck/lint afectado/build habitual/diff-check PASS, no suite completa. Build final `entry-cfb175f0d6f1f1ce642bd48a4245b23d.js`: API pública, epoch2, index/sw y lector localJS/WASM precacheado conservados.

Chromium153 Linux, renderer/OPFS/SQLite/SW reales, API/ACK sintéticos. Mismo fixture antes/después: conflicto de creación y actualización, corrección explícita con misma fila/base, cancelar conserva borrador/intención, Tab no escapa y Escape cancela. 390/768/1024/1440 y resize sin nuevas solicitudes tras terminar la preparación automática existente. Replay offline conserva clientRequestId, conflicto durable, comando y ambas versiones; cierre completo y reapertura offline mismos hashes e integrity_check=ok. Abrir/cancelar resolución offline no reescribe la intención. No aceptación Core real ni prueba productiva/Safari físico/lector de pantalla; no estabilidad offline general.

Se conservan controles iniciales fallidos: import alias del arnés y tipo incompleto de fixture corregidos; búsqueda por código del sujeto ocultaba su conflicto según el filtro vigente y el arnés debió limpiar búsqueda; medición de resize coincidió con GET de preparación Attendance de otras fechas y se aisló esperando el diagnóstico terminal, sin desactivar preparación ni aumentar timeouts. Un ensayo reutilizó por error un perfil sintético previo y arrancó con conflictos ajenos al escenario; ese resultado no se usa como validación y el ensayo final parte de perfil propio nuevo. Sin borrar almacenamiento del usuario. Exports intermedios retirados por nota repetida, ancho tablet y protección de metadata SELECT ausente; sólo el final acredita este contenido.

Informe, inventario/parche/base reconstruible, revisión42capturas y comparaciones nuevas en `backups/ux-ui-conflict-presentation/2026-11-08/`. Etapas1/2/3A/3B/3C,402exclusiones y pendientes preservados. Sin commit/push/deploy ni producción. Siguiente3D: tablas/filtros como lote separado, conservando filas/columnas/operadores/paginación y claves de snapshots; no se implementa aquí. V11 pausado.


<a id="etapa-3d-diagnostico"></a>

## Etapa 3D — diagnóstico y propuesta de lectura, 08-11-2026

**Sólo revisión; ninguno de los tres lotes está implementado.** La numeración vigente es 3D.1 RECORDS/detalle → revisión → 3D.2 REPORT/PANEL/filtros → revisión → 3D.3 MATRIX/tablas extensas. Sustituye la secuencia orientativa anterior que llamaba3C al detalle RECORDS: la3C ejecutada fue STATE_UPDATE. Se conservan etapas1/2/3A/3B/3C y conflictos sin cambios.

### Evidencia y alcance de esta revisión

Se inspeccionaron14capturas archivadas reales: PANEL y RECORDS de etapa2 en390/768/1024/1440 (8); detalle online estabilizado de3A final en los4anchos (4); lista tras reapertura offline y reconexión de etapa2 a390 (2). Procedencia: `backups/ux-ui-stage2/2026-11-08/screenshots/INDEX.md`, export `entry-d5d58cb37be88a4e4c13ab82866c6aa1.js`; `backups/ux-ui-stage3a-final-adjustments/2026-11-08/screenshots/INDEX.md`, `entry-77746a2e980acddab1fc7b7d6ee67b35.js`. Chromium153 Linux, datos/API sintéticos, imágenes del renderer, no maquetas ni producción. Los cuatro archivos principales RecordsRenderer/RecordDetailScreen/PanelRenderer/entity-record-display coinciden con hashes archivados en3A final; esto acredita continuidad de esas fuentes, no identidad de todo el binario actual.

No hay en esas muestras REPORT/MATRIX, muchas columnas/textos largos, filtros PANEL extensos ni una colección RECORDS poblada online comparable. Sus hallazgos son estáticos o requisitos pendientes, no problemas visuales ya reproducidos. Una lista vacía no demuestra pérdida de registros; el regreso a cero filas del fixture sintético tras reconectar no se atribuye a una causa productiva. No nuevo navegador, fixtures, pruebas, typecheck/lint/build: esta etapa no cambia código. Sólo diff-check y conservación por hashes; los checks funcionales siguientes son **aceptación futura**, no PASS nuevos. No se reabre la auditoría offline.

### Mapa técnico y hallazgos

| Superficie / archivos y funciones | Evidencia / problema | Propuesta acotada |
| --- | --- | --- |
| RECORDS lista: `RecordsRenderer.tsx`, `RecordsListContent`, `loadMoreRecords`; `entity-record-display.ts`: `buildRecordListItem/getRecordListFields` | Buscador ya etiquetado por etapa1; se estira hasta todo el ancho en desktop. Las tarjetas usan `numberOfLines=1` para valores y columnas flexibles desde180: truncamiento posible por código, no acreditado con textos extensos. Paginación **Cargar más** ya está al final; no hay fallo demostrado de ubicación. Espacio vacío de colección0 es correcto, no requiere relleno visual. | Limitar buscador dentro del ancho disponible, Crear próximo al título/contenido. Filas legibles y valores completos, todas las columnas configuradas, mismo enlace/id/badge. Conservar Cargar más acumulativo25, búsqueda/debounce/orden/cobertura y condiciones de sync. |
| Detalle RECORDS: `RecordDetailScreen.tsx`, `getRecordDetailFields/formatRecordValue/formatRecordValueItem` | Acreditado en4anchos: tarjeta por campo, una columna estirada; relación MANY aparece como `ref-2, ref-1`. El helper devuelve strings directamente y objetos desconocidos como JSON: también puede mostrar ID de ONE escalar. No hay mapa de labels en este caller. | Una sección de lectura, etiqueta/valor, dos columnas cuando quepa y texto largo completo. Labels tipados; ausencia explícita, identificador secundario si permite localizar lo no resuelto. Título/displayName/orden/activos y permisos intactos. No inputs deshabilitados para presentar lectura. |
| Acciones de detalle y recuperación: `RecordDetailScreen`, `RecordProblemsScreen`, `RecordConflictScreen`, shell | Volver/Editar preceden al título; puede acercarse Editar al encabezado. Volver del detalle usa router.back: no se demuestra que equivalga al regreso del shell. Sync por entidad y estado global tienen scopes diferentes, no son duplicados por apariencia. | Reagrupar sólo presentación. No retirar Volver, sincronización, reintentos o conflictos hasta probar equivalencia de destino/causa. Problemas/resolución no se migran en el primer lote. |
| PANEL TABLE: `PanelRenderer.tsx`: `PanelModule/PanelTable/PanelFilters`; `panel-renderer-logic.ts`: `buildPanelTableModel/buildPanelModuleLayoutPlan` | Acreditado4anchos: buscador parece texto, sin etiqueta persistente propia; pie de página muy separado de una única fila. `tableViewport.flex=1` consume el módulo cuya altura viene de h×rowHeight (defaults6 y92 más mínimos); no es un espacio arbitrario borrable. Texto/cabecera limitado a una línea y scroll horizontal: riesgo para columnas largas, la muestra sólo tiene2columnas cortas. | Filtros identificables junto al conjunto, búsqueda dentro del módulo y paginación en flujo inmediatamente después de su tabla/colección. Mantener dimensiones/x/y/orden y un viewport acotado; el espacio sobrante puede quedar después del pie. No convertir todo a autoaltura ni cambiar layout de Core. |
| PANEL filtros y KPI: `PanelFilters`, `PanelKpi`, `normalizePanelFilters/missingRequiredPanelFilters` | Los filtros tipados usan RecordFieldInput legacy; checkbox/SELECT/RELATION tienen contratos distintos. KPI ya tiene ajuste de tipografía, valor completo accesible y scroll: no se acredita necesidad de sustituirlo. | Variante form3A para filtros y etiquetas de búsqueda/selección, con los mismos valores/callbacks/required; conservar carga/paginación de catálogos. Sin botón Aplicar nuevo ni colapsado que desmonte controles. KPI conserva su presentación específica. |
| REPORT TABLE y consultas de estado: `ReportRenderer.tsx`: `ReportTable/CurrentStatusReport/PeriodControl`; `report-renderer-logic.ts` | Revisión estática: TABLE tiene celdas160 y scrollhorizontal; CURRENT_STATUS/LATEST_BY_RELATION usa156, una línea y diferencias de wrap/gap entre cabecera/filas, riesgo de alineación. Buscador current sólo placeholder. REPORT **no tiene paginación** en ReportQuery (from/to/search). | Etiquetar y acotar controles; TABLE puede usar etiqueta/valor si no cabe, todas las columnas disponibles. No alterar búsquedas, orden, selección current ni LABEL/INTERNAL_VALUE. No inventar paginación, totales completos o edición genérica. |
| MATRIX: `ReportMatrix/buildReportMatrixModel`, `report-time-filter.ts` | Sólo código: ejes con celdas72, cabecera180 y resumen opcional; mes completo28–31columnas. `stickyCell` sólo da ancho/fondo: no implementa fijación real. Scroll horizontal contenido es necesario para comparar ejes, no un defecto por sí mismo. | Mantener grilla, identidad de fila/columna, valores múltiples y resumen. Evaluar cabecera/primera columna persistentes y acceso al texto completo con prueba específica, no convertir a tarjetas planas ni ocultar días. No cambiar agrupación/orden ni generar otro resumen. |
| RELATION/SELECT en REPORT/PANEL: `displayRecordValue/displayPanelValue` | RELATION sin displayName devuelve vacío, luego UI muestra guion: no distingue referencia sin etiqueta de valor nulo. SELECT desconocido puede volver al raw; INTERNAL_VALUE es una opción de negocio deliberada, no necesariamente un defecto. | Proyección visual tipada optativa con estado vacío/no disponible y traza secundaria; nunca inferir el tipo desde un string. Mantener INTERNAL_VALUE cuando está configurado, todas las entradas MANY y IDs originales. No aplicar un formatter global a los modelos. |
| Otras consultas: `app/(app)/entity/[entityTypeId]*`, `StateUpdateReadRows/SubjectIdentity`, registro de renderers | Rutas de entidad tienen carga propia y consumen entity-record-display; subjectPresentation también usa formatRecordValue para ciertos tipos. STATE_UPDATE ya tiene filas adaptables3C. BOARD/DASHBOARD siguen unsupported controlados. | Revisar consumidores indirectos si se extrae una primitiva; no migrar rutas/cargas ni workflows por accidente. No crear renderers ni AppViews nuevos en un lote visual. |

**Precaución nueva clave:** `buildReportMatrixModel` usa `displayRecordValue` al construir Sets por celda, claves de resumen y orden de etiquetas; cambiar ese formatter global para mostrar «sin etiqueta» puede juntar valores/resúmenes distintos. `stableValueKey` conserva claves de identidad, pero eso no protege el resto de la consolidación. Cualquier mejora visual de MATRIX debe actuar después de preservar su modelo o mediante proyección aditiva probada, sin recalcular Sets, contadores, orden o claves. No se resuelve mediante regex sobre el resumen formateado.

### Componentes: reutilizar primero

| Existente | Uso recomendado y límite |
| --- | --- |
| FormLayout/FormGrid y desktopPalette | Ancho razonable de detalle, grilla por área interior, espaciado/colores de3A. Optativo, defaults intactos. No imponer máximo960 a un módulo PANEL cuyo ancho está configurado. |
| FormAction/FormActions | Acciones actuales, con mismos handlers/disabled/busy; Cargar más y Prev/Siguiente siguen siendo operaciones distintas. No agregar confirmaciones. |
| FieldFrame/useFieldAccessibility, CompactSelect, temporales, RecordFieldInput form | Sólo controles de búsqueda/filtro, con etiquetas/foco y contexto required. No modificar normalización, operadores o limpiar valores al montar/medir. SearchField podría ser wrapper visual sólo si dos adopciones lo justifican; no es un buscador nuevo. |
| ReadLoadingState, badges y avisos existentes | Conservar carga inicial vs actualización, pendientes/guardado/error/conflicto y cobertura por scope; no deduplicar mensajes sólo porque ambos se ven. Conectividad no prueba sincronización. |
| StateUpdateReadRows y presentación de conflictos | Referencia de filas con etiquetas y valores/ausencias explícitas. No acoplar RECORDS al modelo de sujetos/estados, copiar handlers ni usar optionId de STATE_UPDATE como valor de SELECT genérico. |
| Nueva primitiva mínima propuesta: ReadFieldList | Sólo recibe IDs/etiquetas/valores ya autorizados y ordenados, muestra texto completo y estado de label. Sin fetch/effects/normalización, cache ni sync. Usar para detalle; extraer composición de lectura compartida sólo después de acreditar el primer consumidor. **No existe implementada.** |
| PageControls / TABLE adaptable, posteriores | Props de página/hasMore/disabled y callbacks ya existentes. Uso inicial sólo PANEL. TABLE como filas etiqueta/valor cuando no cabe, conservando cada columna; no un mega-componente único para TABLE/MATRIX/KPI. **No existen como primitivas compartidas implementadas.** |

Labels: los objetos ya traídos con displayName se aprovechan sin pedir nada. RecordDetail no carga catálogo; los IDs de pendientes pueden carecer de etiqueta. Si no hay fuente autorizada ya disponible, mostrar límite explícito y traza, no bajar todo el catálogo ni fetch por fila. `RecordFormScreen.loadRelationOptions` carga un catálogo para editar (hasta100 por página), no es un servicio de lectura de labels que deba importarse al detalle. Un lookup adicional por grupos/entidad en caché, si se propone, necesita alcance explícito y medición antes de implementarlo; no se amplía silenciosamente la preparación ni se eluden permisos. Mostrar en Cliente sigue siendo preferencia visual, no autorización.

### Propuesta estructural — bocetos, no capturas ni implementación

```text
3D.1 Lista                     Detalle
Título configurado   [Crear]   Nombre del registro   [Editar] [Volver]
Buscar registros [___≤560__]   Estado local / recuperación existente
Aviso de cobertura local      Etiqueta: valor       Etiqueta: valor
Nombre / estado               Texto largo y relaciones envuelven
Campos configurados completos Una sección; en móvil todo apilado
[Cargar más, si corresponde]

3D.2 PANEL / REPORT TABLE
Título y contexto configurados
Filtros tipados visibles, en wrap; sin nuevo botón Aplicar
[Módulo: título]
Buscar registros [________]
Columnas si caben / filas etiqueta:valor cuando corresponda
[Anterior] Página N [Siguiente]   ← sólo donde ya existe paginación
Área configurada conservada; no rellenar ni esconder campos

3D.3 MATRIX
Período actual [controles existentes]
Fila identificable | columnas/días configurados → scroll contenido
Valores completos  | mismas celdas y resumen existente
```

Móvil: filas legibles sin esconder columnas, foco y acciones táctiles; el contenido largo se desplaza. Tablet/desktop: decidir por ancho útil del contenido/módulo, no por nombres de dispositivo ni user-agent; controles conservan la misma instancia/clave al redimensionar. En TABLE estrecha con dos columnas que ya caben no se impone una tarjeta. MATRIX conserva ejes y desplazamiento intencional. No duplicar árboles tabla/tarjeta con enlaces ocultos aún enfocables; teclado debe seguir el mismo orden lógico.

### Lotes independientes propuestos

| Orden | Archivos previstos | Cambio autorizado a proponer / exclusiones |
| --- | --- | --- |
| **3D.1 — único siguiente lote recomendado** | `RecordsRenderer.tsx`, `RecordDetailScreen.tsx`; nuevo `record-read-presentation`/ReadFieldList si se justifica; tests afectados y docs. `entity-record-display.ts` sólo si variante optativa no cambia ningún consumidor legacy. | Acotar buscador, conservar enlace y campos de lista, texto completo, detalle compacto en1/2columnas, etiquetas disponibles/ausentes honestas y acciones junto al registro. No migrar RecordFormScreen, problemas/conflictos, rutas directas o subjectPresentation ni modificar el formatter global por defecto. Sin nuevos loaders, descargas, preparación o motor offline. Revisar resultado antes del lote2. |
| 3D.2 — después, separado | `PanelRenderer.tsx`, `ReportRenderer.tsx` sólo TABLE/current; presentación/pruebas locales de modelos si hace falta proyección tipada aditiva, PageControls optativo, docs. | Filtros y buscador junto al contenido, TABLE adaptable con textos completos, pie inmediato. Respetar layout.h/w/x/y, KPI, filtros/página por dataset, mismo debounce/consultas y revisiones. Mantener PeriodControl y ausencia de paginación REPORT. No MATRIX, nuevo operador de consulta, modo de escritura o snapshot. |
| 3D.3 — después, separado | `ReportMatrix` en `ReportRenderer.tsx`, primitivas visuales especializadas y pruebas; modelos lógicos sólo como controles invariantes. | Ejes legibles, scroll contenido/identificación persistente y texto completo. Acreditar MONTH/RANGE, columnas28/29/30/31, múltiples valores/resumen y volumen antes de elegir técnica. Sin cambiar agregación, orden, identidad o introducir virtualización/dependencias por defecto. Si necesita un nuevo contrato de paginación, capacidad de navegador no disponible o rediseño, detener ese punto y presentar la ampliación. |

### Riesgos, contratos y aceptación futura

- **Consultas intactas:** RECORDS busca globalmente, carga25 por página y acumula Cargar más; no se convierte en navegación Prev/Siguiente. PANEL comparte búsqueda/página por dataset y filtros globales; no por cada módulo duplicado. REPORT consulta rango o búsqueda según modo y no ofrece page/pageSize. No extender searchComparison/codeSearch de Attendance/STATE_UPDATE a estas superficies mediante un componente de diseño.
- **Snapshots y frescura:** RECORDS distingue cobertura ausente/parcial/completa y no prepara colecciones desde Inicio. PANEL guarda consulta exacta por usuario/contrato/AppView/revisión/dataset/filtros/búsqueda/página/tamaño; conservar guards y reconciliación de revisión. REPORT usa snapshot por usuario/contrato/AppView/rango/búsqueda y remote-first con fallback de red; no se transforma aquí en lector exclusivamente local. Consulta guardada no prueba otra página/filtro ni frescura actual. El layout no certifica cobertura, persistencia o sync.
- **Contenido y permisos:** mismo conjunto/orden de filas/columnas, IDs de enlaces y displayName almacenado. Respetar selección de campos configurada y LABEL/INTERNAL_VALUE, cero/falso/vacío/ausente y todas las entradas múltiples; no añadir columnas inventadas ni inferir permisos desde showInClient. No ofrecer Editar en REPORT/PANEL o seleccionar automáticamente relaciones/resultados.
- **Layout PANEL:** reorganizar el interior sin alterar el área configurada; al acercar paginación puede quedar espacio después del pie. Cabeceras largas/filtros y altura mínima requieren un fixture antes de definir el viewport; si no se garantiza acceso a contenido/acciones, conservar la disposición anterior. No eliminar scroll sólo para reducir elementos.

| Aceptación por lote, cuando se autorice | Evidencia exigida |
| --- | --- |
| Visual responsive | Mismo renderer/fixture antes/después a390/768/1024/1440 y límites759/760 de PANEL,899/900/1199/1200 del shell. Títulos largos, muchos campos/columnas, filas vacías y pobladas; sin overflow de página y acceso al texto completo sin depender de hover. MATRIX puede conservar scroll dentro de su región. |
| Semántica | Comparación de modelos y solicitudes antes/después, no tests que copien estilos. Mismos filtros tipados/IDs, orden, conteos/página/tamaño, month/range y valueDisplay. MATRIX conserva Sets/resumen, múltiples y casos sin etiqueta sin unir registros. Resize no remonta filtros/paginación ni dispara lecturas; aislar preparación legítima existente al medir, no desactivarla. |
| Labels | SELECT canónico, desconocido/ambiguo y modo INTERNAL_VALUE; RELATIONONE/MANY con objeto, ID sin etiqueta, permisos/metadata ausentes. Sin JSON principal ni etiquetas inventadas, sin consultas por fila o descargas para arreglar una celda. Regresiones de consumidores si se comparte formatter optativo. |
| Navegación/accesibilidad | Enlaces y acciones originales, Tab/ShiftTab/Enter/Escape, foco al paginar/redimensionar, nombre accesible y orden de lectura por cabecera/celda; no roles de grilla editable en consultas. Objetivos táctiles y textos completos, pruebas físicas/lector de pantalla sólo tras realizarlas. No retirar Volver/Actualizar/sync por redundancia supuesta. |
| Offline | OPFS real en perfil propio: consulta exacta visitada → cierre completo → reapertura offline, sin nuevos datos/capacidades. Ausente ≠ vacía; página/filtro no guardado no se disfraza de resultado. Conservar pendientes/conflictos ajenos por huella; reconexión no envía escrituras desde la consulta. Distinguir API sintética de Core real y Chromium de Safari físico. |
| Checks | Pruebas focalizadas existentes `entity-record-display`, `RecordsRenderer`, lectura RECORDS; `panel-renderer-logic`, `offline-panels`, reconciliación; `report-renderer-logic`, `report-time-filter`, `offline-reports` según lote. Typecheck/lint/build/diff-check sobre cada contenido final, reutilizando checks idénticos. Mantener visibles los fallos previos de etapas anteriores, sin suites repetidas para obtener PASS. |

**Conclusión:** proponer y autorizar sólo3D.1 primero. No hay bloqueo demostrado que exija cambiar Core/API/esquema para su layout básico; resolver nombres no preparados o cambiar el motor de consultas no queda implícito. Lotes2/3 necesitan evidencia visual propia de datos extensos y REPORT/MATRIX antes de declararlos mejorados. Este diagnóstico no autoriza implementación ni publicación. Sólo se actualizan este documento y su enlace/resumen en STATUS; Core,893archivos Client iniciales salvo estos2documentos,402exclusiones, etapas previas y demás pendientes conservados. Respaldo documental/inventario y evidencia de revisión en `backups/ux-ui-stage3d-review/2026-11-08/`. Sin producción, commit/push/deploy; V11 pausado.


<a id="etapa-3d1-records"></a>

## Etapa 3D.1 — RECORDS lista y detalle, local 08-11-2026

Implementado como delta independiente sobre etapas1/2/3A/3B/3C y conflictos. Reutiliza FormLayout/FormGrid plain, FormActions y desktopPalette; añade ReadFieldList de lectura sin efectos y una proyección tipada exclusiva de RECORDS. No cambia los formateadores compartidos de REPORT/PANEL/MATRIX, displayName, búsquedas, permisos ni comandos. El diagnóstico3D anterior conserva su fecha y carácter previo.

| Antes observado | Después inspeccionado en Chromium390/768/1024/1440 |
| --- | --- |
| Lista con valores de una línea, MANY y texto extenso recortados; Crear unido al buscador estirado | Campos configurados completos, wrap sin scroll horizontal de página, labels y ausencias explícitas; Crear junto al título y buscador máximo560. Cargar más continúa al final,25+3 en el fixture. Mostrar todo aumenta la altura de registros extensos: no se ocultan campos para simular densidad. |
| Detalle con una tarjeta por campo y ancho estirado; Volver/Editar separados del título | Una sección de lectura, etiquetas y valores; una columna móvil y dos desde600 interiores, máximo960. TEXTAREA y MANY extensos ocupan fila completa. Mismos enlaces/handlers junto al encabezado. |
| SELECT desconocido/RELATION escalar sin etiqueta como valor técnico principal; campos vacíos omitidos | SELECT por FieldOption.value y etiqueta configurada; ONE/MANY conserva cada entrada. Referencia sin etiqueta explícita y su ID secundario. null/cadena vacía/arreglo vacío→Sin valor; propiedad ausente→Dato no disponible en esta copia. Ceros, false, fechas y texto literal intactos. |

Las etiquetas RELATION provienen de displayName ya disponible en el propio valor/snapshot; puede aprovechar otra representación del mismo ID dentro del mismo campo. No se descargan catálogos ni se consulta por fila; no se promete resolver IDs desde cualquier catálogo cacheado. Sin fuente disponible, la limitación es visible y la referencia original permanece intacta. showInList, activos/orden y exclusión del principal en lista siguen sus helpers existentes; el detalle mantiene los campos activos y ahora explica también sus ausencias.

Validación final:176/176 pruebas focalizadas en9archivos, incluidas21 de presentación/contrato; typecheck y lint afectado PASS, build web habitual PASS. API https://web.opco.cl, base opco-client-v10-epoch2.db, index/sw coherentes y lector localJS/WASM3.1.6 precacheado verificados. Export final entry-d231b6a41a665731ea34e13c7279a10e.js. Comparación AST: efectos/funciones de negocio y atributos controlados/hrefs equivalentes; sólo cambia el memo de proyección del detalle.

Renderer real en Chrome153/Linux con OPFS y service worker reales; transporte y ACK sintéticos,28 registros ficticios. Antes/después: paginación25+3, búsqueda, enlaces, edición del mismo registro, resize/foco en4anchos y límites899/900/1199/1200 sin solicitudes nuevas; cierre completo y reapertura offline conservan intención/IDs/valores. PRAGMA integrity_check=ok; reconexión envía un PATCH, mismo registro y clientRequestId del intentId original. La preparación existente añade sentCommand y campos diagnósticos al payload: no se afirma identidad byte a byte de todo payload mutable; sí se verifican valores, intención y versión base. La huella semántica del PATCH coincide antes/después.

Regresiones y límites: RED del listado anterior→GREEN. Una regresión introducida durante este lote en los estilos de Link asChild produjo CSSStyleDeclaration inválido; corregida con StyleSheet.flatten y prueba RED→GREEN del contrato real de Expo Slot. Primer export retirado. Controles fallidos del arnés (selector de Cargar más, mayúsculas de etiquetas, espera del resultado concreto, diferencia intentId/comando preparado) se conservan; no se cambiaron timeouts ni sincronización para superarlos. Los avisos existentes de conexión fallida pueden coexistir con copia offline legible; se observaron en ambos exports y no se corrigen aquí. Fallos históricos ajenos de etapas anteriores permanecen documentados, sin nueva suite completa ni promesa de PASS global.

Inventario, parche incremental/base reconstruible, hashes, checks y capturas en backups/ux-ui-stage3d1/2026-11-08/. Sólo8archivos del lote; no incluir diffs completos con etapas anteriores. Documentos actualizados: éste, STATUS y DESKTOP_INTERFACE; STATE_UPDATE no aplica, su runtime no cambia.402exclusiones, Core y pendientes preservados. Sin producción/commit/push/deploy. Pendientes Safari físico/native/lector de pantalla y aceptación de Core real; no se acredita cobertura offline general ni preparación automática de colecciones.

Recomendación3D.2: revisar este lote antes de continuar con REPORT/PANEL y filtros, como delta separado. Conservar consultas, layout configurado, paginación y claves/revisiones de snapshots; MATRIX queda para3D.3. No ampliar aquí servicios de labels ni preparación de consultas.


<a id="revision-3d1-plan-3d2"></a>

## Revisión visual 3D.1 y preparación de 3D.2 — 08-11-2026

**Sólo revisión y planificación.** Se inspeccionaron directamente las42capturas de `backups/ux-ui-stage3d1/2026-11-08/screenshots/INDEX.md`:21pares, no sólo las27 inspeccionadas en la entrega anterior. Los8archivos originales coincidían con sus hashes antes de añadir esta documentación;5fuentes/tests funcionales quedan idénticos. El respaldo3D.1 original, su índice y sus checks no se reescriben.

Procedencia: Chrome153/Linux, OPFS real y transporte/ACK sintéticos; antes `entry-cfb175f0d6f1f1ce642bd48a4245b23d.js`, después `entry-d231b6a41a665731ea34e13c7279a10e.js`.32imágenes cubren lista/pie/detalle/dato no disponible en390/768/1024/1440;10más cubren editor1200, guardado/reapertura offline390, detalle trasACK1440 y foco1440. Las capturas `content` amplían altura: no representan un viewport físico móvil. No se ejecutan pruebas, build ni navegador nuevos; los checks176/176 y OPFS del lote previo se referencian como evidencia anterior, no como ejecución de esta revisión. Sin inferir cobertura de Safari, cámara o lector de pantalla.

### Resultado visual y decisiones sobre 3D.1

| Hallazgo e imágenes concretas | Evaluación / corrección necesaria |
| --- | --- |
| Detalle agrupado: pares `detail-content` de4anchos y `after-ack-detail-content-1440` | Mejora clara: elimina tarjeta por campo, alinea etiqueta/valor, dos columnas tablet/escritorio y máximo de lectura; móvil apilado. Volver/Editar próximos al título y sin superposición visible. Conservar esta estructura. No se demuestra que Volver local y flecha del shell sean equivalentes: no retirar ninguno por apariencia. |
| Texto extenso y MANY: `after-list-390/768/1024/1440`, `after-detail-content-*` | Los valores completos reemplazan elipsis de lista; cada relación múltiple se distingue. La cadena larga sin espacios envuelve y no se ve desplazamiento horizontal de página. **No es una mejora de densidad:** hay más desplazamiento vertical y menos registros simultáneos. No resolverlo volviendo a truncar ni ocultando columnas configuradas. |
| Cabecera móvil: `before-list-390` frente a `after-list-390` | Regresión menor de aprovechamiento: Crear ocupa el lateral del título, estrecha sus metadatos y lleva «registros»/hora a líneas adicionales; retrasa el inicio del contenido. **Recomiendo ajuste visual puntual antes de consolidar3D.1**: dar ancho completo al texto de cabecera en compacto y agrupar Crear en una fila de acciones de ancho natural próxima al título. Misma acción/ruta; sin nuevo menú ni detección de dispositivo. No implementado en esta revisión. |
| Densidad: `after-pagination-390/768/1024/1440` y `after-list-*` | La fila25 móvil casi llena el viewport; en tablet se ven menos filas que antes. Parte proviene de mostrar campos vacíos/ausentes y texto completo, no sólo espaciado. Afinar espacios de la variante compact de lista, manteniendo títulos, valores y controles táctiles actuales. No aplicar ese ajuste al detalle ni quitar información por defecto. Mejora recomendable, sin bloqueo de acceso demostrado. |
| Relaciones/SELECT sin etiqueta:4pares `unavailable-detail-content` | La referencia no resuelta está explicada; ID/valor técnico secundario, y la entrada MANY con nombre sigue visible. No aparece JSON como contenido principal en la muestra. No es un resolver de catálogos: una etiqueta no preparada sigue indisponible. Conservar el límite sin inventarla ni consultar por fila. |
| Vacío/no disponible: `after-unavailable-detail-content-*` y `after-detail-content-*` | «Sin valor» y «Dato no disponible en esta copia» son distinguibles por texto. Usan el mismo color secundario; no dependen de color para diferenciarlos. Antes ambos campos se omitían. No hay defecto visual que justifique volver a omitirlos. |
| Pie y acciones:8capturas `pagination`, pares `edit-keyboard-1200` y `search-focus-1440` | Cargar más permanece inmediatamente después de la colección; accesible en4anchos. Foco visible en editor y buscador, sin cambios visuales del editor3A. Crear/Editar azul y Cargar más verdeazulado conservado constituyen una inconsistencia menor de paleta; alinear sólo pintura/roles de acción en un remate visual, conservando su función. Las capturas no acreditan por sí solas navegación con teclado: se reutiliza el controlCDP previo. |
| Offline:4capturas `offline-saved/reopened-390` | Contexto y copia legible con pendiente visible. **Mensaje ambiguo preexistente:** «No fue posible conectar con Opco» rojo junto a guardado local/copia disponible; aparece antes y después. Es una mejora de mensaje/estado pendiente separada, no regresión3D.1 ni prueba de pérdida de datos. No tocar motor, errores o preparación para ocultarlo. |
| Repeticiones de título/descripción | Shell/experiencia y campo principal pueden repetir texto porque tienen funciones distintas y el campo está configurado. No eliminar campos o accesos automáticamente. Textos completos, pesos tipográficos y azul de acciones son consistentes con3A–3C; no se acredita accesibilidad universal por la imagen. |

**Decisión:** detalle3D.1 visualmente apto; no hay bloqueo de lectura demostrado. El listado necesita un remate pequeño de cabecera móvil y densidad antes de dar por cerrado el objetivo de compacidad; no bloquea **planificar**3D.2. Esta revisión no aplica ese remate ni autoriza implícitamente la publicación. No extender mecánicamente la fila RECORDS a toda tabla: su coste vertical sería perjudicial dentro de módulos acotados.

### REPORT/PANEL: revisión actual y límite de la evidencia

Se contrastaron funciones y estilos actuales, y se volvieron a inspeccionar4capturas PANEL de etapa2 (`after-ux-panel-390/768/1024/1440`). Estas muestran una tabla de2columnas/1fila, buscador que parece texto y paginación separada por un área vacía grande. Son evidencia archivada, no un ensayo nuevo del binario3D.1. No hay muestra REPORT con datos extensos, filtros PANEL poblados ni módulo mínimo/varios módulos: requieren evidencia propia al implementar, sin presentar la revisión estática como resultado visual probado.

- `PanelRenderer.tsx`: `PanelFilters` conserva valores string, normalización tipada y catálogos; `PanelModule` muestra buscador sin etiqueta accesible explícita; `PanelTable` usa minWidth/pesos de columna, una línea y scroll anidado. `tableViewport.flex=1` ocupa el espacio antes del pie. `buildPanelModuleLayoutPlan` conserva x/y/w/h/columns/rowHeight y mínimos; móvil<760 usa orden espacial y minHeight, desktop posiciones absolutas. Ese tamaño **no se elimina** para acercar el pie.
- `ReportRenderer.tsx`: `ReportTable` tiene columnas160 con wrap de texto, no elipsis explícita; el problema estático es el ancho acumulado, no afirmar que ya trunca como PANEL. `CurrentStatusReport` sí usa una línea y cabecera con wrap/gap/padding distintos de las filas. Búsqueda sólo en CURRENT_STATUS/LATEST_BY_RELATION, debounce350; TABLE consulta período. PeriodControl/Actualizar existen: conservar cuándo actualizan y cuándo están deshabilitados. **REPORT no tiene paginación**, no añadirla.
- PANEL pagina/busca **por dataset**, compartido por módulos del mismo dataset; filtros globales reinician páginas como ahora. No crear un estado de consulta independiente por tarjeta visual. BOOLEAN es selector ternario vacío/true/false: no reemplazarlo por el checkbox binario de un formulario. No habilitar filtros MANY ni transformar arreglos mediante una adopción visual.
- `buildPanelTableModel` ya dispone de pesos/mínimos y campos configurados; `buildReportTableModel/buildReportCurrentStatusModel` conservan columnas/filas ordenadas. Los strings pierden la diferencia null/IDsinlabel: no inferirla de «-», una coma o un patrón deID.
- `displayRecordValue` también participa en Sets/resúmenes/orden de MATRIX. **No modificarlo globalmente**, ni sustituirlo por el helper RECORDS (SELECT de consultas también admite representaciones históricas optionId y `INTERNAL_VALUE`). La presentación adicional debe recibir metadata/valor original y política explícita de la columna, después del modelo, sin recalcular ni sobrescribirlo.

### Propuesta concreta: 3D.2 en dos incrementos revisables

1. **Primero PANEL TABLE/filtros.** Mantener la grilla y todas sus medidas configuradas. Filtros antes de módulos con etiquetas/required y layout wrap; adoptar RecordFieldInput `presentation=form` sólo para los controles que ya soporta, conservando callback, búsqueda de catálogo, valor y cardinalidad. BOOLEAN conserva CompactSelect ternario. Buscador del dataset con etiqueta visible/asociada y límite560 dentro del módulo disponible; mismo onSearch y consulta. No agregar Aplicar ni menús colapsables.
2. **Interior de tabla adaptable.** Si la suma de mínimos de columnas cabe en el ancho útil, tabla con las mismas columnas alineadas; si no cabe, filas etiqueta/valor para cada registro, sin ocultar columnas. Medir el contenedor del módulo, no elegir por user-agent ni sólo ancho de ventana. Mantener claves/controles estables, sin dos árboles ocultos enfocables ni remonte de buscador/filtros al cambiar tamaño. Cabeceras y texto completos; cada MANY conserva todas las entradas. No añadir enlaces/Editar donde hoy no existen.
3. **Pie PANEL tras resultados.** Contenido corto usa altura natural dentro del área, pie inmediatamente después y espacio sobrante **después** del pie; contenido largo mantiene viewport vertical acotado por el alto interior restante, pie visible fuera de él y sin superponer otro módulo. Nunca cambiar h/rowHeight para acomodarlo. Si cabecera/filtros/acciones no caben en un módulo mínimo, conservar el comportamiento accesible previo y documentar el límite antes de forzar el cambio. Mismas condiciones actuales de paginated/disabled, número de página y handlers.
4. **Después, REPORT TABLE y CURRENT_STATUS/LATEST_BY_RELATION.** Reutilizar la presentación de celdas/filas cuando corresponda, con ancho y columnas de su configuración. Encabezado y filas comparten geometría; textos completos y búsqueda etiquetada sólo donde ya existe. Período/Actualizar agrupados junto al resultado conservando el comportamiento automático/manual. No crear paginación. Cambios visuales comunes a PeriodControl o estilos deben ser optativos para estos modos: MATRIX/controles MATRIX quedan intactos en3D.2.
5. **Estados y etiquetas disponibles.** Conservar carga inicial/actualización, resultado vacío, copia compatible con error y consulta ausente/fallo local distintos. Usar ReadLoadingState con flags existentes y aviso próximo al módulo afectado; no retirar la copia válida. SELECT en LABEL muestra etiqueta disponible, INTERNAL_VALUE conserva su contrato; RELATION objeto muestra displayName, sinlabel se explica con traza secundaria, sin petición nueva. Si hace falta dato que no llega, registrar la brecha; no ampliar Core/preparación.

No implementar ambos incrementos sin una revisión intermedia de PANEL. KPI/compuestos mantienen su presentación, resultados, tamaños y scroll actuales. MATRIX sigue3D.3. Este orden reduce el riesgo de mezclar layout de dashboard con reportes de período.

### Componentes y archivos previstos

| Existente o propuesta | Adopción y archivos |
| --- | --- |
| FieldFrame/useFieldAccessibility, RecordFieldInput form, CompactSelect, temporales | `src/renderers/panels/PanelRenderer.tsx`: filtros/buscador con IDs de accesibilidad estables. No cambiar defaults ni servicios de `RecordFieldInput.tsx`, ni BOOLEAN ternario. `src/renderers/reports/ReportRenderer.tsx`: buscador/período en los modos incluidos. |
| FormGrid plain, FormActions/FormAction, desktopPalette | Composición local, mismas acciones. **No envolver PANEL en FormLayout máximo960** ni cambiar la dimensión de módulos. Reutilizar espaciado/paleta, no forzar el formulario a una tabla. |
| ReadFieldList de3D.1 | Recibe sólo proyección visual ordenada; reutilizable en filas estrechas si cabe sin tarjeta por celda. Su variante compact210/fullWidthMANY produce mucha altura: evaluar el fixture antes de adoptarla literalmente. Mantener intactos sus defaults RECORDS. |
| ReadLoadingState y estados existentes | Carga/actualización/error por scope existente. No nuevo motor de estado ni política de revalidación. |
| Nueva primitiva optativa, si se justifica con ambos callers: `read-table.tsx` | Sólo columnas/filas/IDs y contenido ya preparado, ancho disponible/scroll y disposición tabla/etiqueta-valor. Sin consulta, ordenamiento propio, caché, filtros o acciones nuevas. No mega-componente TABLE/MATRIX/KPI. PageControls no requiere componente nuevo si FormActions basta; si se extrae, sólo page/disabled/callbacks existentes. **No existen todavía.** |
| Proyección de celdas exclusiva de consultas, aditiva | Posibles `panels/panel-read-presentation.ts` y `reports/report-read-presentation.ts`: conservar metadata/valor/política por columna para vacío/no preparado/etiquetas; reutilizar ReadValue como estructura, no el resolver canónico de RECORDS. No cambiar `displayPanelValue/displayRecordValue` ni los modelos por defecto. Si una extracción común altera defaults, posponerla. |
| Regresiones/modelos existentes | `panel-renderer-logic.test.ts`, `report-renderer-logic.test.ts`, `report-time-filter.test.ts`; pruebas de componente/renderers y los controles `offline-panels.test.ts`, `panel-offline-read.sqlite.test.ts`, `panel-definition.test.ts`, `panel-read-diagnostics.test.ts`, `offline-reports.test.ts`. Archivos de loaders/store sólo se verifican, no se modifican. |

### Riesgos y criterios verificables de aceptación

| Riesgo / condición | Criterio exigido para implementar y cerrar3D.2 |
| --- | --- |
| Cambiar query al adoptar filtros | Antes/después con mismo fixture: métodos/endpoints/filters normalizados/search/dataset/page/pageSize, debounce y reinicio de página iguales; BOOLEAN vacío/false/true, SELECT canónico/histórico, DATE/TIME/RELATION sin coerción nueva. No búsqueda por campo/searchComparison nueva. |
| Cambiar layout y esconder pie |390/768/1024/1440 más759/760 y límites de shell; módulos estrechos, h mínimo, varios módulos y dos que comparten dataset. x/y/w/h/rowHeight/orden idénticos; sin overflow de página, solapes ni pie inaccesible. Texto largo sólo aumenta scroll interior cuando hace falta. |
| Generalizar la fila RECORDS y perder densidad |2columnas que caben no se convierten a tarjetas; muchas columnas siguen accesibles sin elipsis irreversible. Medir con0/1/25filas y texto largo, título de módulo largo y MANY extenso. Mismos IDs/columnas/orden/conteos; sin nueva agregación. |
| Metadata/labels ambiguos y MATRIX | Mantener LABEL/INTERNAL_VALUE, valores originales/ceros/false y resultados múltiples. Relaciones parciales no pierden entradas. Modelo/formatter/MATRIX y conjuntos/resúmenes byte o semánticamente invariantes, sin N+1/red para pintar una celda. |
| Remonte/foco/acciones duplicadas | Tab/ShiftTab/Enter/Escape; controles táctiles y nombres accesibles. Resize mantiene input/selecciones/página/foco y no dispara nuevas llamadas. Misma acción única por función; sólo accesos existentes, sin edición genérica en consulta. No pérdida de selección por abrir/cerrar filtros. |
| Confundir presentación con cobertura offline | OPFS real y mismo snapshot exacto tras cierre/reapertura: snapshot ausente ≠ resultado vacío ≠ SQLite fallido; nunca reutilizar otro filtro/página/revisión/usuario. Conservar R1/R2 y guards de persistencia. REPORT mantiene su lectura remote-first/fallback actual, PANEL offline conocido usa sóloSQLite. No prometer que se prepararon todas las consultas. |
| Límites funcionales previos | PANEL actualmente oculta paginación con0filas; recuperar una página vacía mediante Anterior cambia su condición visual existente y requiere caso/alcance explícito, no corregirlo silenciosamente. La revisión estática lo registra, no lo presenta como incidente reproducido. Aviso offline de RECORDS queda separado. |
| Checks proporcionados | Pruebas focalizadas de datos/handlers/modelos más typecheck/lint afectado/build/diff-check del contenido final. Evidencia real antes/después de REPORT y filtros extensos aún pendiente; no rerun de cámara ni suites completas sin cambio que lo justifique. Mantener fallos históricos separados. |

Sólo se añaden esta sección y el enlace/resumen en STATUS. Código3D.1 y etapas previas, Core, SQLite/OPFS/sync y402exclusiones preservados. Inventario documental, hashes de las42imágenes inspeccionadas y verificación de preservación en `backups/ux-ui-stage3d1-review/2026-11-08/`. Sin commit/push/deploy, producción ni configuración. V11 sigue pausado.


<a id="cierre-visual-3d1"></a>

## Cierre visual 3D.1 — remate local, 08-11-2026

Resuelve los tres ajustes visuales de la revisión anterior, sin adoptar3D.2. Cabecera RECORDS envuelve por ancho disponible: texto contextual ocupa todo el ancho compacto y Crear pasa a su fila natural; en tablet/escritorio permanece junto al título. Sólo flex-basis/grow/shrink, sin user-agent, árbol responsive alternativo ni nuevos efectos. Se conserva exactamente StyleSheet.flatten en los hijos Link asChild corregidos previamente.

ReadFieldList compact reduce separación etiqueta/valor6→3 y filas16→10; columnas mantienen16. Tarjeta de registro reduce padding14→12 y gap10→8. Fuentes, interlineado, textos completos, orden y campos/ausencias permanecen. Default de detalle conserva sus espacios y grilla. Cargar más adopta desktopPalette.primary, conserva minHeight46, spinner/disabled/callback y dispone de rol accesible button.

| Comparación del mismo registro extenso / fixture |390|768|1024|1440|
| --- | --- | --- | --- | --- |
| Altura de la fila antes→después, px CSS |851→767|481→433|481→433|460→412|
| Altura cabecera antes→después |127→148|65→65|65→65|65→65|

La cabecera móvil gana21px al separar la acción, mientras el bloque de título/metadatos pasa de127 a96px y evita líneas adicionales de «registros»/hora; la primera fila se reduce84px sin ocultar texto. No se presenta como reducción de altura de toda cabecera. En tablet/escritorio se reduce48px en la fila ensayada; no extrapolar esa cifra a cualquier configuración. Controles táctiles y desplazamiento vertical conservados; sin overflow de página en los4anchos.

176/176 afectadas en9archivos; regresión de rol accesible20/21 en base→GREEN final. Typecheck y lint afectado(3archivos) PASS. Un build habitual PASS: entry-0fed31469715340fb60bd76a6da9a984.js; API https://web.opco.cl, namespace opco-client-v10-epoch2.db, index/sw y lectorJS/WASM local3.1.6 precacheado verificados. Diff-check y comparación AST de funciones/efectos/handlers/hrefs PASS:46sentencias de lista/11detalle y13/5atributos controlados equivalentes. No nuevas pruebas que copien tamaños/colores ni suite completa.

Renderer real Chrome153/Linux, antes/después390/768/1024/1440, texto largo/SELECT/BOOLEAN/RELATIONONE/MANY y ausencias. Resize/Tab/Enter conservan nodos, valores y foco, sin solicitudes nuevas. Crear y Editar abren sus rutas mediante teclado; Crear no se guarda. Cargar más25+3 con respuesta sintética retenida acredita spinner/disabled/46px y una sola solicitud al repetir Enter. Cierre completo/reapertura OPFS del mismo perfil conserva intención/valores/identidad y PRAGMA integrity_check=ok; reconexión envía exactamente1PATCH/ACK sintético, misma fila, intentId y versión base; huella semántica idéntica antes/después. sentCommand y diagnósticos añadidos por el sincronizador existente siguen distinguiéndose del payload de intención; no se promete igualdad byte a byte de todo payload mutable.

Sin errores de runtime en recorridos finales. Dos controles iniciales del arnés extra se conservan: expresión regex escapada incorrectamente y compuerta de transporte instalada después de que API capturase fetch; corregidos sólo en arnés/fixture, sin aumentar timeouts o tocar la aplicación. No se ocultan como PASS previos. Los fallos históricos de otros lotes y el mensaje rojo de conexión coexistente con copia offline quedan separados e intactos. API/ACK sintéticos, no aceptación Core real; Safari físico/native/lector de pantalla pendientes, sin garantía offline universal.

Respaldo `backups/ux-ui-stage3d1-final/2026-11-08/`: delta del remate y lote3D.1 combinado reconstruibles, hashes/checks,44capturas e índice. La revisión/planificación3D.2 se conserva como pendiente documental previo, fuera de los hunks añadidos del combinado. No preparar archivos sucios completos. Original3D.1 y sus respaldos preservados. Documentos actualizados: UX_UI_REDESIGN, STATUS y DESKTOP_INTERFACE; STATE_UPDATE no cambia porque no se altera su runtime. Core, REPORT/PANEL/MATRIX, SQLite/OPFS/outbox/namespace,402exclusiones y ajenos intactos. Sin producción/commit/push/deploy.

**Resultado:** remate visual3D.1 listo para revisión local; los tres hallazgos de presentación quedan atendidos con los límites descritos. Próxima implementación3D.2 requiere su autorización y lote propio; no se inicia en esta ejecución. V11 pausado.


<a id="etapa-3d2a-panel-table"></a>

## Etapa 3D.2A — PANEL TABLE y filtros, local 09-11-2026

Implementación exclusiva de presentación en PanelRenderer, proyección visual aditiva y regresiones. Reutiliza FieldFrame/useFieldAccessibility, RecordFieldInput `presentation=form`, CompactSelect ternario BOOLEAN, FormActions/FormAction y ReadLoadingState existente. Sus defaults compartidos permanecen intactos. Filtros sin tarjeta por campo; RELATION separa búsqueda y selección; buscador del dataset con etiqueta asociada y máximo 560. Mismos callbacks, normalización, debounce, páginas compartidas por dataset y condiciones de limpiar/required.

Cada tabla mide su ancho: si caben los mínimos existentes conserva columnas alineadas; si no, presenta los mismos registros y campos ordenados como etiqueta/valor. Un árbol estable, sin ocultar datos ni elipsis irreversible. SELECT LABEL admite valor canónico/optionId histórico según precedencia existente; INTERNAL_VALUE conserva su valor. BOOLEAN booleano muestra Sí/No. RELATION ONE/MANY conserva cada entrada y utiliza displayName disponible; ausencia explícita e identificador secundario cuando falta etiqueta. undefined se distingue de vacío. Sin catálogos por fila ni cambios de modelo, formatter global o snapshot.

El pie sigue a los resultados con los mismos handlers/disabled/page. En la consulta breve de una fila queda 12 px después de la tabla a 390/768/1024/1440; el espacio sobrante queda después del pie. Todo TABLE utiliza un scroll interior acotado, incluido título/buscador/pie: **el pie no es fijo**. Con contenido largo requiere desplazamiento interior. Sustituye la propuesta previa de separar viewport/pie para que cabecera y acciones sigan accesibles en un módulo mínimo 300. Grilla x/y/w/h/rowHeight y anchos intactos. Desktop conserva alturas 552/368; móvil respeta ahora esas alturas calculadas, frente a la expansión intrínseca 1278/1242 del fixture previo. No cambia buildPanelModuleLayoutPlan ni KPI. Texto completo implica más scroll vertical; sin overflow horizontal de página en los cuatro anchos.

| Evidencia final | Resultado y límite |
| --- | --- |
| Chromium153/Linux real,390/768/1024/1440 |56 capturas: filtros, tabla de 9 columnas/textos largos/MANY, tabla de 2 columnas, pie, resultado único, vacío/error y offline; módulo mínimo 300 adicional. Comparaciones y estados seleccionados inspeccionados directamente; no se declara inspección de todas las imágenes ni Safari físico/native/lector de pantalla. |
| Consultas y controles |23 consultas PANEL idénticas antes/después: BOOLEAN vacío/false/true, SELECTa/b, DATE, RELATION y texto; búsqueda compartida, página2/1 y Reintentar. Resize en 4 anchos y759/760,899/900,1199/1200 conserva nodos/valores/foco y genera0 solicitudes. Tab/Enter reales; cambios de filtros mediante eventosDOM. |
| OPFS frío |Cierre completo/reapertura del mismo perfil con red bloqueada:13 snapshots exactos y huella idéntica, integrity_check=ok,0 llamadas API PANEL y0 escrituras. Filtros reaplicados: no se agrega persistencia de controles. Pendientes vacíos antes/después; no se acredita un nuevo ensayo con outbox poblado. Consulta nunca visitada sigue ausente explícitamente. |
| Regresiones |159/159 afectadas; después de los últimos ajustes visuales,60/60 de renderer/proyección/modelos repetidas. Las 99 restantes se reutilizan con contenido/dependencias funcionales idénticos. Una regresión accesible falla sobre renderer anterior y pasa final. Tres assertions de CSS fuente obsoletas se sustituyen por componentes/mediciones reales; garantías de datos/KPI intactas. |
| Checks |Typecheck y lint afectado (4 archivos) PASS. Build habitual final PASS: entry-326b554e6eb1a70d3c075a8469208241.js. API https://web.opco.cl, namespace opco-client-v10-epoch2.db, index/sw y lector JS/WASM local 3.1.6 precacheado. Diff-check y reconstrucción estricta/reversa con hashes. |
| Preservación |48 sentencias previas al render, helpers KPI/state/configuredPageSize/isPanelTableModule y estilos legacy idénticos. Core, REPORT TABLE/MATRIX, modelos/loaders/store, almacenamiento/outbox/namespace, etapas previas y402 exclusiones/ajenos intactos. Índices/HEAD sin cambios. |

Se conservan resúmenes de controles iniciales del arnés y un defecto propio encontrado antes del cierre: el primer layout expandía el módulo móvil hasta 13474 px; se corrigió sólo su límite visual y se repitieron los checks afectados, build y recorrido final. Hubo 4 builds por ajustes demostrados (BOOLEAN legible y límite/flex-basis del viewport), no cuatro aprobaciones del contenido final. Errores de arranque/esperas del arnés se distinguen de fallos de la app. Sin aumentar timeouts ni tocar contratos para obtener PASS; no se copian logs, perfiles, bases ni dist al respaldo.

Límites intactos: API sintética, sin aceptación Core/productiva; Safari físico/native/lector de pantalla pendientes. Snapshots exactos visitados; preparación automática de consultas no implementada. La paginación con 0 filas continúa oculta como antes. Copia compatible/error/carga y reconciliación de revisiones conservan sus caminos. Sin prometer accesibilidad universal ni tiempos productivos. REPORT TABLE/CurrentStatus corresponden a 3D.2B y MATRIX a una etapa posterior.

Respaldo independiente `backups/ux-ui-stage3d2a/2026-11-09/`: inventario, baseline local previo, parche reversible, hashes, checks y capturas. Se aplica sobre etapas 1/2/3A/3B/3C/conflictos/3D.1 locales, **no sobre HEAD desnudo**; no preparar archivos sucios completos. Documentos: UX_UI_REDESIGN, STATUS y DESKTOP_INTERFACE. STATE_UPDATE no cambia porque no se altera su runtime, intención, almacenamiento ni sincronización.

**Resultado:** 3D.2A listo para revisión visual local. Antes de 3D.2B, revisar densidad etiqueta/valor y scroll interior; no extenderlos mecánicamente a REPORT/MATRIX. Sin producción/commit/push/deploy; V11 pausado.


<a id="revision-3d2a-plan-3d2b"></a>

## Revisión visual 3D.2A y plan 3D.2B — 09-11-2026

Sólo revisión y planificación. **56/56 capturas inspeccionadas directamente** de `backups/ux-ui-stage3d2a/2026-11-09/screenshots/INDEX.md`:24 pares antes/después y8 imágenes del módulo mínimo. Se verifican sus hashes y SHA256SUMS originales, sin reescribir el respaldo. Antes:3D.1 final `entry-0fed31469715340fb60bd76a6da9a984.js`; después:3D.2A final `entry-326b554e6eb1a70d3c075a8469208241.js`. Procedencia archivada: Chrome153/Linux, transporte sintético, OPFS/SW reales. Esta ejecución no prueba nuevamente navegador, teclado, cámara, Core, Safari ni almacenamiento; las garantías funcionales citadas son evidencia anterior, no resultados nuevos.

### PANEL: resultado visual y ajustes pendientes

| Evidencia concreta | Evaluación y decisión |
| --- | --- |
|8 capturas `filters`, cuatro anchos | Mejora clara de reconocimiento: inputs con bordes, labels consistentes y RELATION separa Buscar opciones de Selección actual. Se eliminan tarjetas por campo. Móvil reduce parte del bloque vertical, pero tablet/escritorio conservan huecos bajo los filtros de una sola línea porque RELATION ocupa dos controles. No afirmar compacidad universal ni cambiar el orden de filtros sólo para rellenar esos huecos. Ajuste de alineación de prioridad baja. |
|8 capturas `table` y8 `short` | Campos extensos y MANY legibles; cadenas sin espacios envuelven. La tabla breve conserva columnas y asociación cabecera/valor. **Contrapartida importante:** nueve columnas pasan a una única columna de etiqueta/valor incluso a 1440; el primer registro ocupa casi todo el viewport y queda poco contenido comparable simultáneamente. No falta información, pero aumenta mucho el desplazamiento. Recomiendo remate de densidad antes de consolidar PANEL: en el modo apilado, distribuir campos breves en dos columnas cuando quepan, dejando textos extensos/MANY con ancho suficiente y orden inequívoco. No truncar ni quitar columnas; no modificar mínimos o tamaños configurados para forzar una tabla horizontal. |
|8 capturas `pagination` y8 `one-row` | En una fila breve, el pie queda próximo al resultado; ya no se separa por el vacío anterior. En tablas largas desaparece durante la lectura, junto con título/buscador, hasta llegar al final del scroll interior. Dos niveles de desplazamiento siguen visibles. Es un coste de navegación verificable por las imágenes, no un fallo demostrado de acceso. Recomiendo remate puntual: mantener el pie accesible mientras se desplazan filas cuando cabecera y acciones caben; conservar scroll completo en módulos mínimos donde fijarlo restaría el área útil. Misma página, disabled y callbacks, sin duplicar controles. No implementado aquí. |
|8 imágenes `minimum-top/footer` | Se llega a los botones, pero en 768/1024 el módulo configurado muy estrecho envuelve el título y apila Anterior/Página/Siguiente. A 1440 el pie aún ocupa dos filas. Es un límite ergonómico de esa combinación de ancho/alto, no un motivo para ampliar automáticamente w/h ni ocultar información. Requiere mantener fallback de scroll y comprobar acceso tras cualquier remate del pie. |
|4 imágenes `empty/error` | Vacío y fallo se distinguen por texto y acción. El estado vacío conserva altura de módulo; no eliminar ese espacio cambiando la grilla. El foco azul del buscador aparece en `after-empty/error-390`, coherente con etapas anteriores. Capturas estáticas no acreditan secuencia de Tab ni lector de pantalla; se referencia el ensayo previo. |
|4 imágenes `offline-reopened/missing` | Copia guardada visible con señal offline; consulta ausente explica que debe guardarse esa combinación y mantiene Reintentar. No hay evidencia visual de pérdida de snapshot. No equiparar snapshot disponible con todas las consultas preparadas ni frescura remota. |
| Selecciones y etiquetas | Las relaciones resueltas se ven legibles en las filas y las entradas MANY se separan. Sin valor y Dato no disponible son distintos por texto, no sólo por color. **Brecha visual:** las capturas de filtros muestran RELATION sin selección; no hay una captura complementaria con búsqueda y selección pobladas simultáneamente ni una fila centrada en relación sin etiqueta. Los controles funcionales previos y pruebas cubren parte del comportamiento, pero no sustituyen esas imágenes. |

**Decisión:** 3D.2A mejora reconocimiento y lectura completa, pero **recomiendo un remate visual separado antes de consolidarlo** por densidad de la fila extensa y acceso al pie durante scroll. No se demuestra un bloqueo de datos o de paginación. Estos hallazgos no impiden diseñar REPORT, ni autorizan modificar PANEL ahora. El espacio residual de un módulo corto deriva de su tamaño configurado; no es una regresión que deba eliminarse reduciendo su alto. Duplicaciones de títulos shell/experiencia o buscadores de módulos que comparten dataset no se eliminan por apariencia: mantienen sus alcances existentes.

### REPORT: contraste con código actual

- `ReportRenderer.tsx`, `ReportRenderer`: TABLE/MATRIX consultan rango `from/to`; CURRENT_STATUS/LATEST_BY_RELATION consultan búsqueda con trim y debounce de 350 ms. No hay búsqueda de registros ni paginación en TABLE. Cambiar período ya dispara lectura; Actualizar incrementa refreshCount. Con período fijo, Actualizar permanece deshabilitado según allowChange: no modificarlo como ajuste visual.
- `ReportTable` usa ScrollView horizontal y celdas de 160 px, con el mismo estilo para cabecera/filas; **ya permite wrap**, no atribuirle la elipsis de PANEL. El ancho acumulado y la falta de adaptación son riesgos demostrables en código, no una inspección de capturas REPORT nuevas.
- `CurrentStatusReport` sí limita encabezados/valores a una línea. Su cabecera añade wrap/gap/padding no presentes en las filas: riesgo concreto de desalineación estática. Se registra para un incremento posterior, **no se incorpora implícitamente al primer lote TABLE**.
- `PeriodControl`/`DateInput`/DateFieldInput/MonthFieldInput comparten ruta con MATRIX. Adoptar FieldFrame y acciones sólo mediante una variante optativa para TABLE; preservar el default y las ramas MONTH/RANGE/fijo, onChange y disabled. Los botones de mes ya tienen nombres accesibles.
- `buildReportTableModel` respeta visibleFieldIds y orden recibido. `displayRecordValue` resuelve SELECT canónico/optionId y aplica el contrato INTERNAL_VALUE (incluida mayúscula existente); RELATION MANY concatena etiquetas y omite entradas sin label. También se usa en MATRIX para valores, Sets, resúmenes y orden: **no cambiarlo globalmente**.
- TABLE lee el valor crudo por `record.values[field.key]`, no por fieldId como PANEL. Configuración/columnas usan IDs estables. El helper PANEL no se traslada literalmente. TABLE y current además difieren en formato de fechas existente: no unificarlo incidentalmente.
- `loadReportWithOfflineCache` mantiene consulta remota, persistencia y fallback sólo por OpcoNetworkError. Snapshots por usuario/contrato/AppView/rango/búsqueda; sin página ni revisión PANEL. No adoptar el loader offline local-only o la reconciliación PANEL dentro de este rediseño. Las limitaciones de esta lectura siguen separadas.

### Propuesta mínima de 3D.2B: primero REPORT TABLE

1. **Controles junto al contenido:** conservar título AppView; agrupar período RANGE/MONTH/fijo y Actualizar con FieldFrame/useFieldAccessibility/FormActions cuando corresponda. Nodos y handlers estables al cambiar tamaño. Sin Aplicar nuevo, nuevas búsquedas, nuevos filtros, paginación ni cambios del disparo automático/manual. Variante TABLE optativa; MATRIX conserva su rama y estilos.
2. **Lectura según ancho interior:** cuando quepan las columnas, encabezados/filas comparten geometría y textos completos. Cuando no quepan, una sección por registro con campos ordenados, sin tarjeta por campo. Móvil apilado; tablet/escritorio pueden agrupar dos campos breves por fila y dar espacio completo a texto largo/MANY. No copiar la columna única de PANEL en todo escritorio ni su viewport de altura fija: REPORT utiliza desplazamiento de página, no módulos PANEL acotados. No ocultar columnas, ordenar de nuevo ni limitar resultados para aligerar la UI.
3. **Proyección visual aditiva:** `report-read-presentation.ts` recibe ReportResponse y modelo ya calculado; conserva IDs, filas, orden y valores originales. Lee metadata por ID y datos por field.key. LABEL/INTERNAL_VALUE y fechas existentes se conservan; relaciones disponibles usan displayName y cada entrada MANY permanece representada. Vacío, ausente y etiqueta no disponible explícitos, sin inferirlos del string «-». Trazas técnicas secundarias sólo si existen, sin inventar nombres, descargar catálogos ni consultas por fila. El modelo y formatter compartido quedan intactos.
4. **Estados próximos a resultados:** misma carga inicial, error sin copia, copia compatible con error y vacío. Puede mostrarse actualización textual cuando isLoading y visibleReport ya existen, conservando datos visibles y semántica del estado. No introducir nuevos reintentos ni habilitar Actualizar cuando hoy está bloqueado. ReadLoadingState sólo si su texto corresponde al reporte; no cambiar defaults compartidos para otros consumidores.
5. **Revisión intermedia:** validar TABLE antes de proponer el siguiente incremento CURRENT_STATUS/LATEST_BY_RELATION. Ese incremento atendería alineación, texto completo y buscador etiquetado; requiere autorización propia. MATRIX, KPI y consolidación quedan fuera.

No hace falta introducir una tabla universal en esta etapa. Reutilizar paleta, accesibilidad, acciones y el tipo de valor visual disponible; no extraer un mega-componente PANEL/REPORT/MATRIX ni cambiar defaults de ReadFieldList/RecordFieldInput para acomodarlo.

### Archivos, riesgos y aceptación futura

| Archivo / componente | Alcance propuesto o protección |
| --- | --- |
| `src/renderers/reports/ReportRenderer.tsx`: ReportTable, PeriodControl, DateInput y composición TABLE | Única superficie funcional inicial; variante visual optativa para controles y estilos exclusivos TABLE. Efectos, consultas, handlers, guards y demás modos conservados. |
| `reports/report-read-presentation.ts` y prueba de componente nueva | Proyección pura y visualización del mismo modelo; casos de tipos/ausencias/etiquetas. No existen aún. |
| FieldFrame/useFieldAccessibility, FormActions/FormAction, temporales y paleta | Reutilizar sin cambiar contratos o defaults compartidos. ReadFieldList aporta estructura/tipos cuando encajen; no heredar su densidad sin revisar fixture. |
| `report-renderer-logic.ts`, `report-time-filter.ts`, `offline-reports.ts`, `local-db.ts`, `opco-api.ts` | Sólo controles de invariancia, sin cambios funcionales previstos. Tests existentes report-renderer-logic, report-time-filter, offline-reports y ReadLoading se reutilizan/amplían sólo donde haga falta. |
| PanelRenderer/helper, REPORT MATRIX/CurrentStatus y KPI | Byte idénticos durante primer lote TABLE, salvo la composición externa mínima que permita la variante optativa sin cambiar sus defaults. No llevar el remate PANEL dentro de ese lote. |

Criterios verificables para implementar: (a) consultas/métodos/endpoints/from/to/trim y recuentos iguales antes/después, sin page/cursor nuevos; (b) mismas filas, IDs, orden, columnas configuradas, INTERNAL_VALUE y fechas; (c) cuatro anchos 390/768/1024/1440, columnas cortas/extensas,0/1/muchos registros y MANY parcial, sin truncamiento irreversible; (d) resize conserva nodos/foco/período y genera 0 solicitudes; (e) RANGE/MONTH/fijo y Actualizar mantienen exactamente disparos/disabled, Tab/ShiftTab/Enter y nombres accesibles; (f) mismo snapshot exacto tras reapertura OPFS, vacío/ausente/error y copia compatible diferenciados según el loader existente, sin nueva preparación automática; (g) MATRIX/consolidación/Set/resúmenes y modelos invariantes. Si aparece un defecto de loader/scope/persistencia, separarlo y consultar antes de ampliarlo.

Riesgos: más altura por texto completo; pérdida de comparación rápida si todo se apila; confundir fieldId/key o label/valor interno; descartar relaciones parciales al reutilizar strings; alterar MATRIX mediante estilos/formatter compartidos; duplicar controles al cambiar breakpoint; confundir offline con frescura o resultado vacío. Sin promesa de rendimiento productivo. Las capturas REPORT extensas, etiquetas ausentes, accesibilidad asistida y Safari físico siguen pendientes de una implementación autorizada; las imágenes PANEL no los acreditan.

Sólo se actualizan UX_UI_REDESIGN y STATUS. Se conservan todos los prefijos previos, código de etapas 1–3D.2A, Core, 402 exclusiones y pendientes ajenos. Inventario documental, parche y hashes de las 56 imágenes inspeccionadas en `backups/ux-ui-stage3d2a-review/2026-11-09/`; las capturas originales se referencian, no se duplican ni se modifican. Sin pruebas/build/navegador nuevos, producción, commit/push/deploy. Diff-check y preservación por hashes; V11 pausado.


<a id="cierre-panel-3d2a"></a>

## Cierre visual PANEL 3D.2A — 09-11-2026

Remate independiente sobre 3D.2A y su revisión. Sólo PanelRenderer y su prueba de presentación: sin cambios de queries, handlers del renderer, filtros, páginas, modelos, proyección de valores, snapshots o preparación. Dos columnas para campos breves cuando la fila apilada dispone de 600 px interiores; texto extenso/TEXTAREA y varias entradas conservan ancho completo. Móvil permanece vertical; mismo árbol, claves y orden, sin ocultar campos.

El pie TABLE utiliza posición sticky inferior en web **dentro del mismo ScrollView**, conservando su flujo natural después de resultados cortos y acceso durante scroll largo. Sigue desplazándose el contenido; ningún cambio de tamaño o grilla. Botones compactos de 44 px con chevrones Anterior/Siguiente y nombre accesible completo bajo 340 px; número de página conserva su nombre accesible. Encabezado estrecho reduce fuente 16→14 sin truncar. Native conserva flujo desplazable; sticky y su evidencia corresponden a Chromium web, no acreditan Safari físico/native.

Fixture idéntico antes/después: fila de nueve campos 559→451px a 768/1024/1440; móvil 559 sin reducir datos. Alto del módulo 552/368 y mínimo 300 intactos. Pie visible al inicio y mitad de scroll final en 4 anchos, frente a no visible en base. En módulo mínimo 768/1024 el pie deja de ocupar tres filas; acciones de 44 px accesibles. Texto largo sigue requiriendo scroll. Búsqueda RELATION «dos» y selección «Referencia sintética uno» simultáneas capturadas en 4 anchos, ID ref-1 conservado; etiquetas ausentes ONE/MANY e identificadores secundarios capturados aparte, sin inventar nombres.

110/110 afectadas (renderer/modelo/caché/revisión/SQLite/diagnóstico) PASS. Regresión de pie/handlers RED sobre base→GREEN final; sin nuevas pruebas por colores. Typecheck/lint afectado (2 archivos)/build habitual/diff-check PASS. Bundle entry-91083a3d41cb4bb59f3bdb11d736a6a2.js; API pública, namespace epoch2, index/sw y lector JS/WASM 3.1.6 precacheado verificados.48 sentencias previas al render y helpers KPI/state/page-size, estilos legacy y loaders intactos.

Renderer Chrome153/OPFS real con API sintética:23 consultas PANEL idénticas, búsqueda compartida, filtros tipados, páginas2/1 por Enter, empty/error/retry; resize en 4 anchos y límites conserva nodos/valores/foco y genera 0 solicitudes. Cierre completo/reapertura offline:13 snapshots y huella idénticos incluso entre base/candidato, integrity_check=ok,0 API PANEL/0 escrituras, pendientes vacíos intactos. No se acredita nuevo envío de outbox poblado ni aceptación Core/productiva. Sin preparación automática nueva ni cambio del límite de paginación vacía.

Controles iniciales conservados: dependencia Platform duplicada en prueba corregida; variable lexical repetida y espera del texto largo de página en arnés corregidas sólo allí (la petición página 2 ya había sido correcta). Sin aumentar timeouts. Sólo resúmenes, sin copiar logs/perfiles/bases/dist. Sin nuevos errores de runtime en recorridos finales.

**Resultado:** PANEL validado localmente sin bloqueo para iniciar REPORT TABLE. Inventario incremental y combinado 3D.2A, parches, hashes/capturas/checks en `backups/ux-ui-stage3d2a-final/2026-11-09/`. Baseline local archivada, no HEAD desnudo; no stage de archivos completos. Etapas previas, revisión, Core, 402 exclusiones/ajenos conservados. Documentos UX_UI_REDESIGN, STATUS y DESKTOP_INTERFACE; runtime STATE_UPDATE intacto. Sin publicación ni producción; V11 pausado.


<a id="etapa-3d2b-report-table"></a>

## Etapa 3D.2B — REPORT TABLE, local 09-11-2026

Iniciada después de validar y congelar PANEL 3D.2A final; lote separado. ReportRenderer mantiene sus 23 sentencias previas al render idénticas: sesión, período, query, effects, guard, carga/error y telemetría. CurrentStatusReport, ReportMatrix, PeriodControl, DateInput y todos los estilos legacy idénticos por comparación AST. No cambios de API, modelos, displayRecordValue, time-filter, consolidación, MATRIX, LATEST_BY_RELATION, CURRENT_STATUS, KPI o almacenamiento.

TABLE agrupa período y Actualizar con FormActions/FormAction, reutilizando el PeriodControl existente sin variantes funcionales. RANGE editable usa ancho disponible hasta 620; MONTH/fijo mantienen ancho natural y acciones próximas. Mismos callbacks y disabled: cambiar período consulta como antes; Actualizar sigue deshabilitado si allowChange=false. No se añade Aplicar, búsqueda ni paginación. Carga inicial/error/vacío conservan condiciones y mensajes; actualización con copia añade texto «Actualizando reporte…» sin retirar los datos o bloquear controles que antes estaban habilitados.

ReportTable mide su ancho interior. Si caben sus columnas de mínimo 160, comparte geometría entre encabezados y celdas con texto completo. Si no, presenta los mismos campos ordenados como etiqueta/valor; desde 600 px, campos breves pueden compartir dos columnas. Textos extensos/TEXTAREA y valores múltiples conservan ancho completo. Una sección por registro y separador, sin tarjeta por campo, ni tablas ocultas duplicadas. REPORT usa scroll de página natural, sin heredar el viewport fijo de PANEL, ni recortar filas/columnas/resultados. Mayor altura y DOM por información completa son costes explícitos; no se promete rendimiento productivo ni se introduce virtualización.

Proyección nueva `report-read-presentation.ts`, pura y exclusiva TABLE: metadata/config por field.id, datos por field.key; mismo modelo, orden e IDs. SELECT resuelve label disponible y representaciones canónica/optionId; INTERNAL_VALUE mantiene exactamente el string existente, incluida mayúscula. RELATION ONE/MANY muestra displayName disponible y conserva cada entrada sin etiqueta con explicación e ID secundario. Vacío y dato ausente se distinguen por texto. Sin catálogos por fila ni nombres inventados. Fechas y BOOLEAN mantienen su formato TABLE anterior (ISO/true-false en el fixture); no se modifica silenciosamente el formatter compartido.

| Validación local | Resultado |
| --- | --- |
| Pruebas |33/33 afectadas (12 nuevas de proyección/componentes +21 modelos/períodos/caché).12/12 repetidas sobre contenido final. Regresión renderer anterior RED→GREEN de entrada RELATION sin etiqueta. Typecheck y lint (3 archivos) PASS. No suite completa; fallos históricos ajenos no reevaluados. |
| Builds/artefacto |Build habitual final PASS, entry-64fafbfb82218bf2cda3c7667842febb.js. Dos builds: el primero detectó separación excesiva del control mensual; corregida sólo su distribución antes del segundo. API https://web.opco.cl, namespace opco-client-v10-epoch2.db, index/sw y lector JS/WASM local 3.1.6 precacheado verificados. |
| Renderer y consultas |Chrome153/Linux a 390/768/1024/1440, tabla de 10 campos y tabla de 2 campos, texto extenso/ONE/MANY/ausencias/SELECT/INTERNAL_VALUE, RANGE/MONTH/fijo.4 consultas/respuestas idénticas en comparación visual y16 idénticas en recorrido de controles/errores. Todos los 28 registros y valores originales conservados. |
| Teclado/resize |RANGE conserva nodos/foco/valores al cambiar 4 anchos y 899/900/1199/1200; 0 solicitudes por resize. Tab abandona el input DATE tras 4 pulsaciones tanto en base como candidato. Enter en Actualizar produce una petición; botones mes/input mantienen mismos rangos. Período fijo no dispara lectura al intentar su acción deshabilitada. |
| Carga/error/vacío |Respuesta retenida con copia visible; HTTP503 con copia conserva snapshot; error sin query compatible no muestra resultados de otra consulta. Respuesta vacía explícita conserva su estado. Sin ocultar los errores para mejorar apariencia. |
| OPFS frío |Cerrar proceso y reabrir mismo perfil offline conserva 10 snapshots, huella idéntica entre base/candidato y tras reapertura, integrity_check=ok. Copia exacta visible; consulta no guardada mantiene el error existente. El loader **continúa remoto primero/fallback por OpcoNetworkError**: no se convierte en local-only ni se acredita preparación de otros rangos. Pendientes vacíos antes/después, 0 escrituras. No nuevo ensayo de outbox poblado/sync ni aceptación Core. |

Evidencia de errores, permisos y sincronización no se amplía por estas imágenes: API/HTTP503/respuesta retenida son sintéticos; SQLite/OPFS, SW, cierre del proceso y navegación son reales. No prueba de Core productivo, cámara, Safari físico/native o lector de pantalla. No se registran imágenes o identificadores personales: fixture ficticio local.

Controles iniciales separados del candidato: fixture tipado contenía createdAt no admitido, corregido sólo en prueba; la primera aserción esperaba abandonar DATE con un solo Tab y se ajustó tras medir 4 en ambos runtimes. Una segunda navegación dura Page.navigate en la **base anterior** mostró espera por bloqueo OPFS; causa no investigada en este alcance. Se conserva ese control y se usa navegación SPA real para recorrer experiencias, además de cierre/reapertura de proceso acreditado por separado. No se borra almacenamiento, cambia código OPFS ni se atribuye el control a esta entrega. Sin aumento de timeouts; sólo resúmenes, no logs.

**Resultado:** REPORT TABLE validado localmente, sin bloqueo nuevo demostrado en el alcance. Respaldo `backups/ux-ui-stage3d2b/2026-11-09/`: inventario/parche sobre baseline local que incluye PANEL final, hashes/checks y capturas. Etapas previas y 402 exclusiones/ajenos preservados; no stage de archivos completos. Documentos UX_UI_REDESIGN, STATUS y DESKTOP_INTERFACE; STATE_UPDATE no cambia porque no se altera su runtime. Sin Core/producción/configuración/commit/push/deploy; V11 pausado.

Recomendación 3D.3 MATRIX: sólo diagnóstico visual propio antes de implementar. Mantener calendario, encabezados, Sets, resúmenes, claves y ordenamiento; no trasladar automáticamente la fila apilada ni proyección TABLE al cálculo MATRIX. CURRENT_STATUS/LATEST_BY_RELATION siguen un incremento independiente pendiente, no absorbido en TABLE ni MATRIX. Revisar capturas de ambos lotes antes de su eventual publicación.


<a id="etapa-3d3-matrix"></a>

## Etapa 3D.3 — MATRIX, local 09-11-2026

Diagnóstico visual presentado y archivado antes del código: fixture de 32 filas, 18 categorías extensas y variante mensual de 30 días. Las columnas anteriores de 72 px fragmentaban las etiquetas; el nombre de fila desaparecía al desplazar horizontalmente y la cabecera salía de pantalla durante la lectura vertical. No había capturas MATRIX extensas previas suficientes: se generó evidencia sintética propia, sin inferir problemas de producción. El modelo usa Sets de strings y frecuencias del summaryField, **no sumas numéricas ni un total general**; se mantiene exactamente.

Sólo ReportMatrix y estilos propios: viewport web bidimensional acotado a min(68vh,720px), encabezados y primera columna fijos, foco visible y acceso por teclado. Conserva la matriz, todos los campos/textos, claves y orden; no se convierte en tarjetas. Ancho compartido entre cabeceras/celdas: 72 para etiquetas cortas, 160 para extensas; primera columna 144 en contenedor estrecho/220 en el resto. Resumen ajustado al espacio restante para que pueda leerse junto al nombre de fila. Números alineados y filas alternas; valores y placeholders originales intactos. Indicador de desplazamiento sólo cuando hay desbordamiento interior.

Costes explícitos: en categorías extensas la grilla pasa de 1638 a 3193/3322 px; exige más desplazamiento horizontal. La primera fila extensa pasa de 117 a 141/121 px en el control inicial: no se presenta como reducción general de altura. El resumen puede aumentar la altura de todas las celdas de su fila; no se trunca para obtener densidad artificial. No virtualización ni medición de rendimiento productivo. Native conserva scroll convencional; sticky y viewport CSS sólo web, sin acreditación física nativa.

| Validación | Evidencia |
| --- | --- |
| Semántica y otros modos | ReportRenderer completo, CurrentStatusReport, PeriodControl, DateInput, ReportTableControls, ReportTable y estilos anteriores idénticos por AST. Modelo/formatter/servicios/API/storage y modos CURRENT_STATUS/LATEST_BY_RELATION/KPI intactos. Sin nuevas consultas, sumas, paginación ni resolución de etiquetas. |
| Pruebas | 27/27 afectadas: 6 nuevas de presentación/modelo real y 21 de modelos/período/caché; 6/6 repetidas sobre fuente final. Regresión del viewport accesible/fijo RED en renderer previo → GREEN. Typecheck, lint de 2 archivos, build habitual y diff-check PASS. No suite completa; fallos históricos ajenos no reevaluados. |
| Visual/consultas | Chromium 153/Linux real a 390/768/1024/1440. Tres consultas/respuestas idénticas y todas las celdas iguales en categorías, mes y ausencia de resumen. 32 filas; 18 categorías o 30 días, ceros, vacíos, valores múltiples y resúmenes sin cálculos nuevos. Cabecera visible y primera columna fija al desplazar ambos ejes en cuatro anchos. |
| Interacción | Tab llega al viewport; flechas y rueda reales desplazan ambos ejes, sin peticiones nuevas. Resize conserva nodos, foco y período: 0 consultas. Recorrido RANGE/MONTH, Actualizar con Enter, copia retenida, error con/sin copia y vacío: 13 consultas y 11 respuestas idénticas antes/después. |
| OPFS frío | Cierre completo del proceso y reapertura del mismo perfil offline: 8 snapshots con huella de contenido idéntica entre base/candidato/reapertura, grilla completa igual e integrity_check=ok. Reconexión sin escrituras. Pendientes vacíos antes/después; no ensayo nuevo de outbox poblado/sync. |
| Artefacto | entry-7ff6f7e8baeedac60fde0baa41fd2bd1.js, API https://web.opco.cl, namespace opco-client-v10-epoch2.db, index/sw coincidentes y lector JS/WASM 3.1.6 local precacheado. Dos builds: el primero se retiró tras un solapamiento propio del resumen móvil; corregido y validado en el final. |

Se conserva el loader REPORT remoto primero/fallback por error de red: estas pruebas no lo convierten en local-only ni acreditan preparación automática de otros períodos. Son snapshots de consultas exactas, sin nueva garantía de cobertura/frescura. API, HTTP503 y respuesta retenida simulados; navegador, eventos de teclado/rueda, SQLite/OPFS, SW y cierre/reapertura reales. Sin Core/productivo, Safari físico, tacto físico, native ni lector de pantalla; no se generaliza Chromium a esos entornos.

Controles iniciales documentados: resumen móvil de ancho fijo quedaba parcialmente detrás del nombre fijado; corregido sólo su distribución. El arnés seleccionaba una ruta MATRIX oculta retenida por la navegación al usar querySelector; se corrigió el selector para leer exclusivamente el renderer visible y se repitieron las comparaciones. No fue un defecto demostrado del motor ni se alteró su navegación. Métrica inicial headerAtTop sólo relativa a viewport: se añadió headerWithinPage y se contrastó con imágenes. Sin aumentar timeouts ni borrar almacenamiento; sólo evidencia sanitizada, sin logs/perfiles/bases/dist en respaldo.

**Resultado:** validado localmente para revisión/cierre del lote independiente, sin bloqueo funcional nuevo demostrado en este alcance. Inventario, parche incremental sobre baseline local posterior a REPORT TABLE y PANEL final, hashes/checks y capturas: backups/ux-ui-stage3d3/2026-11-09/. No aplicar como si fuera HEAD desnudo ni preparar archivos completos con hunks ajenos. Documentos actualizados: UX_UI_REDESIGN, STATUS y DESKTOP_INTERFACE; STATE_UPDATE no cambia porque su runtime permanece intacto. Core, etapas previas, 402 exclusiones y pendientes conservados; sin configuración/producción/commit/push/deploy. V11 pausado. Próximo paso: revisión conjunta de capturas y cierre/publicación sólo con autorización independiente; CURRENT_STATUS/LATEST_BY_RELATION/KPI siguen separados.


<a id="identidad-visual-temas-propuesta"></a>

## Identidad visual y temas — propuesta pendiente de aprobación, 09-11-2026

**No se aplica un tema global ni se modifican fuentes funcionales.** Esta revisión conserva todos los lotes UX anteriores. Especificación versionada y ejemplos estáticos en [design/proposals/visual-identity-2026-11-09](../design/proposals/visual-identity-2026-11-09/README.md); no son componentes conectados al Client. La aprobación visual debe preceder a la adopción.

### Evidencia revisada y diferencias reales

Se inspeccionaron las 54 capturas MATRIX en nueve láminas comparativas (antes a la izquierda/después a la derecha), ampliando el resumen768. Se revisaron además imágenes originales representativas de etapas1/2,3A final,3B,3C,conflictos final,3D.1 final,PANEL final y REPORT TABLE antes/después. Se registran nombres/hashes y método de inspección en el respaldo; no se declara revisión individual de todas las capturas de las demás etapas. Evidencia histórica sintética/Chromium de cada lote, no nuevos recorridos productivos.

| Hallazgo | Evidencia y responsables | Implicación para el tema |
| --- | --- | --- |
| Dos familias cromáticas | Inicio390/confirmaciones muestran turquesa; escritorio3B y formularios usan azul. `desktop-presentation.ts` define desktopPalette y oldColors; Attendance/STATE_UPDATE conservan estilos base/adaptados. | Adoptar una sola familia azul por roles, conservando navegación grafito como área diferenciada en ambos temas. No reemplazar strings globalmente. |
| Primarias diferentes | MATRIX Actualizar casi negro frente a Guardar azul3A y Confirmar turquesa de conflictos. `ReportRenderer.tsx` styles.filterButton; `form-actions.tsx`; estilos de workflows. | Misma acción primary en cada tema; el texto y handler siguen definidos por la experiencia. Destructiva sólo cuando la acción actual lo sea, sin inferirlo por etiqueta/estado. |
| Superficies y bordes próximos pero independientes | RECORDS fondo turquesa pálido; REPORT/PANEL gris; MATRIX usa franjas/resumen propios. `RecordFieldInput.tsx`, estilos de RECORDS, `PanelRenderer.tsx`, `ReportRenderer.tsx`. | Roles canvas/surface/raised/subtle/alternate, borde decorativo distinto de control identificable. No borrar grupos o modificar la geometría de módulos como parte de la tematización. |
| Tipografía, densidad y radios locales | FieldFrame15/21, etiquetas de tablas13, controles16; FormLayout radio10 frente a control8 y diálogos distintos. Capturas3A/PANEL/RECORDS/MATRIX. | Jerarquía común, sin imponer tamaño16 a toda tabla. Escala de espacios y radios; densidades de lectura/edición distintas, mismos mínimos táctiles. La altura por texto completo de MATRIX no se corrige ocultándolo. |
| Estados todavía cromáticos por pantalla | Guardado local visible en verde en una captura3C; red/actividad/errores conviven con la copia. `sync-status-diagnostics.ts`, shell, badges de registros y ReadLoadingState. | Mapeo visual sobre el estado ya resuelto. Guardado local azul, pendiente ámbar, ACK verde, error rojo y conflicto violeta; offline neutro. No recalcular éxito, prioridad o cobertura para asignar colores. Texto/icono siempre presentes. |
| Foco y modo oscuro incompletos | `keyboard-focus.tsx`, CompactSelect y MATRIX fijan #315DA8; inputs/modales blancos. `app/_layout.tsx` fija StatusBar dark; no ThemeProvider/useColorScheme en la aplicación actual. | Foco por superficie y dos temas explícitos, incluyendo controles web, portales y fondo de navegación. El mapa oldColors sólo sustituye algunas propiedades directas: no es motor de tema ni cubre estilos anidados/literales restantes. |

La mejora de contraste no se deduce de una captura reducida: la propuesta se calcula con sus colores declarados. No se certifican aquí todos los contrastes actuales ni accesibilidad de pantallas reales.

### Paleta recomendada

Roles semánticos estables; colores completos, pares y estados en [tokens.proposed.json](../design/proposals/visual-identity-2026-11-09/tokens.proposed.json). No inversión automática, filtros CSS, colores específicos de contrato ni cambios a EntityField/AppView.

| Rol | Claro | Oscuro |
| --- | --- | --- |
| canvas | #F4F6F8 | #101827 |
| surface / raised | #FFFFFF / #FFFFFF | #182235 / #202D43 |
| surfaceSubtle / alternate | #EAF0F6 / #F6F8FB | #25354D / #1D2940 |
| text / secondary | #202B3A / #536174 | #F1F5F9 / #BDC9DA |
| border decorativo / controlBorder | #DCE2EA / #7B879A | #35455D / #7F91AE |
| primary / onPrimary | #315DA8 / #FFFFFF | #9ABBFF / #102342 |
| primary hover / pressed | #274D8C / #203F75 | #B3CDFF / #82ABF5 |
| selección / texto | #E8EFFA / #203F75 | #253D64 / #D6E6FF |
| foco contenido / navegación | #315DA8 / #A8C7FF | #A8C7FF / #A8C7FF |
| navegación / texto | #18263A / #E5EAF2 | #101B2D / #E5EAF2 |
| información, guardado local | #235EA8 sobre #EBF3FF | #A4CAFF sobre #1B304D |
| éxito confirmado | #176544 sobre #E8F5EE | #8DDDB5 sobre #15352C |
| advertencia/pendiente | #7A4700 sobre #FFF4DB | #FFD58A sobre #332A1C |
| error | #B42318 sobre #FFF0EE | #FFB4AB sobre #3E2327 |
| conflicto | #6337A3 sobre #F3ECFC | #D9C0FF sobre #302440 |
| deshabilitado / texto | #E5EAF1 / #536174 | #29354A / #A8B6CB |

El botón secundario usa superficie + borde de control y texto azul; hover/pressed tienen fondos propios. Disabled usa pares explícitos, no opacidad sobre fondos desconocidos. Texto de placeholder conserva contraste suficiente; no sustituye la etiqueta. Separadores decorativos no se usan como única señal para identificar inputs. La prioridad y etiquetas de sincronización siguen siendo responsabilidad de los mappers actuales: verde no significa por sí solo online, cero pendientes o toda la información preparada.

### Tokens no cromáticos y componentes

- Fuente del sistema existente: sin CDN, nueva fuente o preparación de assets. Input/cuerpo16/24, tabla14/20, etiqueta14/20 semibold, metadata13/18, sección20/28 y título24/32. Conservar escalado, saltos y valores completos; números tabulares sólo en lectura numérica. 12px no se propone para información operativa esencial.
- Espacios: 0/2/4/8/12/16/20/24/32/40/48/64. Label/control8, campos16–20, secciones24, padding16 compacto/24 amplio. Cortes de layout y tamaños PANEL configurados se conservan: la tabla de tokens no autoriza recalcularlos.
- Radios:0 separadores/filas,4 badges,8 controles,12 secciones/diálogos. Bordes1, foco3 con separación2 sin desplazar contenido. Superficies de lectura sin sombra; sombra moderada sólo dropdown/dialog, con overlay diferente en cada tema.
- Controles mínimo44 y acciones mínimo112 de ancho, conservando excepciones compactas ya acreditadas y nombres accesibles. Hover sólo mejora mouse; pressed/touch/foco explícitos. No reducir controles por tener puntero fino ni añadir animaciones.
- Iconos de la librería existente,18/20/24 y trazo2, color heredado del rol, con etiqueta accesible. Conservar resolución/fallback de iconos configurados; no convertir claves técnicas en textos ni inventar iconos por entidad.
- Reutilizar FormLayout/FormGrid,FieldFrame,FormActions/FormAction,CompactSelect y RecordFieldInput, ReadLoadingState, navegación, proyecciones de lectura/conflicto y badges existentes. Consolidar pintura, sin cambiar sus props, estados disabled, validadores o handlers. RELATION mantiene Buscar opciones y Selección actual diferenciados; SELECT conserva identidad, labels y ONE/MANY.
- RECORDS conserva lectura agrupada; PANEL sus dimensiones/scroll/paginación; REPORT TABLE su adaptación; MATRIX su estructura bidimensional/ejes/resúmenes. No unificar sus modelos ni formateadores para reutilizar colores. Modales mantienen comparación y decisión explícita, sin cambiar comandos.

### Arquitectura y preferencia propuestas, todavía sin implementar

Una fuente de tokens tipada (futuro `src/theme/tokens.ts`) y un proveedor de presentación estable (futuros theme-provider/use-theme-styles) resuelven light/dark; estilos derivados por tema, sin mutar desktopPalette ni ampliar oldColors. Mantener un adaptador light para consumidores legacy mientras se migran. No cambiar SessionProvider, contexto de negocio o apertura de base para resolver colores.

Recomendado: seguir preferencia del sistema; null/ausente → claro. React Native0.86 documenta [useColorScheme](https://reactnative.dev/docs/0.86/usecolorscheme) y sus actualizaciones. No se propone selector manual ni persistencia nueva en esta etapa; un override requeriría acordar su UX aparte. Cambiar esquema sólo repinta: no keys basadas en theme, remount, reset de borrador, nuevas dependencias de effects de datos, refetch o invalidaciones. Paletas locales, disponibles offline desde el bundle existente; no API/Core/storage/namespace nuevos.

Antes de habilitar oscuro global, cubrir también Stack/fondos transitorios, login/restauración, menú/diagnóstico, portales/modales, CompactSelect web/nativo, fecha/hora nativos, cámara e interfaces controladas por el navegador. `color-scheme` acompaña controles web, sin filtro invert. La [documentación Expo SDK57 StatusBar](https://docs.expo.dev/versions/v57.0.0/sdk/status-bar/) distingue native/web: en web no controla la barra del sistema. No prometer una barra PWA oscura sólo por ajustar ese componente; revisar theme-color/manifest por separado durante adopción, sin borrar cachés. El estado actual de Native/sistema no queda acreditado por HTML.

### Adopción incremental propuesta

| Lote futuro, tras aprobación | Alcance y puerta de salida |
| --- | --- |
| T1 Tokens y primitivas | Fuente light/dark tipada y preview; componentes compartidos con defaults light equivalentes. No activar oscuro global. Probar variantes normal/hover/pressed/focus/disabled/error y persistencia de nodos/borradores al repintar. |
| T2 Navegación, acceso y superficies transitorias | Cabecera/sidebar/menú, login, diagnóstico, confirmaciones, SELECT/RELATION/cámara/temporales. Mantener todos los accesos; no implementar la maqueta como nuevo árbol de navegación. Verificar portales/teclado y fondo de arranque. |
| T3 Renderers | Incrementos RECORDS, luego Attendance/STATE_UPDATE, luego PANEL/REPORT/MATRIX. Sólo estilo; comparar consultas, comandos, cálculos, revisiones y snapshots, preservando cada layout. Modos no ejemplificados también se pintan sin alterar su lógica. |
| T4 Oscuro global y cierre | Sólo cuando todas las superficies estén cubiertas; preferencia del sistema y fallback claro. Chromium4anchos, teclado, zoom/escalado y dispositivos reales pendientes. Cierre/reapertura OPFS con borrador/pendientes/conflicto y reconexión: mismos payloads/identidades. Publicación requiere autorización independiente. |

No publicar un oscuro parcial que mezcle formularios blancos, texto claro o un modal sin tematizar. Hasta T4, adopción light y previews dark locales. Reversión por lote de pintura, sin cambiar base/configuración productiva ni retirar pendientes; la introducción del proveedor no debe convertirse en dependencia funcional del motor.

### Comprobaciones de esta propuesta y límites

- **98 pares** calculados por luminancia relativa: texto mínimo4.5288:1 y controles/foco identificables mínimo3.3570:1. Comparación con valores sin redondear; separadores decorativos fuera del criterio de control. Referencias [WCAG2.2 contraste de texto](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) y [contraste no textual](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). No certificación general ni medición de overlays/antialiasing de todos los SO.
- Ocho capturas estáticas claro/oscuro a390/768/1024/1440 y cuatro de foco/pressed; Chromium153/Linux. Revisadas en tamaño completo representativas claro/oscuro390/1440, oscuro768 y claro1024. Tab/foco3px, hover/pressed y resize de los mismos inputs acreditados **sólo en el HTML de ejemplo**. Sin requests externos, imports de Opco ni handlers de negocio. No constituye validación de workflows, Core, renderer nativo o modo offline de la aplicación.
- La galería muestra muchos estados/componentes a la vez para compararlos; no propone exhibirlos todos en una pantalla real. No rediseña la navegación, añade tabs de producto ni autoriza eliminar cuenta/contrato/diagnóstico ausentes del ejemplo. El estado de error y los valores de ejemplo son ficticios.
- No suites, typecheck, lint o builds de la aplicación: no hay cambio funcional ni aplicación de tema. Diff-check, JSON/HTML y preservación por hashes sí. Las pruebas de reapertura/offline/sync previas permanecen válidas para su contenido original, **no prueban el futuro tema**. Validación real y Safari/native/lector de pantalla quedan para la adopción aprobada.

Riesgos principales: superficies legacy no migradas; overrides por ancho que ganen al nuevo tema; controles nativos no totalmente estilables; foco sobre navegación/overlay; cambios accidentales de métricas; remount/effects por tema; confundir estados operacionales por color. Todos requieren controles explícitos anteriores, no nuevas reglas de negocio. La maqueta se ajustó para que un SELECT no se estirara por la altura de su vecino: sólo ejemplo estático, sin modificación de controles existentes.

**Entrega:** propuesta de paletas, tokens, ejemplos e incrementos lista para revisión; implementación global pendiente de aprobación. Respaldada en backups/ux-ui-visual-identity-proposal/2026-11-09/. Código Client/Core, etapas1–3D.3,402exclusiones y pendientes conservados. Sólo documentación y artefactos de diseño nuevos; sin producción/commit/push/deploy;V11 pausado.


<a id="identidad-visual-fase1"></a>

## Identidad visual — fase 1 local, 09-11-2026

Dirección aprobada: tokens.proposed.json del09-11. **Sólo tema claro activo; oscuro global NO HABILITADO.** Fuente tipada nueva `src/theme/tokens.ts`: paletas light/dark completas y exactamente iguales a la propuesta, versión1, espacios, radios, tipografía, métricas y foco. `control-presentation.ts` deriva pintura de campo/acción sin datos de negocio. Sin ThemeProvider, listener de apariencia, selector de tema, preferencia persistida o nuevos recursos de red. El tipo oscuro queda disponible para adopción posterior; no se aplica por la preferencia del SO.

| Componentes migrados | Cambio de presentación |
| --- | --- |
| FormLayout/FormGrid | Colores, radios y espacios semánticos; mismo máximo960, umbrales600/820, claves, instancia y cálculo de columnas con gap20. Sin reorganizar los slots previos. |
| FieldFrame | Etiquetas14/20, ayuda/error14/20, foco/invalid semánticos. Disabled deja de atenuar todo el subárbol: pinta su etiqueta sin intervenir en el estado disabled del control que entrega el caller. IDs y errores accesibles conservados. |
| FormAction/FormActions | Primaria/secundaria y pares explícitos hover/pressed/disabled; texto/spinner siguen busy y disabled originales. El borde y fondo identifican la secundaria. Mantiene callback, aria-busy, etiquetas y autorización del caller. |
| CompactSelect | SELECT y MULTISELECT usan los mismos tokens claros, mínimos44, foco3px sin engrosar el borde/cambiar geometría, selección/menú/overlay/hover/pressed/disabled e inválido. Mantiene valores, required, unavailable, indicador inline/end, opciones, paginación ajena y callbacks. |
| RecordFieldInput | Composición legacy/form, TEXT/TEXTAREA/numéricos, BOOLEAN y RELATION ONE/MANY pintados con tokens. Misma separación Buscar opciones/Selección actual, mismos IDs/labels/handlers; Más opciones conserva disabled y acción. Vacíos, errores de cardinalidad y catálogos se mantienen. |
| Temporales web/native | DATE/TIME/MONTH/DATETIME conservan todos sus validadores, min/max, step, draft y composición. Campos y Limpiar≥44; clear sólo si ya correspondía. Web usa color-scheme:light explícito; picker nativo conserva sus props/implementación del sistema, sin forzar una nueva configuración nativa. |
| KeyboardFocusStyles/ReadLoadingState | Foco3px/offset2 referenciado desde tokens; color y tipografía comunes de lectura. No cambia animación, reduced-motion, mensajes ni actividad/telemetría. |

Compatibilidad: desktopPalette/oldColors, shell, estilos propios de workflows, otros renderers, API, helpers de valores y almacenamiento intactos. No se transforma el mapa legacy en un tema global ni se retiran sus exports. La nueva paleta clara coincide en los roles comunes con desktopPalette. Fuentes de sistema web y default nativo; sin CDN o dependencias. No se modifica FormGrid a modo oscuro ni se remontan controles según tamaño/tema. Es un incremento sobre etapas1–3D.3 y la propuesta, sin revertir sus hunks.

Las medidas visuales sí cambian donde corresponde a la aprobación: radio de sección10→12, etiquetas15/21→14/20, controles base46→44, Clear42→44, lineHeight24 y pares de disabled explícitos en vez de opacidad. Textos largos pueden aumentar su altura; no se truncan. Ajustado MULTISELECT para no añadir padding vertical adicional frente a SELECT: ambos empiezan en44 y crecen sólo para contenido completo. No afirmar una reducción uniforme de altura; en el fixture temporal/DATETIME puede aumentar el espacio.

### Evidencia final y controles

- **110/110 pruebas focalizadas** en13archivos, incluidas6nuevas y98pares de contraste (49por paleta). **16/16 repetidas** tras remate de SELECT/MULTISELECT; modelos, readonly/valores/controlled, accesibilidad, cardinalidad, contextos Attendance y extras STATE_UPDATE/SQLite, REPORT/MATRIX entre los consumidores cubiertos. No suite completa ni cámara. Typecheck y lint afectado finales PASS,0errores/warnings; diff-check PASS.
- Contraste: mismos98pares aprobados, mínimos texto4.5288 y controles/foco3.3570, sin redondear para decidir. Invalid, disabled, selección y acciones usan pares explícitos, no opacidad arbitraria. No certificación de accesibilidad completa, overlay/UA o lectores de pantalla.
- Chrome153/Linux con renderer Client real a390/768/1024/1440, fixture/API/ACK sintéticos. SELECT canónico, MULTISELECT/RELATION MANY y ONE con búsqueda/selección simultáneas, BOOLEAN por Space, DATE y DATETIME parcial/completo, required, clear, Tab/Escape, foco, hover/pressed y resize. Valores y nodos/foco conservados en4anchos y límites adicionales899/900/1199/1200/320;0solicitudes por resize. Preferencia oscura simulada mantiene campos blancos/texto oscuro en4anchos; input/Limpiar mínimos44, borde1 y outline3 sin cambiar tamaño.
- Comparación antes/después: misma huella de valores y mismos valores restaurados. Cierre completo de Chrome y reapertura offline del mismo perfil OPFS conservan un pending_create sintético, clientRequestId, identidad y payload exactos dentro de cada ensayo; integrity_check=ok. Reconexión da exactamente1ACK simulado usando ese clientRequestId; no duplicados. Compara contenido entre ensayos independientes, sin fingir que IDs aleatorios deben coincidir entre ellos. Ensayo visual/interactivo adicional termina con0pendientes/0escrituras.
- Comparación AST de **101 atributos controlados**, effects/memos y handlers puros originales: idénticos. Sin cambios de onPress/onChange/onChangeText/onKeyDown/value/required/multiple/disabled/options/min/max/step o callbacks de relación. Sólo nuevos estados locales de pintura hover, sin acceso a servicios ni cambios al motor. No nuevo recorrido de escritura Attendance/STATE_UPDATE completo en navegador; se reutilizan sus pruebas afectadas y el código padre intacto.
- Build web habitual final PASS: entry-bec83d5bfb7707c40d13e0d7d3849c84.js; API https://web.opco.cl, epoch2,index/sw y lectorJS/WASM3.1.6 local precacheado. Dos builds por ajuste visual concreto de altura del selector múltiple; el primero queda retirado. Después sólo se aclararon comentarios web y el texto disabled nativo (no participa en export web); typecheck/lint de ese contenido final pasan. Sin nuevas instalaciones, assets o migraciones.

Primer grupo109/110: un caso de state-update-select-extras terminó a5033ms; JSON sólo conserva STACK_TRACE_ERROR y no permite cerrar su causa. El caso pasa aislado tanto en base reconstruida como candidato; grupo final110/110 con1worker y timeout estándar, sin aumentarlo. No se etiqueta como defecto preexistente ni se atribuye a CPU/concurrencia sin prueba. Sus servicios/persistencia no se modifican. Lint inicial detectó un import sin uso, retirado; typecheck inicial detectó disabled nullable en la función de pintura, convertido con Boolean sólo para pintar, conservando el prop funcional. Controles explícitos en el respaldo.

Arnés de navegador inicial falló en **la base** por reutilizar helper __allUI sin incluirlo en el fixture; añadido únicamente al arnés y repetido el control con perfil propio nuevo. No borrar almacenamiento para aprobar. El primer candidato tenía distinta altura base MULTISELECT; corregido sólo su padding, luego capturado y probado el artefacto final. Perfiles/DB/logs/dist fuera del respaldo; no se copian valores o credenciales reales.

**Límites:** oscuro disponible como tokens, sin UI global ni cambio por sistema; no nuevos estilos de shell/badges globales, sincronización o acciones propias de workflows. Componentes no migrados conservan su pintura legacy: aún puede haber diferencias entre áreas. Safari físico/native/picker real/tacto físico/lector de pantalla pendientes; native tiene typecheck/lint, sin build/dispositivo nativo. API/ACK simulados no acreditan aceptación Core/productiva ni cobertura offline completa. El recorrido comprueba una intención RECORDS sintética; no generalizar a todos los workflows o conflictos operacionales.

**Resultado:** fase1 validada localmente para revisión, lote independiente y reversible. Inventario/parche y baseline exacta posterior aMATRIX/propuesta, capturas/checks en backups/visual-tokens-phase1/2026-11-09/. No aplicar sobreHEAD desnudo ni preparar archivos enteros con pendientes previos. Documentación UX_UI_REDESIGN ySTATUS; STATE_UPDATE no cambia porque no se altera su runtime.402exclusiones, etapasprevias yCore preservados; sin configuración/producción/commit/push/deploy. Recomendaciónfase2: sólo pintura de navegación/superficies transitorias y adopción gradual, manteniendo oscuro global desactivado hasta cubrirlas todas; requiere su propio alcance. V11pausado.

<a id="identidad-visual-fase2"></a>
## Identidad visual — Fase 2 local (09-11-2026)

Incremento independiente sobre todas las etapas UX previas y tokens Fase 1; **claro sigue activo**. Sin nuevos colores ni cambio por preferencia del sistema. Las fábricas de estilos reciben la paleta aprobada para comprobar pintura oscura aislada; no se ha habilitado ni validado una aplicación completa oscura.

- Cabecera única, navegación lateral y menú de cuenta/contexto adoptan superficies, texto, selección y foco semánticos. Permanecen el mismo catálogo asignado, rutas, selección de contrato y handlers. Los Links conservan estilos aplanados requeridos por Expo Slot.
- Diálogos Attendance/STATE_UPDATE y resolución de conflictos RECORDS, avisos, diagnóstico, recuperación de almacenamiento, login y superficie del lector adoptan la paleta. `session.tsx` cambia sólo pintura y dimensiones de controles de su UI; no cambia el proveedor ni sus operaciones. La captura/decodificación de cámara no cambia.
- `theme/operational-presentation.ts` pinta estados ya resueltos. Actividad azul, pendientes ámbar, errores rojos y conflictos violetas; se conservan texto, iconos y prioridades. Inactividad no se convierte en ACK; `synced` no produce una confirmación nueva. No cambia cobertura ni frescura. Hover/pressed/disabled reutilizan los tokens de Fase 1; controles intervenidos de al menos 44 px.
- Los formularios y contenidos no migrados conservan su pintura previa (por ejemplo acciones propias de Attendance móvil). No se amplía a rediseñarlos ni a recalcular estados. Valores, identidades, permisos, handlers, efectos y sincronización intactos: comparación AST de 226 atributos controlados y hooks/efectos en 15 archivos.

**Evidencia:** Chromium 153/Linux real mediante CDP, renderers publicados localmente, API/ACK y registros sintéticos. Navegación RECORDS/Attendance/STATE_UPDATE/PANEL antes/después a 390/768/1024/1440; sin desbordamiento, nuevas lecturas por resize ni pérdida del borrador. Menú con teclado/Escape/foco y tacto sintetizado. Conflicto STATE_UPDATE con etiquetas SELECT/RELATION, cancelación sin escritura, corrección explícita con misma base/fila, intención offline, conflicto durable y cierre completo/reapertura del mismo perfil OPFS: contenido, versiones y clientRequestId conservados, integrity_check=ok. Otro control RECORDS conserva pendiente y payload al reabrir offline y recibe un único ACK sintético tras reconectar. No acredita aceptación Core/productiva ni todos los workflows.

**Claro/oscuro:** 26 pares adicionales de pintura real con contraste de texto >=4.5:1; se conserva la evidencia de 98 pares y paletas exactas de Fase 1. Bancos visuales aislados de fábricas reales en ambos temas, cuatro anchos, controles >=44 y foco de 3 px; son muestras, no una navegación oscura global. Con preferencia oscura simulada, cabecera real permanece clara. Inspección directa de capturas de menú, diálogo, navegación y bancos; el índice distingue capturas y recorridos medidos de las imágenes efectivamente inspeccionadas.

**Checks y límites conservados:** 259/265 pruebas focalizadas aprobadas. Los seis fallos restantes de `state-update-conflict-handlers.test.ts` se reproducen iguales en el control anterior a Fase 2 (1/7 PASS); no se corrigen ni se presentan como errores causados por este lote. Dos pruebas que extraen el JSX del diálogo incorporan únicamente las nuevas dependencias de pintura a su arnés. Typecheck y lint afectado PASS (warning de dependencia de contexto Attendance anterior e idéntico); lint global encuentra dos errores Buffer y cinco warnings adicionales ajenos, sin modificarlos. Build web habitual PASS; API https://web.opco.cl, namespace epoch2, index/sw y lector local JS/WASM 3.1.6 acreditados. Diff-check y reconstrucción estricta del incremento.

**Fallo 5033 ms de Fase 1:** seis ejecuciones predefinidas pareadas del archivo SQLite sin cambios (42/42) y un grupo pareado con 110/110 por versión, con timeout/parallelismo originales; no se reproduce. La primera ejecución del grupo aislado carecía de app/ y design/ (ENOENT en ambos controles); se conservó el resultado y se completaron esos mismos insumos antes de repetir una vez. No se demuestra la causa histórica ni se aumenta el timeout. Pruebas iniciales del lote también identificaron dependencias faltantes del arnés de extracción y nombres de variables de pintura; corregidos antes de la evidencia final.

El arnés antiguo de conflictos completó cinco controles iguales antes/después y después esperó un segundo diálogo que no apareció en ninguno; no acredita ese paso ni demuestra un defecto nuevo. El ensayo focalizado conserva la colisión de creación, cancelación/corrección, conflicto durable y reapertura; no afirma haber aprobado aquella actualización adicional. El arnés de estado necesitó reponer su helper de elementos visibles; no fue un cambio de producto. No ocultar estos intentos iniciales.

**Entrega y reversión:** backups/visual-tokens-phase2/2026-11-09/ contiene inventario, parche, baseline, hashes, resultados sanitizados e índice visual. Aplicar sólo sobre la baseline local posterior a Fase 1; no sobre HEAD limpio ni revertir archivos completos con UX previo. Las 402 exclusiones, pendientes previos, índices Git y Core se verifican por hashes fuera del alcance. Sin producción, configuración, commit/push/deploy. Safari físico, native, tacto físico y lector de pantalla pendientes. El foco nativo del área desplazable del diálogo sigue siendo el de navegador previo; no se rediseñó ese contenedor. Recomendación Fase 3: revisar estas capturas y extender tokens a contenidos/acciones propias restantes mediante lotes, manteniendo oscuro global desactivado; no confundir esta aprobación visual local con una publicación autorizada ni con resolución de los fallos anteriores. V11 pausado.

<a id="identidad-visual-fase3"></a>
## Identidad visual — Fase 3 local (09-11-2026)

**Revisión previa Fase 2:** inspeccionadas sus 108 capturas mediante 27 hojas de contacto, manteniendo el vínculo a cada original. No se demuestra una regresión nueva que justifique corregir Fase 2: ese lote/respaldo permanece independiente. Se observan diferencias de pintura legacy entre móvil/escritorio, aviso de conflicto ámbar frente a cabecera violeta, foco nativo negro en el área desplazable del diálogo y gran altura configurada de PANEL. Los dos últimos ya estaban antes de Fase 2; tampoco se atribuye a estilos la diferente altura del menú390 capturado durante preparación frente a reposo. Revisión estructural de miniaturas no equivale a medición de contraste de cada píxel ni a inspección ampliada de todos los originales.

**Implementación Fase 3:** incremento separado sobre Fases1/2 y todas las etapas UX locales. Se adoptan exclusivamente los tokens aprobados, sin nueva paleta, proveedor o preferencia de tema. Claro sigue activo; las fábricas de estilos aceptan la paleta oscura para preparación y pruebas aisladas.

- RECORDS: listados/búsqueda/detalle/formulario y acciones con canvas neutro, superficies y bordes semánticos, títulos y texto legibles. Se reutilizan ReadFieldList, FormGrid y componentes de formulario; se mantienen valores completos, labels SELECT/RELATION, IDs secundarios y distinción vacío/no disponible.
- Attendance: contextos e identificación conservan el orden y los controles; acciones propias y avisos usan el mismo azul en móvil/escritorio. SubjectIdentity recibe pintura compartida de título/secundarios/limitación sin cambiar su proyección ni displayName. No cambian búsqueda, contexto, fecha, estados ni confirmación.
- STATE_UPDATE: formularios, estados, lectura de sujetos y conflictos adoptan roles semánticos. La lista durable de conflictos usa superficie/borde violeta; continúa comparando las mismas versiones e intenciones. Foco del contenido desplazable del modal usa el token en el selector web de escritorio existente; móvil conserva el foco nativo de ese contenedor. Inputs/botones y MATRIX mantienen sus controles de foco existentes. No se rediseña el lifecycle del diálogo.
- PANEL: filtros, tabla y paginación con superficies/encabezados/bordes compartidos; quedan intactos el tamaño configurado del módulo, scroll interior, consultas, revisión y snapshots exactos. No preparación automática ni consultas offline nuevas.
- REPORT TABLE y MATRIX: controles y lectura coherentes; encabezados, filas alternadas, celdas y resumen con tokens. Se mantienen los ejes fijos, formatos, órdenes, cálculos y consolidación; no nueva paginación, búsqueda ni proyección de datos. La pintura compartida puede alcanzar estilos comunes de otros modos, sin cambio de semántica ni acreditación funcional adicional de KPI/CURRENT_STATUS.

**Preservación:** comparación AST de 201 atributos controlados y hooks/efectos, más 57 funciones completas excluyendo únicamente pintura JSX/CSS: idénticos. No cambian consultas, resultados, permisos, keys, handlers, versiones, payloads, outbox, almacenamiento, sincronización ni Core. El resto de estilos de Fases1/2 y la paleta original permanece intacto fuera del incremento autorizado. Sin nuevos componentes funcionales ni duplicar servicios de datos.

**Checks:** 440/446 focalizadas; seis fallos de `state-update-conflict-handlers.test.ts` idénticos a los preexistentes. Se reutiliza el control anterior, verificando archivo de prueba y handlers idénticos; no se ocultan ni se corrigen. Validación final adicional `content-theme.test.tsx`:4/4 (tres casos ya incluidos en el grupo y un control nuevo de MATRIX enfocado; no sumar como450 pruebas diferentes). 56 pares de contraste de pintura real >=4.5:1, geometría independiente de paleta y viewport MATRIX enfocado con cero/ejes/valores conservados. Typecheck, lint afectado y build habitual PASS; lint conserva un warning de dependencia Attendance anterior. No se repite lint global ajeno (sus errores anteriores siguen documentados). Diff-check y reconstrucción por parche/hashes.

**Chromium153/Linux real, API sintética:** comparaciones antes/después a390/768/1024/1440 para listados/detalle, Attendance/STATE_UPDATE, PANEL, REPORT TABLE y MATRIX. Inspección de 14 hojas comparativas nuevas y originales de conflicto390/bancos claro1440 y oscuro390. No se declara revisión individual de cada nueva captura. REPORT: cuatro consultas/respuestas idénticas; MATRIX: tres consultas/respuestas y firmas completas de celdas/resúmenes idénticas. PANEL conserva exactamente sus marcos configurados. SELECT/RELATION ONE/MANY, textos largos y referencias sin etiqueta visibles, sin truncamiento nuevo.

**Lifecycle real:** RECORDS edita offline una fila, cierra Chrome completamente y reabre OPFS con payload/identidad/base conservados, luego un PATCH/ACK sintético con el requestId original. STATE_UPDATE cancela sin escribir y corrige explícitamente la misma base/fila; replay, conflicto durable y reapertura offline conservan intención y versiones. PANEL conserva13 snapshots y reabre filtros/búsqueda exactos sin API PANEL; REPORT/MATRIX conservan sus snapshots y comportamiento anterior, incluidos fallback/errores. Teclado/foco/arrow/wheel/resize no producen consultas adicionales en los controles verificados. integrity_check=ok. No acredita Core, Safari/iPhone físico, native, cámara ni lector de pantalla; no es certificación offline general.

**Intentos iniciales conservados:** el extractor de estilos de las pruebas nuevas necesitó la constante de ancho de Cargar más y los nombres de las fábricas compartidas; se corrigió el arnés, sin cambiar la implementación para superar aserciones. Los primeros recorridos REPORT/MATRIX se detuvieron por una espera del arnés sobre el título ajeno «Formulario configurado», igual antes/después; se corrigió la espera a la ruta Inicio y se repitieron sólo los ensayos afectados. Nombres de PNG compartidos PANEL/REPORT colisionaban: PANEL se recapturó con prefijo propio. Las capturas offline de nombre genérico no se atribuyen a varios recorridos: el último conflicto STATE_UPDATE las produjo; cada prueba conserva su JSON por separado.

**Límites y reversión:** oscuro se valida mediante fábricas y muestras aisladas, no como app oscura completa ni habilitación global; faltan cobertura integrada de todas las superficies, dependencias/controles nativos y dispositivos físicos. Subsisten los seis tests anteriores, el foco móvil nativo del scroll y los pendientes ajenos. No se reabre la auditoría offline/V11. Fase2 no requiere parche correctivo; Fase3 tiene su propio inventario/baseline/parche/hashes en backups/visual-tokens-phase3/2026-11-09/. Aplicar únicamente sobre baseline local posterior a Fase2, nunca sobre HEAD limpio ni preparar/revertir archivos enteros con otros UX pendientes. Documentación: este contrato y STATUS; STATE_UPDATE.md no cambia por no alterarse su runtime. Las 402 exclusiones, índices, Core y respaldos anteriores preservados. Sin producción, configuración, commit, push o deploy.

<a id="correccion-foco-fase3"></a>
## Corrección visual separada de Fase3 — 10-11-2026

El scroll enfocable del diálogo STATE_UPDATE conserva el foco3px con token aprobado también en móvil y sin atributo tabindex. Sólo cambia el selector CSS; no cambian handlers, valores ni confirmaciones. Inspección Chromium:1px nativo antes,3px después. El parche correctivo es independiente de la integración de temas; paleta clara activa en esta baseline.


<a id="integracion-temas-final"></a>
## Integración de temas y revisión final — local, 10-11-2026

**Resultado:** temas web/PWA integrados localmente; selección Automático/Claro/Oscuro en el menú de cuenta. GO para preparar un cierre publicable del rediseño, no publicación ni certificación universal. Native mantiene claro; Safari/iPhone, pickers del SO y tecnologías de asistencia físicas pendientes. Ninguna configuración productiva cambia.

### Revisión y corrección separada

Se inspeccionaron las 263 capturas de Fase3 mediante 66 hojas de contacto que incluyen cada original. No se afirma ampliación individual de todas las imágenes. Se conserva el archivo original en `backups/visual-tokens-phase3/2026-11-09/screenshots/`. Hallazgo: el foco del scroll del diálogo STATE_UPDATE quedaba nativo en móvil y su selector tampoco alcanzaba un contenedor enfocable sin atributo tabindex. Inspección real Chromium: overflow auto, tabIndex=-1, focus-visible=true, contorno nativo negro de1px. Corrección exclusiva de CSS: selector de descendientes `:focus-visible` fuera del media query, 3px y token de foco; no añade tabindex ni handlers. Ensayo final: contorno3px, claro/oscuro, misma instancia del diálogo. Este cambio tiene parche correctivo independiente; la integración de temas es otro incremento sobre él.

Otros hallazgos: tarjetas/iconos de Inicio conservaban pintura turquesa legacy; se completó su adopción de roles aprobados. PANEL y MATRIX conservan sus tamaños y scroll interior configurados; el espacio correspondiente no demuestra un defecto y no se cambió. Permanecen títulos de contexto en cabecera y de contenido donde cumplen funciones distintas; no se eliminaron capacidades para reducir controles.

### Mecanismo y cobertura

- `theme/paint.ts` enlaza los roles a variables CSS con fallback claro; las paletas puras de `tokens.ts` siguen exactamente las aprobadas. No ThemeProvider que remonte formularios ni dependencia nueva en efectos de sesión. Native usa paleta clara. Los exports legacy `colors`/`activeThemeName` de tokens son defaults puros, no el estado efectivo del navegador.
- Se completan los consumidores compartidos y legacy: navegación, cuenta/contrato, formularios, SELECT/MULTISELECT, RELATION, temporales, login, avisos, errores, diagnóstico y UI de recuperación; RECORDS, Attendance, STATE_UPDATE, PANEL, REPORT TABLE y MATRIX. Superficies de Stack usan canvas. Controles HTML heredan color-scheme. No cambios de payloads, cálculo, consultas ni formato de datos.
- `public/theme-controller.js` resuelve preferencia antes de React. Única clave nueva: `localStorage["opco.appearance.v1"]`; auto sigue matchMedia y cambios del SO, claro/oscuro lo fijan. Storage events sólo de esa clave. Error al persistir se informa: aplica en esa ventana y no anuncia guardado. Sin autenticación, red, SQLite ni usuario/contrato dentro de esa preferencia visual.
- `generate-theme-assets.mjs` genera CSS y bootstrap externo con hash; `generate-service-worker.mjs` lo incorpora al precache existente. Script local bloqueante en head, compatible con script-src 'self', sin CDN ni JavaScript inline. Con el entry bloqueado, navegador real ya muestra canvas oscuro antes de React. No promesa de ausencia absoluta de flash de UI propia del SO.
- Cobertura visual final retenida: siete escenas × cuatro anchos × dos temas =56 capturas; las14 hojas correspondientes se inspeccionaron. Conflicto claro/oscuro, menú, error de preferencia y arranque antes de React añadidos. Las rutas auxiliares tienen adopción estática de tokens; no se afirma haber ejercitado cada rama de error de toda la aplicación. Hover/pressed/disabled/error/foco se conservan en fábricas compartidas y pruebas de contraste; no cobertura universal de controles nativos.

### Comparación con la referencia publicada

Referencia de código: HEAD/origin/main local `ecbf18a1061c1eab2a31e028bfedb7e20da3c557`, reconstruida localmente; no consulta al despliegue ni uso de registros productivos. La comparación observada en esta ejecución usó los mismos fixtures y diez escenas a cuatro anchos por versión. Cabecera móvil: Inicio129→104px y escenas típicas137→104px; Attendance137→124px cuando el nombre ocupa dos líneas. PANEL/REPORT pasan de una región horizontal a ninguna en390; MATRIX conserva una para sus ejes. Sin overflow horizontal de página en esos controles.

La mejora es considerable en organización, lectura de relaciones/textos completos y coherencia. **No equivale a reducir todas las acciones:** conteo visible varía según contexto (Inicio4→3; detalle5→4; formulario10→11; Attendance5→8; STATE_UPDATE4→4). Los objetivos de consulta conservan sus pasos; no se demuestra productividad o comprensión sin capacitación mediante ese conteo. Los archivos temporales de esa comparación no sobrevivieron a la renovación del entorno; esas cifras son observaciones de ejecución, no un artefacto reabrible. No se presentan las capturas anteriores de otros fixtures como pares equivalentes. La evidencia retenida final y la comparación histórica del mismo HEAD de Etapa1 se enlazan desde el informe; antes de publicar conviene aprobar visualmente el conjunto local.

### Validación y límites

- Grupo focalizado de la integración observado:443/449, con seis fallos de `state-update-conflict-handlers.test.ts` preexistentes e iguales al control acreditado de Fase2/3. No se corrigen ni se ocultan. Tras el ajuste final de selector:16/16 de temas/contraste; typecheck PASS; lint afectado PASS (dos warnings nuevos de imports duplicados de pintura y uno previo de dependencia Attendance); build habitual PASS; diff-check y reconstrucción estricta. Lint global anterior conserva dos errores Buffer en el arnés OPFS y otros warnings ajenos. No suite completa.
- Contraste: paletas aprobadas y pares reales de fábricas conservados (98 pares de propuesta,56 de contenidos). El escaneo integrado anterior de56 combinaciones no encontró fallos; su JSON temporal no se conserva y no se ofrece como certificado reproducible. No acreditación de antialiasing, todos los controles del SO o todos los dispositivos.
- Chromium153/Linux real vía CDP, no Playwright; API/ACK y datos sintéticos. Ensayo final retenido: conflicto de creación, cancelar sin escribir, corrección explícita con versión base, replay con clientRequestId original y reapertura OPFS con conflicto durable;9 controles. Cambio real del selector en cuatro anchos conserva nodos de inputs y filas completas de pendientes/conflictos; auto sigue la preferencia emulada del SO con el mismo diálogo. Cierre normal de Chrome y reapertura offline conservan preferencia oscura y comando exacto; integrity_check=ok. Error de escritura de preferencia inyectado sólo sobre su clave, visible y recuperable. No aceptación Core/productiva ni prueba de cámara física.
- Intentos fallidos distinguidos: espera errónea de aria-label en Attendance, diálogo todavía en animación al enviar Escape, selector de prueba que omitía el scroll real y perfil con service worker anterior. Se corrigieron los arneses tras inspección, sin aumentar timeouts. Un cierre por SIGTERM no restauró la preferencia; con valor verificado antes de salir y cierre normal por Browser.close se restauró. No se promete durabilidad ante terminación abrupta del SO. No se borraron perfiles/base para obtener PASS; perfil final nuevo, y después el mismo perfil para reapertura.
- Un export de cierre tomó API localhost, también al repetir con variable pública explícita y caché previa. Se rechazó ese artefacto; el build con caché temporal aislada y API pública explícita produjo el artefacto final correcto. No se cambió compilador, configuración ni archivos .env; no se afirma una causa de caché demostrada más allá de esos resultados.

Compatibilidad/rollback: sólo Client; Core y contratos intactos. El shell antiguo carece de selector y sigue claro; el nuevo precache incluye bootstrap local. No cambio de namespace, migraciones ni limpieza de caché. Revertir únicamente los parches de este incremento sobre su baseline exacta; nunca revertir archivos completos con etapas previas o pendientes. La preferencia local puede quedar sin uso en una versión anterior y no altera datos. No se modificó STATE_UPDATE.md porque su runtime, identidad, autorización y sincronización no cambian. Inventarios y evidencia: `backups/visual-theme-integration/2026-11-10/`. V11 y pendientes ajenos intactos; sin commit/push/deploy.

<a id="cierre-integral-publicacion"></a>
## Cierre integral y preparación de publicación — 10-11-2026

**NO LISTO para publicar: cierre bloqueado por los resultados de la suite global aislada y brechas del paquete.** **Estado histórico de ese cierre; ver [resolución posterior](#resolucion-bloqueos-ux-20261110).** Este cierre sustituye la brecha de comparación no archivada de la integración anterior. No certifica Safari/iPhone físico, native, lectores de pantalla ni toda la operación offline. No necesita publicar Core ni cambiar configuración, esquema o datos.

**Referencia verificable:** lectura anónima del artefacto público de client.opco.cl: entry-585c83c9de854d8f3830660d003d1334.js y SW coinciden por SHA256 con la publicación acreditada de ecbf18a1061c1eab2a31e028bfedb7e20da3c557; origin/main vuelve a confirmar ese SHA. El HTML público añade un beacon de Cloudflare: al retirar únicamente ese script/salto de línea coincide exactamente con el HTML acreditado. El control local bloquea red externa y excluye ese beacon; no se compara contra una reconstrucción supuesta del bundle.

Comparación nueva retenida:44 escenas por versión (88 capturas),11 situaciones a390/768/1024/1440,22 hojas inspeccionadas. Los cinco fixtures se identifican por hash y son idénticos antes/después. Incluye Inicio, RECORDS/lista/detalle/formulario, Attendance/STATE_UPDATE y búsqueda, PANEL, REPORT TABLE y MATRIX. Cero escrituras;62 claves de respuesta compartidas tienen los mismos fingerprints y ambos lados consultan el mismo conjunto de claves. El número de repeticiones cambia con el timing de navegación/preparación: no se presenta como prueba de optimización de red. Sin overflow horizontal de página en las44 situaciones de cada versión.

La mejora es considerable en orientación móvil, título configurado, agrupación del detalle/formulario, etiquetas, distinción búsqueda/selección RELATION y lectura completa. Hay costes explícitos: RECORDS con texto largo muestra menos filas por viewport; PANEL/REPORT apilados requieren más scroll vertical; MATRIX usa más ancho para encabezados legibles y conserva desplazamiento2D. No se atribuyen diferencias de datos al diseño, se eliminan campos ni se promete menor número de acciones en todos los casos. Account/contrato/diagnóstico siguen accesibles desde el menú. No prueba de productividad con usuarios sin capacitación.

### Evidencia funcional y separación de fallos

Core publicado07184c3db6522bc25b443cf94a410c25d5d60b0e, módulos de rutas/auth/Prisma sin modificaciones, montados mediante un adaptador HTTP local contra PostgreSQL16 temporal vacío. Se aplicaron sólo las25 migraciones existentes localmente, sin credenciales/datos productivos ni uso de opco_development. No es un despliegue Next ni autenticación productiva: JWT y autorización son reales; el bootstrap de refresh de sesión del arnés es sintético.

- Las seis consultas reales responden200; los seis renderers se abren con datos reales del fixture a390/1440. Sin token401. Alcance de permisos limitado a estas comprobaciones y asignaciones del fixture, no auditoría de RBAC.
- Confirmación Attendance de observación sin cambiar estado, cancelación que conserva borrador y snapshot PostgreSQL, corrección aceptada sobre la misma fila con SELECT/RELATION intactos.
- Contextos obligatorios vacíos bloquean guardar. Seleccionados explícitamente, alta offline, tema oscuro sin alterar la fila pendiente, cierre normal de Chrome y reapertura del mismo OPFS conservan la intención exacta. Reconexión obtiene ACK real y una sola fila B/relación para el segundo sujeto.
- Un cambio remoto sintético posterior produce conflicto durable explícito al enviar la corrección offline; se conserva el requestId y una intención en conflicto, sin sobrescribir el remoto. Se conservan las pruebas previas de temas/teclado/reapertura con conflictos del mismo contenido funcional; no se repite cámara.
- Seis fallos anteriores: se reproduce1/7 en fuente publicada y candidata; el extractor de handlers omite workflowWriteMetadata aunque ambos runtimes lo importan. El diagnóstico aislado con esa dependencia real da7/7 en ambos. Se corrige únicamente ese arnés, sin cambiar aserciones ni handlers.
- **Corrección de la lectura anterior de resultados:** la primera corrida nueva tenía449 casos PASS pero además1 suite sin compilar: AppIcon ahora alcanza Platform mediante paint y ese test no simulaba react-native para web. No era un PASS completo ni uno de los seis fallos anteriores. Se añade el mock web usado por los demás tests, como segundo ajuste de arnés separado. Resultado final **453/453 en el workspace con sus fixtures locales,0 suites fallidas**, reproducible. Los informes anteriores se conservan como historia, no se reescriben.

Typecheck y lint afectado PASS; tres warnings (dos imports de pintura duplicados, dependencia Attendance anterior). Lint global previo conserva los errores Buffer de un arnés excluido; no se corrige ni declara limpio. Build público anterior se reutiliza por igualdad de los85 archivos de los lotes y de index/SW/entry/bootstrap; los únicos cambios nuevos ejecutables son dos archivos de pruebas. API https://web.opco.cl, namespace epoch2 y lector localJS/WASM conservados. Pruebas experimentales/excluidas no se ejecutan. No una suite general completa.

### Consolidación, publicación y rollback

17 inventarios/parches originales verificados; los85 archivos no documentales coinciden con sus últimas revisiones y sus primeras baselines con HEAD. Los parches incrementales comparten archivos y no deben sumarse/aplicarse dos veces (incluyen combinados y deltas). La entrega prepara un único parche sobre HEAD con documentación exclusivamente UX; las secciones antiguas pendientes de STATUS/STATE_UPDATE/DESKTOP_INTERFACE permanecen fuera. Los dos ajustes de arnés tienen delta separado. Ningún índice se modifica.

Publicación futura sólo Client: revalidar remoto/hash, preparar exclusivamente el parche consolidado, diff-check y checks acreditados; commit/push normal únicamente tras autorización. Verificar artefacto público/index/SW/precache/API/namespace antes de recorrer lectura, tema y reapertura en dispositivos participantes, sin registros productivos de prueba ni limpieza de datos. Despliegue técnico no activa experiencias ni políticas. El backup PostgreSQL no es requisito nuevo de este cambio sin DB, ni se renueva/restaura automáticamente.

Rollback fuente: inverso del parche consolidado sobre el candidato aislado restaura exactamente el árbol publicado. Core permanece compatible; preferencia visual puede quedar ignorada por el shell anterior. No restaurar PostgreSQL, cambiar namespace, borrar OPFS/outbox ni depender de que un SW nuevo retire todos los runtimes viejos. Un rollback de infraestructura requiere comprobar previamente disponibilidad de la versión anterior; aquí se acredita reversión del código, no un rollback productivo ejecutado. No mezclarlo con políticas/configuraciones nuevas.

Informe, matriz, inventario, parches y capturas: `backups/ux-ui-integral-close/2026-11-10/`. Safari/iPhone físico, native, lector de pantalla, cámara y aceptación de datos productivos no ejecutados. La autorización de publicación sigue pendiente. Las402exclusiones, Core y demás pendientes se conservan; V11 pausado.


### Gate global del candidato consolidado — NO-GO, 10-11-2026

Después de las453 focalizadas se ejecutó una sola vez npm test sobre la copia aislada que contiene únicamente el candidato:1699/1738 casos PASS,39FAIL,19suites fallidas distribuidas en12archivos; dos archivos no llegaron a recopilar casos. No se repitió la suite hastaPASS. El control acotado de los archivos fallidos sobre HEAD da167/197PASS y30FAIL:30casos también fallan allí, aunque algunos errores difieren. Los siete casos SQLite adicionales de la corrida candidata no tienen causa acreditada: el control reducido no reproduce la carga completa. No se atribuyen al UX ni se descartan.

Brechas nuevas comprobadas: dos aserciones estructurales de app-diagnostics-layout aún exigen la cabecera antigua; desktop-presentation.test simula react-native sin Platform y no inicia el nuevo import de paint; tokens.test necesita design/proposals/visual-identity-2026-11-09/tokens.proposed.json, omitido del parche consolidado. El inventario91archivos/399hunks es provisional y NO publicable mientras falte esa dependencia. No se corrigen a ciegas los asserts ni se amplía a SQLite/sincronización.

Typecheck y lint global del candidato aislado sí pasan (0errores,7warnings); los dos errores Buffer del workspace están en archivos excluidos y no se incorporan. El build anterior coincide por hashes y el código de producto no cambió en este cierre. Las lecturas reales/confirmación/ACK/conflicto se acreditaron por segmentos en el mismo entorno sintético, no como un único arnés nuevo completo sin interrupciones. Esa evidencia no convierte el gate fallido enPASS.

Recomendación final: NO-GO. Próximo lote mínimo: completar la dependencia JSON del paquete, adaptar únicamente los arneses/aserciones señalados manteniendo garantías verificables de diagnóstico/accesibilidad y caracterizar los fallos restantes mediante un control comparable. Sólo después cerrar otra vez los gates. Mantener la publicación detenida; no se autorizan aquí correcciones de reglas de negocio ni de SQLite.


<a id="resolucion-bloqueos-ux-20261110"></a>
## Resolución de bloqueos UX/UI — 10-11-2026, LOCAL

**GO técnico local para consolidar el candidato web y preparar una publicación controlada posterior.** Los39fallos y2brechas de colección/empaquetado están clasificados y cubiertos por checks nuevos. No es autorización de publicación, certificación multiplataforma ni estabilidad offline general. Safari/iPhone físico, native y lector de pantalla real conservan sus pendientes específicos.

Se reconstruyó exactamente91archivos/399hunks y se verificó el SHA256 de todo el respaldo anterior. Suite nueva sin reparar: HEAD1520/1565(45fallos); candidato1699/1738(39fallos), los mismos39casos del cierre. El reporte detallado captura el mensaje real que JSON resumía como STACK_TRACE_ERROR. Dos aserciones fijaban la cabecera vieja. Otros37casos corresponden a arneses/fixtures preexistentes o timeouts bajo paralelismo:24por bindings omitidos en extractores,4por contrato de búsqueda incompleto,1por mock inválido de metadata y8por timeout concurrente. No regresión funcional UX demostrada en estos casos.

Los siete SQLite prioritarios vencen a5000ms en suite paralela; fuentes/pruebas/runtime idénticos en ambos árboles. Cada control serialHEAD/candidato da43/47, sin timeouts; sólo4fallos de fixture API. Los controles tardan65.452/64.953s; el caso más lento4331ms. No se perfiló el recurso físico que causa contención. maxWorkers=1 queda explícito en vitest.config.mjs: mismos5000ms, sin desactivar tests, isolation ni asserts. Es configuración de pruebas, no de la app.

Reparaciones independientes: aportar funciones reales workflowWriteMetadata/captureWorkflowWriteCommand y refs/configuración del comando; aportar revisión de borrador al extractor de búsqueda; devolver null ante metadata ausente; responder con comparación efectiva canónica y sourceEntityTypeId coherente. Se mantienen las aserciones de autorización/base/receipt/scope/reapertura. Seis handlers afectados son idénticos por hash de código compilado entre HEAD y UX;157/157de estas pruebas corregidas pasan también contra HEAD. La prueba de header ejecuta el onPress real y verifica pestaña/apertura/accesibilidad; SSR real conserva contrato/experiencia, estado único y44px en cuatro anchos. Desktop incluye Platform web y prueba roles CSS con fallback aprobado, sin cambiar métricas/estados. El JSON aprobado de paleta se incorpora sin modificar sus bytes.

Intentos propios conservados: una expectativa nueva usó viewportWidth en vez de width; se corrigió sólo el verificador. Importar vitest/config desde un configTS incluido por Expo añadía tipos Node y hacía redundantes70directivas existentes; mover la configuración aMJS conserva la frontera de tipos de la app, sin tocar esas pruebas ni tsconfig/compilador. No se presenta ninguno de esos intentos fallidos como PASS.

**Checks nuevos sobre candidato aislado:** npm test1749/1749,0suites fallidas,154archivos,0errores no controlados(133.277s); typecheckPASS(7.993s); lint global0errores/7warnings(30.904s); build habitual desde dist y cacheMetro vacíosPASS(25.982s). Bundle entry-dbda298337c0c1aac21d3aac3a547468.js, API https://web.opco.cl, namespace opco-client-v10-epoch2.db; index/SW, bootstrap/temas y lectorZXing3.1.6 JS/WASM locales verificados. No se reutilizan los checks anteriores como si fueran nuevos.

**Navegador nuevo:** Chrome153/Linux/CDP, perfil aislado/OPFS real y API sintética,27capturas. Nueve controles de confirmación/cancelación, mismo registro/base, replay con clientRequestId intacto, conflicto durable y cierre completo/reapertura offline con comandos/versiones iguales. Cinco controles de tema: light/dark cuatro anchos, auto sigue sistema sin remount de modal, fallo controlado de preferencia recuperable sin tocar negocios, reapertura conserva dark y arranque aplica fondo antes de React. PRAGMA integrity_check=ok;0excepciones no esperadas. Árbol AX de la escena:5botones nombrados/0sin nombre; no equivale a lector de pantalla real. API/Core reales no se ejecutan nuevamente aquí; la aceptación de transporte de este ensayo es sintética.

Informe, clasificación individual, matriz externa, checks y parches independientes/consolidado: backups/ux-ui-blockers-resolution/2026-11-10/. El combinado aplica directamente aHEADecbf18a y su inverso reproduce todo el árbol base. Los parches incrementales aplican al candidato91/399; no sumarlos al combinado. Documentación previa mixta se sigue separando por hunks. No cambiar runtime/Core/API/SQLite/OPFS/outbox/sync; no configuración/datos productivos ni commit/push/deploy.402exclusiones y pendientes ajenos preservados; V11 sigue pausado.


<a id="consolidacion-candidato-ux-20261110"></a>
## Consolidación definitiva del candidato UX/UI — 10-11-2026, SIN COMMIT

Se toma el candidato101archivos/418hunks de ux-ui-blockers-resolution/2026-11-10, sobre Clientecbf18a1061c1eab2a31e028bfedb7e20da3c557. Se verifica su respaldo, reconstrucción íntegra y las17referencias históricas. El lote único conserva código, pruebas, configuración de runner y JSON aprobado; sólo añade esta trazabilidad documental. No volver a sumar los parches históricos: contienen archivos compartidos y bases incrementales.

Los resultados de la nueva suite1749, typecheck, lint, build desde cero y controles Chromium/OPFS/temas se registran en backups/ux-ui-consolidated-candidate/2026-11-10/. No se sustituyen por los checks anteriores. El artefacto acredita API pública, namespaceepoch2, index/SW y recursos locales del lector. El transporte del ensayo de navegador es sintético; no acredita una nueva aceptación de Core real ni Safari/iPhone/native/lector de pantalla físicos.

La preparación Git utiliza índice y objetos alternativos propios, sin staging en el índice habitual ni commit. El inventario y GIT_PLAN.md identifican los101archivos, SHA base, árbol resultante, parche exacto y procedimiento de rollback de fuente. Se verifican composición, diff-check e inverso contra todo el árbol base. STATUS/STATE_UPDATE/DESKTOP_INTERFACE siguen separando sólo los hunksUX; sus pendientes ajenos no entran.

PLAN_API_REAL.md delimita la validación posterior: entorno aislado, fixture ficticio, rutas reales, consultas/permisos/confirmaciones/pending/conflictos y cotejo de identidades. No autoriza escrituras de prueba productivas ni cambios de Core, contratos, reglas, SQLite/OPFS/outbox/sync o namespace. Cualquier defecto de motor requiere alcance separado. Publicación exige autorización posterior. Core,402exclusiones, respaldos y pendientes se conservan; V11 pausado.


## Conexión y sincronización separadas — 11-11-2026, local sin publicar

La cabecera mantiene un único botón de Diagnóstico y presenta dos ejes independientes: conexión con Core y estado de las intenciones locales. `resolveShellOperationalStatus` proyecta señales existentes; `ShellOperationalStatusIndicator` sólo dibuja texto, iconos y colores semánticos. No inicia probes, lecturas SQLite, envíos, reintentos ni temporizadores. Se elimina el pulso repetitivo del indicador anterior.

- Online requiere una respuesta HTTP de Core registrada en la época actual de conectividad; NetInfo/navigator online por sí solo no basta. Sin evidencia se muestra «Conexión sin comprobar». «Conectando» sólo aparece durante una comprobación real sin conexión confirmada; una comprobación en segundo plano no reemplaza Online. Offline conocido gana inmediatamente; una respuesta anterior a la reconexión no lo revierte. Los errores HTTP de validación/autorización/conflicto no se confunden con falta de conectividad. La última solicitud iniciada prevalece ante respuestas intercaladas.
- Sincronización utiliza los flags y contadores actuales: Sincronizando, N pendientes, Error de sincronización o conflictos. «Sin pendientes» no certifica frescura, preparación completa ni ACK. Si la lectura local no está acreditada, muestra «Pendientes sin comprobar». «Sincronizado» se reserva a feedback de escritura confirmado por Core en la experiencia/scope visible y sin pendientes/problemas, con conexión confirmada; no se deduce de un toast histórico, una preparación terminada o una cola vacía.
- Lecturas visibles, guardado local, problemas locales y preparación offline mantienen un aviso separado; el progreso conserva su valor y recibe atributos ARIA web. Diagnóstico conserva el detalle técnico y el resolver agregado anterior; ese agregado incluye lecturas/preparación y no equivale al nuevo eje de envío.

Se reutilizan tokens claro/oscuro, foco global y objetivo táctil mínimo de 44 px. La fila puede envolver y conserva la misma acción y árbol a todos los anchos. No cambia Core/API, conectividad, SQLite/OPFS, outbox, namespace, motores de sincronización, identidad, comandos ni confirmaciones. La disponibilidad remota representa la última evidencia observada: sin nuevas señales no demuestra disponibilidad continua; no se añade polling/TTL. La telemetría de transporte existente cubre health/ready, auth y workflows; una pantalla sin comprobaciones registradas puede quedar «sin comprobar» aunque el navegador tenga red.

Validación y evidencia reproducibles: backups/connectivity-sync-presentation/2026-11-11/. Las comprobaciones de navegador usan datos/transporte sintéticos y Chromium/OPFS local; no son validación productiva ni física Safari/iPhone/native/lector de pantalla. Las 402 exclusiones, índices habituales y pendientes ajenos se conservan. Parche independiente sobre e9a660190cbddd57d3a96badd928d8a5abe2595c, sin commit/push/deploy.
