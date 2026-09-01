import { OfflineAvailability } from "./app-view-definitions-cache";

export function getOfflineAvailabilityText(availability: OfflineAvailability) {
  switch (availability) {
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
