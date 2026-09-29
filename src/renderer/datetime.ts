import type { Settings } from "../shared/contracts";

type DatePreferences = Pick<Settings, "timezone" | "datetimeFormat">;

function timeZone(value: string | undefined) {
  return value && value !== "local" ? value : undefined;
}

function parts(date: Date, zone: string | undefined) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function offset(date: Date, zone: string | undefined) {
  const name = new Intl.DateTimeFormat("en", {
    timeZone: zone,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  return name === "GMT" ? "Z" : name?.replace("GMT", "") || "";
}

export function formatBsonDate(
  value: Date,
  settings: Partial<DatePreferences> = {},
): string {
  if (Number.isNaN(value.valueOf())) return String(value);
  const zone = timeZone(settings.timezone);
  const format = settings.datetimeFormat || "iso";
  if (format === "locale")
    return new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(value);
  if (format === "iso" && settings.timezone === "UTC") return value.toISOString();
  const valueParts = parts(value, zone);
  const basic = `${valueParts.year}-${valueParts.month}-${valueParts.day}`;
  const clock = `${valueParts.hour}:${valueParts.minute}:${valueParts.second}`;
  return format === "space" ? `${basic} ${clock}` : `${basic}T${clock}${offset(value, zone)}`;
}
