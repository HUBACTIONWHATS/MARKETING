/**
 * Cálculo de tempo dentro do expediente, considerando fuso horário da
 * empresa, sem dependência externa (usa Intl.DateTimeFormat, nativo do Node).
 *
 * Limitação conhecida: assume janelas de expediente dentro do mesmo dia
 * (não cobre expediente que atravessa a meia-noite) e não trata com precisão
 * o instante exato de transições de horário de verão. Para o fuso padrão da
 * empresa (America/Sao_Paulo) isso não é um problema: o Brasil não usa mais
 * horário de verão desde 2019.
 */

export type WeekdayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export interface DayWindow {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export type BusinessHours = Record<WeekdayKey, DayWindow | null>;

const WEEKDAY_KEYS: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function defaultBusinessHours(): BusinessHours {
  const window: DayWindow = { start: "09:00", end: "18:00" };
  return { mon: window, tue: window, wed: window, thu: window, fri: window, sat: null, sun: null };
}

export function parseBusinessHours(json: string): BusinessHours {
  try {
    const parsed = JSON.parse(json);
    const result = defaultBusinessHours();
    for (const key of WEEKDAY_KEYS) {
      if (key in parsed) result[key] = parsed[key] ?? null;
    }
    return result;
  } catch {
    return defaultBusinessHours();
  }
}

function getZonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Converte um horário de parede (ano/mês/dia/hora/min, no fuso dado) para um instante UTC. */
function zonedTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const reading = getZonedParts(new Date(utcGuess), timeZone);
  const readingAsUtc = Date.UTC(reading.year, reading.month - 1, reading.day, reading.hour, reading.minute, reading.second);
  const offset = readingAsUtc - utcGuess;
  return new Date(utcGuess - offset);
}

/** Minutos de sobreposição entre [start, end] (instantes UTC) e o expediente da empresa. */
export function businessMinutesBetween(start: Date, end: Date, timeZone: string, hours: BusinessHours): number {
  if (end.getTime() <= start.getTime()) return 0;

  let totalMs = 0;
  const startLocal = getZonedParts(start, timeZone);
  const endLocal = getZonedParts(end, timeZone);

  let cursor = Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day);
  const lastDay = Date.UTC(endLocal.year, endLocal.month - 1, endLocal.day);

  while (cursor <= lastDay) {
    const y = new Date(cursor).getUTCFullYear();
    const mo = new Date(cursor).getUTCMonth() + 1;
    const d = new Date(cursor).getUTCDate();
    const weekdayIdx = new Date(cursor).getUTCDay(); // 0=dom..6=sáb (cursor é só um marcador de calendário)
    const window = hours[WEEKDAY_KEYS[weekdayIdx]];

    if (window) {
      const [sh, sm] = window.start.split(":").map(Number);
      const [eh, em] = window.end.split(":").map(Number);
      const windowStart = zonedTimeToUtc(y, mo, d, sh, sm, timeZone);
      const windowEnd = zonedTimeToUtc(y, mo, d, eh, em, timeZone);
      const overlapStart = start > windowStart ? start : windowStart;
      const overlapEnd = end < windowEnd ? end : windowEnd;
      if (overlapEnd > overlapStart) totalMs += overlapEnd.getTime() - overlapStart.getTime();
    }

    cursor += 24 * 60 * 60 * 1000;
  }

  return Math.round(totalMs / 60000);
}
