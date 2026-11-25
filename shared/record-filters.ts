export function recordServiceDate(overview: { nextServiceDate?: string | null; items?: readonly { date: string; capacity: number; paused?: boolean }[] } | null | undefined, today: string) {
  const next = overview?.nextServiceDate;
  if (next != null && next >= today) return next;
  const dates = [...new Set((overview?.items || [])
    .filter((item) => item.capacity > 0 && !item.paused && item.date >= today)
    .map((item) => item.date))].sort();
  return dates[0] || null;
}
