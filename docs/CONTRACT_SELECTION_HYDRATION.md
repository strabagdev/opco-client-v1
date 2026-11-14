# Primera selección de contrato — corrección local,12-11-2026

Carrera preexistente reproducida en HEAD2e836c9 y en candidato100d08f:el efecto dependiente
del owner releía una preferencia nula mientras el usuario elegía;su setState tardío retiraba
la selección aunque la escritura SQLite finalmente persistía el contrato. No fallo de guardado.

Se elimina únicamente esa hidratación duplicada. Login/loadContext/restauración offline ya
leen la preferencia del owner y aplican su selección;reconnect conserva sus guards/permisos.
La invalidación de sesión limpia explícitamente la selección. No se cambia la regla de selección
automática para0/1/varios contratos,ni navegación,payloads o sincronización.

Regresión automatizada de navegador archivada:selección primera,inmediata,preferencia persistida,
reapertura offline y scopes distintos. No hay instrumentación de diagnóstico en código funcional.
Esta corrección no pretende resolver toda posible carrera de autenticación fuera del camino probado.
Sin producción,commit,push o deploy. Lote independiente del ciclo de vida de recibos.
