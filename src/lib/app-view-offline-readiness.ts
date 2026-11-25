import { OfflineAvailability } from "./app-view-definitions-cache";

export function getOfflineAvailabilityText(availability: OfflineAvailability) {
  switch (availability) {
    case "query-scoped":
      return "Disponibilidad offline según la consulta";
    case "dependencies-empty":
      return "Catálogo obligatorio vacío en la copia preparada";
    case "dependencies-missing":
      return "Catálogo obligatorio no preparado";
    case "dependencies-partial":
      return "Catálogos locales parciales";
    case "dependencies-unavailable":
      return "No se pudo comprobar el catálogo local";
    case "ready":
      return "Disponible sin conexion";
    case "data-partial":
      return "Datos offline parciales";
    case "data-not-cached":
      return "Datos aun no disponibles sin conexion";
    case "online-only":
      return "Requiere conexion";
    case "unsupported":
      return "No soportada";
    case "definition-missing":
    default:
      return "Requiere conexion para preparar datos";
  }
}
