# Análisis sólo online — ajuste local identificado por separado

Decisión explícita: REPORT TABLE/MATRIX son análisis. CURRENT_STATUS y
LATEST_BY_RELATION conservan su comportamiento. PANEL se clasifica desde el editor
Core mediante `config.purpose: OPERATIONAL | ANALYSIS`; ausencia conserva comportamiento
hasta revisión. No se deduce función por nombre, contrato, rol, KPI ni contenido.
No se modifica automáticamente ninguna configuración existente.

## Preparación y disponibilidad

El evaluador compartido devuelve `online-only` para análisis, incluso si conserva una
copia/definición anteriormente preparada. El coordinador existente mantiene la lista
completa de asignaciones, pero excluye análisis del conjunto de trabajo, progreso y
pruebas reutilizables de disponibilidad offline. No se borra metadata, snapshots,
registros ni outbox. Los catálogos compartidos requeridos por RECORDS/Attendance/
STATE_UPDATE permanecen en su preparación normal.

La base ya omitía datasets PANEL/REPORT en prewarm; sí contaba esas experiencias y
persistía marcadores `unsupported`. El ahorro de trabajo/solicitudes debe medirse: no
se atribuye una reducción de descargas de datasets que ya eran cero.

## Lectura y reconexión

Sin conexión no se abre ni sustituye un resultado por su snapshot. Se comunica una
sola vez mediante el sector de actividad existente: «Análisis disponible sólo con
conexión a internet». Se conservan filtros y selección. La acción Actualizar de PANEL sigue disponible online
cuando no hay resultados, usando el mismo retryVersion existente; no se retira con la
cuadrícula ni se crea otro reintento. Cada actualización solicita Core o su validación online. Una caída de Core con navegador
online comunica que no se pudo actualizar, sin fallback silencioso al resultado previo.

La caché online sigue sirviendo únicamente después de una respuesta válida de Core
que confirme autorización, scope, revisión/configuración/consulta y epoch mediante
la negociación existente. No basta navigator.onLine, una copia local ni TTL.
Si no hay negociación compatible, el dataset requiere su respuesta normal válida.
Conectividad/revisión/generación de lectura retiran el resultado visible hasta verificar
otra vez. Se rechazan respuestas tardías y errores de otra sesión/consulta. No se añade
polling: una caída del servicio no observada no puede detectarse mágicamente entre lecturas.

Los PANEL operativos y no clasificados mantienen sus lecturas offline exactas y avisos
de cobertura; no se alteran captura, edición, obligatoriedad de contextos ni sincronización.

## Compatibilidad y transición

Orden futuro: Core que conserva la propiedad → Client que interpreta la clasificación →
revisión/elección explícita de PANEL. Este encargo no publica ni configura producción.
Antes de completar la clasificación no se afirma que todos los análisis han sido excluidos.
El inventario archivado no equivale a inventario productivo actual ni completo.

No hay migración local, cambio de formato 10/namespace ni eliminación de datos.
Rollback Client reintroduce apertura/fallback offline de análisis; conserva snapshots y
pendientes. Core compatible debe mantenerse si hay PANEL clasificados: un Core anterior
estricto puede rechazar la nueva propiedad. Volver al Core anterior exige retirar esa
metadata mediante configuración revisada/restaurada, nunca borrar registros.
Consumidores antiguos ya abiertos pueden seguir aplicando la política previa hasta su
actualización normal: no se promete imposición servidor ni se fuerzan recargas.

Este ajuste es separado del candidato de estabilidad/franja Attendance, de la causa aún
no correlacionada del run productivo fallido y de la investigación de repetición periódica.
Safari/native, dispositivos físicos y ejecución durante suspensión requieren evidencia propia.
