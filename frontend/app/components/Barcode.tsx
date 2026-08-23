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

function drawPattern(context: CanvasRenderingContext2D) {
  context.save();
  context.strokeStyle = 'rgba(216,189,121,.13)';
  context.lineWidth = 2;
  for (let x = 16; x < 356; x += 58) {
    for (let y = 16; y < cardHeight - 18; y += 58) {
      context.beginPath();
      context.moveTo(x + 29, y);
      context.lineTo(x + 42, y + 16);
      context.lineTo(x + 58, y + 29);
      context.lineTo(x + 42, y + 42);
      context.lineTo(x + 29, y + 58);
      context.lineTo(x + 16, y + 42);
      context.lineTo(x, y + 29);
      context.lineTo(x + 16, y + 16);
      context.closePath();
      context.stroke();
      context.strokeRect(x + 15, y + 15, 28, 28);
    }
  }
  context.restore();
}

function drawDiamond(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  context.beginPath();
  context.moveTo(x, y - size);
  context.lineTo(x + size, y);
  context.lineTo(x, y + size);
  context.lineTo(x - size, y);
  context.closePath();
  context.fill();
}

async function buildCardCanvas(input: BarcodeProps) {
  const scale = 4;
  const canvas = document.createElement('canvas');
  canvas.width = cardWidth * scale;
  canvas.height = cardHeight * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('CANVAS_NOT_SUPPORTED');
  context.scale(scale, scale);

  const backgroundImage = await loadImage('/student-card-background.svg');
  context.save();
  roundedRect(context, 0, 0, cardWidth, cardHeight, 42);
  context.clip();
  context.drawImage(backgroundImage, 0, 0, cardWidth, cardHeight);
  context.restore();

  const qrUrl = await QRCode.toDataURL(input.value, { width: 132, margin: 1, errorCorrectionLevel: 'M' });
  const qrImage = await loadImage(qrUrl);
  context.drawImage(qrImage, 57, 278, 124, 124);

  context.direction = 'rtl';
  context.textAlign = 'right';
  context.shadowColor = 'rgba(0,0,0,.32)';
  context.shadowBlur = 8;
  context.shadowOffsetY = 2;
  context.fillStyle = '#ffffff';
  context.font = '900 46px Tahoma, Arial, sans-serif';
  context.fillText(input.studentName, 790, 288, 390);
  context.fillStyle = '#ffffff';
  context.font = '900 40px Tahoma, Arial, sans-serif';
  context.direction = 'ltr';
  context.textAlign = 'right';
  context.fillText(input.studentCode, 790, 378, 330);
  context.fillStyle = '#ffffff';
  context.font = '900 22px Tahoma, Arial, sans-serif';
  context.fillText(input.schoolName, 790, 463, 450);
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
    <div className="barcode-card" aria-label={`بطاقة الطالب ${studentName}`}>
      <div className="student-print-card">
        <img className="student-card-background" src="/student-card-background.svg" alt="" aria-hidden="true" />
        <div className="student-card-info">
          <strong>{studentName}</strong>
          <b>{studentCode}</b>
          <span>{schoolName}</span>
        </div>
        <div className="student-card-qr">
          {qrUrl && <img className="qr-code" src={qrUrl} alt={`QR بطاقة الطالب ${studentName}`} />}
          <span>رمز البطاقة</span>
        </div>
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
