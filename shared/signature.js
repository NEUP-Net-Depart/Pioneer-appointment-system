export const SIGNATURE_LIMITS = Object.freeze({ strokes: 100, points: 5000, dimension: 16384 });
export const SIGNATURE_PEN_WIDTH = 3;

// The single wire/storage format records CSS coordinates, independently of DPR.
export function signatureDocument(value) {
  if (
    !value ||
    Array.isArray(value) ||
    value.version !== 2 ||
    Object.keys(value).some((key) => !['version', 'width', 'height', 'strokes'].includes(key))
  )
    return null;
  const { width, height, strokes } = value;
  if (![width, height].every((n) => Number.isFinite(n) && n > 0 && n <= SIGNATURE_LIMITS.dimension))
    return null;
  if (!Array.isArray(strokes) || strokes.length > SIGNATURE_LIMITS.strokes) return null;
  let points = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || !stroke.length) return null;
    points += stroke.length;
    if (points > SIGNATURE_LIMITS.points) return null;
    for (const point of stroke) {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        !point.every(Number.isFinite) ||
        point[0] < 0 ||
        point[0] > width ||
        point[1] < 0 ||
        point[1] > height
      )
        return null;
    }
  }
  return { version: 2, width, height, strokes };
}

export function signatureBounds(document) {
  let left = document.width,
    top = document.height,
    right = 0,
    bottom = 0;
  for (const stroke of document.strokes)
    for (const [x, y] of stroke) {
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  return { left, top, width: right - left, height: bottom - top };
}

export function validSignature(value) {
  const document = signatureDocument(value);
  if (!document || !document.strokes.length) return false;
  let distance = 0;
  for (const stroke of document.strokes) {
    for (let i = 1; i < stroke.length; i++) {
      distance += Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]);
    }
  }
  const bounds = signatureBounds(document),
    unit = Math.min(document.width, document.height);
  // Ignore isolated taps when judging handwriting; event frequency is not proof
  // of a signature. Reject blank canvases and tiny stationary jitter instead.
  return distance >= unit * 0.1 && Math.max(bounds.width, bounds.height) >= unit * 0.05;
}
