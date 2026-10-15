export function validSignature(strokes) {
  if (!Array.isArray(strokes) || !strokes.length || strokes.length > 100) return false;
  let points = 0, distance = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2) return false;
    points += stroke.length;
    if (points > 5000) return false;
    for (let i = 0; i < stroke.length; i++) {
      const point = stroke[i];
      if (!Array.isArray(point) || point.length !== 2 || point.some(n => !Number.isFinite(n) || n < 0 || n > 1)) return false;
      if (i) distance += Math.hypot(point[0] - stroke[i-1][0], point[1] - stroke[i-1][1]);
    }
  }
  return points >= 8 && distance >= 0.1;
}
export function drawSignature(canvas, strokes, pixelRatio = 1) {
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#172a36'; context.lineWidth = 3 * pixelRatio; context.lineCap = 'round'; context.lineJoin = 'round';
  for (const stroke of strokes) {
    context.beginPath();
    stroke.forEach(([x,y], i) => context[i ? 'lineTo' : 'moveTo'](x * canvas.width, y * canvas.height));
    context.stroke();
  }
}
