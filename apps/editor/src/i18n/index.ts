// Localisable UI strings (SPEC §13): ICU MessageFormat via FormatJS's intl-messageformat.
//
//   import { t } from "../i18n";
//   t("home.files.count", { count: 3 })          // "{count, plural, one {# file} other {# files}}"
//
// Messages live in ./messages/<locale>.ts as flat id → ICU string maps. English is the source of truth
// and the fallback; a missing id in another locale falls back to English, a missing English id
// returns the id itself so it is easy to spot. Home and Settings use this today; the rest of the
// chrome still has inline English strings and moves over screen by screen.
import { IntlMessageFormat, type PrimitiveType } from "intl-messageformat";
import { en, type MessageId } from "./messages/en";

export type { MessageId };
export type MessageValues = Record<string, PrimitiveType>;
export type Messages = Partial<Record<MessageId, string>>;

const catalogs: Record<string, Messages> = { en };
let locale = "en";
const cache = new Map<string, IntlMessageFormat>();

function detect(): string {
  if (typeof navigator === "undefined") return "en";
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = l.toLowerCase().split("-")[0]!;
    if (catalogs[l]) return l;
    if (catalogs[base]) return base;
  }
  return "en";
}

/** Register messages for a locale (partial catalogs fall back to English). */
export function addMessages(id: string, messages: Messages): void {
  catalogs[id] = { ...catalogs[id], ...messages };
  cache.clear();
}

export function setLocale(id: string): void {
  locale = catalogs[id] ? id : "en";
  cache.clear();
}

export function getLocale(): string {
  return locale;
}

/** Format a message by id. Values fill ICU arguments: {name}, plural, select, number, date. */
export function t(id: MessageId, values?: MessageValues): string {
  const key = `${locale}\u0000${id}`;
  let fmt = cache.get(key);
  if (!fmt) {
    const source = catalogs[locale]?.[id] ?? en[id];
    if (source === undefined) return id;
    try {
      fmt = new IntlMessageFormat(source, catalogs[locale]?.[id] !== undefined ? locale : "en");
    } catch {
      return source;
    }
    cache.set(key, fmt);
  }
  try {
    return String(fmt.format(values));
  } catch {
    return en[id] ?? id;
  }
}

if (typeof navigator !== "undefined") locale = detect();
