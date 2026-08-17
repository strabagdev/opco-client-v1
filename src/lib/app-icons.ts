import {
  Boxes,
  Building,
  Calendar,
  ChartNoAxesColumn,
  Circle,
  CircleDollarSign,
  Clipboard,
  ClipboardCheck,
  Clock,
  Construction,
  Database,
  Factory,
  FileQuestion,
  FileText,
  Folder,
  HardHat,
  LayoutDashboard,
  Map as MapIcon,
  MapPin,
  Package,
  Pickaxe,
  Ruler,
  Settings,
  Shield,
  Tag,
  TriangleAlert,
  Truck,
  UserRound,
  Users,
  Warehouse,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react-native";

export const appIconOptions = [
  { key: "warehouse", label: "Bodega", icon: Warehouse },
  { key: "package", label: "Paquete", icon: Package },
  { key: "boxes", label: "Cajas", icon: Boxes },
  { key: "truck", label: "Transporte", icon: Truck },
  { key: "hard-hat", label: "Casco", icon: HardHat },
  { key: "construction", label: "Construccion", icon: Construction },
  { key: "wrench", label: "Herramienta", icon: Wrench },
  { key: "users", label: "Personas", icon: Users },
  { key: "user-round", label: "Persona", icon: UserRound },
  { key: "clipboard", label: "Portapapeles", icon: Clipboard },
  { key: "clipboard-check", label: "Checklist", icon: ClipboardCheck },
  { key: "file-text", label: "Documento", icon: FileText },
  { key: "folder", label: "Carpeta", icon: Folder },
  { key: "map", label: "Mapa", icon: MapIcon },
  { key: "map-pin", label: "Ubicacion", icon: MapPin },
  { key: "ruler", label: "Regla", icon: Ruler },
  { key: "pickaxe", label: "Faena", icon: Pickaxe },
  { key: "factory", label: "Planta", icon: Factory },
  { key: "building", label: "Edificio", icon: Building },
  { key: "calendar", label: "Calendario", icon: Calendar },
  { key: "clock", label: "Hora", icon: Clock },
  { key: "shield", label: "Seguridad", icon: Shield },
  { key: "triangle-alert", label: "Alerta", icon: TriangleAlert },
  { key: "circle-dollar-sign", label: "Costo", icon: CircleDollarSign },
  { key: "chart-no-axes-column", label: "Indicador", icon: ChartNoAxesColumn },
  { key: "database", label: "Datos", icon: Database },
  { key: "tag", label: "Etiqueta", icon: Tag },
  { key: "settings", label: "Configuracion", icon: Settings },
  { key: "workflow", label: "Flujo", icon: Workflow },
  { key: "board", label: "Tablero", icon: Clipboard },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
] as const satisfies { key: string; label: string; icon: LucideIcon }[];

export type AppIconKey = (typeof appIconOptions)[number]["key"];

const appIconsByKey = new Map<string, (typeof appIconOptions)[number]>(
  appIconOptions.map((option) => [option.key, option]),
);

export const FALLBACK_APP_ICON = FileQuestion;
export const EMPTY_APP_ICON = Circle;

export function isAppIconKey(value: string): value is AppIconKey {
  return appIconsByKey.has(value);
}

export function normalizeAppIcon(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized && isAppIconKey(normalized) ? normalized : null;
}

export function getAppIconOption(key: string | null | undefined) {
  if (!key) {
    return null;
  }

  return appIconsByKey.get(key) ?? null;
}

export function getAppIconComponent(key: string | null | undefined) {
  return getAppIconOption(key)?.icon ?? null;
}

export function resolvePreferredAppIcon(primaryIcon: string | null | undefined, secondaryIcon?: string | null) {
  return normalizeAppIcon(primaryIcon) ?? normalizeAppIcon(secondaryIcon) ?? null;
}
