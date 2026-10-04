export function csvLine(values) {
  return values.map(value => {
    const raw = String(value ?? '');
    const safe = /^\s*[=+\-@]/.test(raw) || /^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',') + '\r\n';
}
export function textStream(iterator) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close(); else controller.enqueue(encoder.encode(value));
      } catch (error) { controller.error(error); }
    },
    async cancel() { await iterator.return(); }
  });
}
