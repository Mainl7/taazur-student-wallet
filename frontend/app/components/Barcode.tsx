'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

type DownloadFormat = 'png' | 'jpeg' | 'pdf';

type BarcodeProps = {
  value: string;
  studentName: string;
  studentCode: string;
  schoolName: string;
  fileName?: string;
  downloadable?: boolean;
};

const cardWidth = 856;
const cardHeight = 540;
const pdfWidthPt = 85.6 * 2.8346456693;
const pdfHeightPt = 54 * 2.8346456693;

function safeFileName(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 90) || 'student-card';
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function loadImage(src: string) {
  const image = new Image();
  image.decoding = 'async';
  return new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('IMAGE_RENDER_FAILED'));
    image.src = src;
  });
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

async function buildCardCanvas(input: BarcodeProps) {
  const scale = 4;
  const canvas = document.createElement('canvas');
  canvas.width = cardWidth * scale;
  canvas.height = cardHeight * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('CANVAS_NOT_SUPPORTED');
  context.scale(scale, scale);

  const background = context.createLinearGradient(0, 0, cardWidth, cardHeight);
  background.addColorStop(0, '#063927');
  background.addColorStop(0.52, '#0b5a42');
  background.addColorStop(1, '#094630');
  roundedRect(context, 0, 0, cardWidth, cardHeight, 42);
  context.fillStyle = background;
  context.fill();

  const shine = context.createLinearGradient(0, 0, cardWidth, cardHeight);
  shine.addColorStop(0, 'rgba(255,255,255,.20)');
  shine.addColorStop(0.5, 'rgba(255,255,255,.04)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = shine;
  context.beginPath();
  context.moveTo(-80, 90);
  context.bezierCurveTo(170, 5, 360, 42, 575, -25);
  context.bezierCurveTo(710, -68, 805, -44, 930, 25);
  context.lineTo(930, -60);
  context.lineTo(-80, -60);
  context.closePath();
  context.fill();

  context.fillStyle = 'rgba(255,255,255,.06)';
  context.beginPath();
  context.arc(750, 432, 170, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = 'rgba(200,164,91,.14)';
  context.beginPath();
  context.arc(92, 88, 92, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = '#c8a45b';
  context.globalAlpha = 0.8;
  context.lineWidth = 5;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(92, 460);
  context.lineTo(520, 460);
  context.stroke();
  context.strokeStyle = '#ffffff';
  context.globalAlpha = 0.24;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(92, 486);
  context.lineTo(390, 486);
  context.stroke();
  context.globalAlpha = 1;

  const logoImage = await loadImage('/student-card-logo.png');
  context.drawImage(logoImage, 714, 24, 106, 106);

  context.direction = 'rtl';
  context.textAlign = 'center';
  context.fillStyle = '#d9bd79';
  context.font = '700 30px Tahoma, Arial, sans-serif';
  context.fillText('بطاقة طالب', 548, 118);
  context.fillStyle = '#ffffff';
  context.font = '800 48px Tahoma, Arial, sans-serif';
  context.fillText(input.studentName, 548, 222, 420);
  context.fillStyle = '#e8f3ee';
  context.font = '700 27px Tahoma, Arial, sans-serif';
  context.fillText(`رمز الطالب: ${input.studentCode}`, 548, 304, 420);
  context.font = '700 25px Tahoma, Arial, sans-serif';
  context.fillText(input.schoolName, 548, 374, 420);

  roundedRect(context, 54, 122, 284, 284, 30);
  context.fillStyle = '#ffffff';
  context.fill();
  context.strokeStyle = '#d9bd79';
  context.lineWidth = 5;
  context.stroke();
  const qrUrl = await QRCode.toDataURL(input.value, { width: 250, margin: 1, errorCorrectionLevel: 'M' });
  const qrImage = await loadImage(qrUrl);
  context.drawImage(qrImage, 71, 139, 250, 250);

  context.fillStyle = '#ffffff';
  context.font = '700 20px Tahoma, Arial, sans-serif';
  context.fillText('امسح QR للدفع', 196, 450);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('EXPORT_FAILED')), type, quality);
  });
}

function buildPdfFromJpeg(jpegDataUrl: string, imageWidth: number, imageHeight: number) {
  const base64 = jpegDataUrl.split(',')[1] ?? '';
  const jpegBytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const jpegBuffer = new ArrayBuffer(jpegBytes.length);
  new Uint8Array(jpegBuffer).set(jpegBytes);
  const encoder = new TextEncoder();
  const parts: Array<string | ArrayBuffer> = [];
  const offsets: number[] = [];
  let length = 0;

  const add = (part: string | ArrayBuffer) => {
    parts.push(part);
    length += typeof part === 'string' ? encoder.encode(part).length : part.byteLength;
  };
  const object = (body: string | ArrayBuffer, prefix: string, suffix = 'endobj\n') => {
    offsets.push(length);
    add(prefix);
    add(body);
    add(suffix);
  };

  add('%PDF-1.4\n');
  object('<< /Type /Catalog /Pages 2 0 R >>\n', '1 0 obj\n');
  object('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n', '2 0 obj\n');
  object(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfWidthPt.toFixed(2)} ${pdfHeightPt.toFixed(2)}] /Resources << /XObject << /CardImage 4 0 R >> >> /Contents 5 0 R >>\n`, '3 0 obj\n');
  object(jpegBuffer, `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`, '\nendstream\nendobj\n');
  const content = `q\n${pdfWidthPt.toFixed(2)} 0 0 ${pdfHeightPt.toFixed(2)} 0 0 cm\n/CardImage Do\nQ\n`;
  object(content, `5 0 obj\n<< /Length ${encoder.encode(content).length} >>\nstream\n`, 'endstream\nendobj\n');

  const xrefOffset = length;
  add(`xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

export default function Barcode(props: BarcodeProps) {
  const { value, studentName, studentCode, schoolName, fileName, downloadable = false } = props;
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(value, { width: 250, margin: 1, errorCorrectionLevel: 'M' }).then(url => {
      if (active) setQrUrl(url);
    });
    return () => { active = false; };
  }, [value]);

  const download = async (format: DownloadFormat) => {
    const baseName = safeFileName(fileName ?? `${studentCode}-${studentName}`);
    const canvas = await buildCardCanvas(props);

    if (format === 'png') {
      downloadBlob(await canvasToBlob(canvas, 'image/png'), `${baseName}.png`);
      return;
    }

    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.96);
    if (format === 'jpeg') {
      downloadBlob(await canvasToBlob(canvas, 'image/jpeg', 0.96), `${baseName}.jpeg`);
      return;
    }

    downloadBlob(buildPdfFromJpeg(jpegDataUrl, canvas.width, canvas.height), `${baseName}.pdf`);
  };

  return (
    <div className="barcode-card student-print-card" aria-label={`بطاقة الطالب ${studentName}`}>
      <img className="student-card-logo" src="/student-card-logo.png" alt="" aria-hidden="true" />
      <div className="student-card-info">
        <small>بطاقة طالب</small>
        <strong>{studentName}</strong>
        <span>رمز الطالب: {studentCode}</span>
        <span>{schoolName}</span>
      </div>
      <div className="student-card-qr">
        {qrUrl && <img className="qr-code" src={qrUrl} alt={`QR بطاقة الطالب ${studentName}`} />}
        <span>QR للدفع</span>
      </div>
      {downloadable && (
        <div className="barcode-downloads">
          <button type="button" className="secondary" onClick={() => void download('png')}>PNG</button>
          <button type="button" className="secondary" onClick={() => void download('jpeg')}>JPEG</button>
          <button type="button" className="secondary" onClick={() => void download('pdf')}>PDF</button>
        </div>
      )}
    </div>
  );
}
