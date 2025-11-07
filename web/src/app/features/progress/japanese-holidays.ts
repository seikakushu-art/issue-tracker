const HOLIDAY_CACHE = new Map<number, Set<string>>();

function formatKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function diffInDays(later: Date, earlier: Date): number {
  const start = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
  const end = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((start - end) / msPerDay);
}

function parseKey(key: string): Date {
  const [year, month, day] = key.split('-').map((value) => Number.parseInt(value, 10));
  return new Date(Date.UTC(year, month - 1, day));
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, occurrence: number): number {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekdayOffset = (weekday - firstDay.getUTCDay() + 7) % 7;
  return 1 + firstWeekdayOffset + 7 * (occurrence - 1);
}

function calcVernalEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

function calcAutumnEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

function addHoliday(holidays: Map<string, string>, year: number, month: number, day: number, name: string): void {
  const date = new Date(Date.UTC(year, month - 1, day));
  holidays.set(formatKey(date), name);
}

function addSubstituteHolidays(holidays: Map<string, string>): void {
  const keys = Array.from(holidays.keys()).sort();
  for (const key of keys) {
    const date = parseKey(key);
    if (date.getUTCDay() !== 0) {
      continue;
    }
    let substitute = addDays(date, 1);
    while (holidays.has(formatKey(substitute))) {
      substitute = addDays(substitute, 1);
    }
    holidays.set(formatKey(substitute), '振替休日');
  }
}

function addCitizensHoliday(holidays: Map<string, string>): void {
  const keys = Array.from(holidays.keys()).sort();
  for (let index = 0; index < keys.length - 1; index += 1) {
    const current = parseKey(keys[index]!);
    const next = parseKey(keys[index + 1]!);
    if (diffInDays(next, current) !== 2) {
      continue;
    }
    const middle = addDays(current, 1);
    if (middle.getUTCDay() === 0 || middle.getUTCDay() === 6) {
      continue;
    }
    const key = formatKey(middle);
    if (!holidays.has(key)) {
      holidays.set(key, '国民の休日');
    }
  }
}

function buildHolidaySet(year: number): Set<string> {
  const holidays = new Map<string, string>();

  addHoliday(holidays, year, 1, 1, '元日');
  addHoliday(holidays, year, 2, 11, '建国記念の日');
  addHoliday(holidays, year, 2, 23, '天皇誕生日');
  addHoliday(holidays, year, 4, 29, '昭和の日');
  addHoliday(holidays, year, 5, 3, '憲法記念日');
  addHoliday(holidays, year, 5, 4, 'みどりの日');
  addHoliday(holidays, year, 5, 5, 'こどもの日');
  addHoliday(holidays, year, 11, 3, '文化の日');
  addHoliday(holidays, year, 11, 23, '勤労感謝の日');

  if (year === 2020) {
    addHoliday(holidays, year, 8, 10, '山の日');
  } else if (year === 2021) {
    addHoliday(holidays, year, 8, 8, '山の日');
  } else {
    addHoliday(holidays, year, 8, 11, '山の日');
  }

  addHoliday(holidays, year, 1, nthWeekdayOfMonth(year, 1, 1, 2), '成人の日');
  addHoliday(holidays, year, 9, nthWeekdayOfMonth(year, 9, 1, 3), '敬老の日');

  if (year === 2020) {
    addHoliday(holidays, year, 7, 23, '海の日');
    addHoliday(holidays, year, 7, 24, 'スポーツの日');
  } else if (year === 2021) {
    addHoliday(holidays, year, 7, 22, '海の日');
    addHoliday(holidays, year, 7, 23, 'スポーツの日');
  } else {
    addHoliday(holidays, year, 7, nthWeekdayOfMonth(year, 7, 1, 3), '海の日');
    addHoliday(holidays, year, 10, nthWeekdayOfMonth(year, 10, 1, 2), 'スポーツの日');
  }

  addHoliday(holidays, year, 3, calcVernalEquinoxDay(year), '春分の日');
  addHoliday(holidays, year, 9, calcAutumnEquinoxDay(year), '秋分の日');

  addSubstituteHolidays(holidays);
  addCitizensHoliday(holidays);

  return new Set(holidays.keys());
}

export function isJapaneseHoliday(date: Date): boolean {
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const year = utcDate.getUTCFullYear();
  if (!HOLIDAY_CACHE.has(year)) {
    HOLIDAY_CACHE.set(year, buildHolidaySet(year));
  }
  const key = formatKey(utcDate);
  return HOLIDAY_CACHE.get(year)!.has(key);
}