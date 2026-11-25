import type { Appointment } from './types';
import { formatDate } from '../../shared/time.ts';
import { appointmentLocation, timeLabel } from './presentation';

const fontFamily = 'system-ui, "Microsoft YaHei", sans-serif';
const locationFont = `500 31px ${fontFamily}`;

function wrapLocation(context: CanvasRenderingContext2D, text: string, width: number) {
  const lines = [];
  let line = '';
  for (const character of text) {
    if (line && context.measureText(line + character).width > width) {
      lines.push(line.trimEnd());
      line = '';
    }
    if (line || character !== ' ') line += character;
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}

export function appointmentTicketImage(appointment: Appointment, qrImage: HTMLImageElement | null) {
  const canvas = document.createElement('canvas');
  const width = 640;
  const paperInset = 24;
  const inset = 72;
  const contentWidth = width - inset * 2;
  const qrSize = 328;
  const locationLineHeight = 44;
  const context = canvas.getContext('2d');
  if (!context || !qrImage?.naturalWidth) throw new Error('预约单生成失败');

  context.font = locationFont;
  const locationLines = wrapLocation(
    context,
    `${appointment.campus}校区 · ${appointmentLocation(appointment)}`,
    contentWidth
  );
  const locationY = 194;
  const dividerY = locationY + locationLines.length * locationLineHeight + 28;
  const qrY = dividerY + 24;
  const footerY = qrY + qrSize + 12;
  const paperBottom = footerY + 82;
  canvas.width = width;
  canvas.height = paperBottom + paperInset;

  const background = '#efefed';
  context.fillStyle = background;
  context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = '#fff';
  context.beginPath();
  context.roundRect(paperInset, paperInset, width - paperInset * 2, paperBottom - paperInset, 24);
  context.fill();

  context.textBaseline = 'top';
  context.fillStyle = '#575757';
  context.font = `500 24px ${fontFamily}`;
  context.fillText('到场时间', inset, 66);
  context.textAlign = 'right';
  context.fillText(formatDate(appointment.date), width - inset, 66);
  context.textAlign = 'left';
  context.fillStyle = '#202020';
  context.font = `700 76px ${fontFamily}`;
  context.fillText(timeLabel(appointment) || '', inset - 3, 98, contentWidth);
  context.font = locationFont;
  locationLines.forEach((line, index) =>
    context.fillText(line, inset, locationY + index * locationLineHeight)
  );

  context.fillStyle = background;
  context.beginPath();
  context.arc(paperInset, dividerY, 12, 0, Math.PI * 2);
  context.moveTo(width - paperInset + 12, dividerY);
  context.arc(width - paperInset, dividerY, 12, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#c8c8c8';
  context.setLineDash([6, 7]);
  context.beginPath();
  context.moveTo(paperInset + 24, dividerY + 0.5);
  context.lineTo(width - paperInset - 24, dividerY + 0.5);
  context.stroke();

  context.imageSmoothingEnabled = false;
  context.drawImage(qrImage, (width - qrSize) / 2, qrY, qrSize, qrSize);
  context.fillStyle = '#dedede';
  context.fillRect(inset, footerY, contentWidth, 1);
  context.fillStyle = '#575757';
  context.font = `500 24px ${fontFamily}`;
  context.fillText('预约编号', inset, footerY + 27);
  context.fillStyle = '#202020';
  context.font = '600 28px ui-monospace, Consolas, monospace';
  context.textAlign = 'right';
  context.fillText(appointment.id, width - inset, footerY + 25, contentWidth - 120);
  return canvas.toDataURL('image/png');
}
