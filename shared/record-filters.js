export function recordServiceDate(overview, today) {
  if (overview?.nextServiceDate >= today) return overview.nextServiceDate;
  const dates = [...new Set((overview?.items || [])
    .filter((item) => item.capacity > 0 && !item.paused && item.date >= today)
    .map((item) => item.date))].sort();
  return dates[0] || null;
}
