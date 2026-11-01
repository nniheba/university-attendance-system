const MADRID_TIME_ZONE = "Europe/Madrid";

interface MadridDateTimeParts {
  date: string;
  time: string;
}

const madridPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MADRID_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsFor(date: Date): Record<string, string> {
  return Object.fromEntries(
    madridPartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function madridDateTimeInput(value: string): MadridDateTimeParts | null {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = partsFor(instant);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function madridLocalDateTimeToIso(date: string, time: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/u.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const desiredWallClock = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const calendarCheck = new Date(desiredWallClock);
  if (
    calendarCheck.getUTCFullYear() !== year
    || calendarCheck.getUTCMonth() !== month - 1
    || calendarCheck.getUTCDate() !== day
  ) return null;

  let candidate = desiredWallClock;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidateParts = partsFor(new Date(candidate));
    const displayedWallClock = Date.UTC(
      Number(candidateParts.year),
      Number(candidateParts.month) - 1,
      Number(candidateParts.day),
      Number(candidateParts.hour),
      Number(candidateParts.minute),
      Number(candidateParts.second),
    );
    const difference = desiredWallClock - displayedWallClock;
    if (difference === 0) break;
    candidate += difference;
  }

  const result = new Date(candidate);
  if (!Number.isFinite(result.getTime())) return null;
  const verified = madridDateTimeInput(result.toISOString());
  if (!verified || verified.date !== date || verified.time !== time) return null;
  return result.toISOString();
}
