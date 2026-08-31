import { ReportAppViewConfig, ReportTimeFilterConfig } from "@/lib/opco-api";

export const defaultReportTimeFilter = {
  allowChange: true,
  defaultPeriod: "CURRENT_MONTH",
  mode: "RANGE",
} as const satisfies ReportTimeFilterConfig;

export type ReportPeriodState =
  | {
      mode: "RANGE";
      from: string;
      to: string;
    }
  | {
      mode: "MONTH";
      month: string;
    };

export function normalizeReportTimeFilter(config: Pick<ReportAppViewConfig, "timeFilter">): ReportTimeFilterConfig {
  return {
    allowChange: config.timeFilter?.allowChange ?? defaultReportTimeFilter.allowChange,
    defaultPeriod: config.timeFilter?.defaultPeriod ?? defaultReportTimeFilter.defaultPeriod,
    mode: config.timeFilter?.mode ?? defaultReportTimeFilter.mode,
  };
}

export function initialReportPeriod(config: Pick<ReportAppViewConfig, "timeFilter">, now = new Date()): ReportPeriodState {
  const timeFilter = normalizeReportTimeFilter(config);
  const currentMonth = formatMonthInput(now);
  const monthRange = monthToRange(currentMonth);

  if (timeFilter.mode === "MONTH") {
    return {
      mode: "MONTH",
      month: currentMonth,
    };
  }

  return {
    mode: "RANGE",
    from: monthRange.from,
    to: monthRange.to,
  };
}

export function reportPeriodToRange(period: ReportPeriodState) {
  if (period.mode === "MONTH") {
    return monthToRange(period.month);
  }

  return {
    from: period.from,
    to: period.to,
  };
}

export function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(year, monthNumber - 1 + amount, 1);
  return formatMonthInput(next);
}

export function monthToRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1);
  const lastDay = new Date(year, monthNumber, 0);

  return {
    from: formatLocalDateInput(firstDay),
    to: formatLocalDateInput(lastDay),
  };
}

export function monthDays(month: string) {
  const range = monthToRange(month);
  const days: { key: string; label: string }[] = [];
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = Number(range.to.slice(-2));

  for (let day = 1; day <= lastDay; day += 1) {
    const key = formatLocalDateInput(new Date(year, monthNumber - 1, day));
    days.push({ key, label: String(day).padStart(2, "0") });
  }

  return days;
}

export function formatMonthLabel(month: string, locale = "es-CL") {
  const [year, monthNumber] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" })
    .format(new Date(year, monthNumber - 1, 1));

  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
}

export function formatLocalDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatMonthInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}
