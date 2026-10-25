// Number of permitted fractional places, bounded by Core's DECIMAL(20,6).
export function decimalPlaces(config?: { validation?: { decimalPlaces?: number } }) {
  const n = config?.validation?.decimalPlaces;
  return Number.isInteger(n) && n! >= 0 && n! <= 6 ? n : undefined;
}

export function decimalFractionLength(raw: string) {
  const match = /^[-+]?(\d+)(?:\.(\d*))?(?:e([-+]?\d+))?$/i.exec(raw.trim());
  if (!match) return null;
  const fractional = match[2] ?? "";
  const zeros = /0*$/.exec(match[1] + fractional)![0].length;
  return Math.max(0, fractional.length - Number(match[3] ?? 0) - zeros);
}

// Existing higher precision values remain visible verbatim, never rounded.
export function formatConfiguredDecimal(value: unknown, config?: { validation?: { decimalPlaces?: number } }) {
  const raw = String(value ?? "");
  const places = decimalPlaces(config), fraction = decimalFractionLength(raw);
  if (places === undefined || fraction === null || fraction > places || !Number.isFinite(Number(raw))) return raw;
  const plain = /^([-+]?\d+)(?:\.(\d*))?$/.exec(raw);
  if (!plain) return raw;
  return plain[1] + (places ? "." + (plain[2] ?? "").slice(0, places).padEnd(places, "0") : "");
}
