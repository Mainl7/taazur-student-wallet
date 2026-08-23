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

  roundedRect(context, 0, 0, cardWidth, cardHeight, 42);
  const background = context.createLinearGradient(0, 0, cardWidth, cardHeight);
  background.addColorStop(0, '#16765b');
  background.addColorStop(0.48, '#0b5a42');
  background.addColorStop(1, '#03281f');
  context.fillStyle = background;
  context.fill();

  context.save();
  roundedRect(context, 0, 0, cardWidth, cardHeight, 42);
  context.clip();
  drawPattern(context);
  const shade = context.createLinearGradient(0, 0, cardWidth, 0);
  shade.addColorStop(0, 'rgba(255,255,255,.08)');
  shade.addColorStop(0.48, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(0,0,0,.18)');
  context.fillStyle = shade;
  context.fillRect(0, 0, cardWidth, cardHeight);
  context.fillStyle = 'rgba(1,31,23,.38)';
  context.beginPath();
  context.moveTo(cardWidth, 0);
  context.lineTo(760, 0);
  context.lineTo(638, cardHeight);
  context.lineTo(cardWidth, cardHeight);
  context.closePath();
  context.fill();
  context.strokeStyle = 'rgba(216,189,121,.82)';
  context.lineWidth = 2.3;
  context.beginPath();
  context.arc(395, 194, 122, Math.PI * .68, Math.PI * 1.58);
  context.stroke();
  context.beginPath();
  context.arc(382, 366, 154, Math.PI * .68, Math.PI * 1.35);
  context.stroke();
  context.restore();

  context.strokeStyle = '#c8a45b';
  context.lineWidth = 4;
  roundedRect(context, 12, 12, cardWidth - 24, cardHeight - 24, 34);
  context.stroke();

  context.save();
  context.shadowColor = 'rgba(20,52,42,.16)';
  context.shadowBlur = 22;
  context.shadowOffsetY = 10;
  roundedRect(context, 74, 266, 190, 190, 18);
  context.fillStyle = '#ffffff';
  context.fill();
  context.shadowColor = 'transparent';
  context.strokeStyle = '#d5b468';
  context.lineWidth = 5;
  context.stroke();
  context.restore();

  const qrUrl = await QRCode.toDataURL(input.value, { width: 160, margin: 1, errorCorrectionLevel: 'M' });
  const qrImage = await loadImage(qrUrl);
  context.drawImage(qrImage, 89, 281, 160, 160);

  context.direction = 'rtl';
  context.textAlign = 'center';
  context.fillStyle = '#d9bd79';
  context.font = '900 24px Tahoma, Arial, sans-serif';
  context.fillText('رمز البطاقة', 169, 498);

  const logoImage = await loadImage('/student-card-logo.png');
  const logoGlow = context.createRadialGradient(724, 122, 14, 724, 122, 116);
  logoGlow.addColorStop(0, 'rgba(255,255,255,.13)');
  logoGlow.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = logoGlow;
  context.fillRect(590, 10, 260, 230);
  context.globalAlpha = .94;
  context.drawImage(logoImage, 650, 48, 150, 150);
  context.globalAlpha = 1;

  context.direction = 'rtl';
  context.textAlign = 'right';
  context.shadowColor = 'rgba(0,0,0,.32)';
  context.shadowBlur = 8;
  context.shadowOffsetY = 2;
  context.fillStyle = '#d9bd79';
  context.font = '900 30px Tahoma, Arial, sans-serif';
  context.fillText('اسم الطالب', 790, 250);
  context.fillStyle = '#ffffff';
  context.font = '900 46px Tahoma, Arial, sans-serif';
  context.fillText(input.studentName, 790, 312, 390);

  context.shadowBlur = 0;
  context.strokeStyle = 'rgba(217,189,121,.9)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(430, 340);
  context.lineTo(790, 340);
  context.stroke();
  context.fillStyle = '#d9bd79';
  drawDiamond(context, 802, 340, 10);

  context.fillStyle = '#d9bd79';
  context.font = '900 30px Tahoma, Arial, sans-serif';
  context.fillText('رمز الطالب', 790, 388);
  context.fillStyle = '#ffffff';
  context.font = '900 40px Tahoma, Arial, sans-serif';
  context.direction = 'ltr';
  context.textAlign = 'right';
  context.fillText(input.studentCode, 790, 438, 330);

  context.direction = 'rtl';
  context.textAlign = 'right';
  context.strokeStyle = 'rgba(217,189,121,.9)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(430, 462);
  context.lineTo(790, 462);
  context.stroke();
  context.fillStyle = '#d9bd79';
  drawDiamond(context, 802, 462, 10);

  context.fillStyle = '#d9bd79';
  context.font = '900 28px Tahoma, Arial, sans-serif';
  context.fillText('المدرسة', 790, 486);
  context.fillStyle = '#ffffff';
  context.font = '900 24px Tahoma, Arial, sans-serif';
  context.fillText(input.schoolName, 790, 520, 450);
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
        <img className="student-card-logo" src="/student-card-logo.png" alt="" aria-hidden="true" />
        <div className="student-card-info">
          <small>اسم الطالب</small>
          <strong>{studentName}</strong>
          <i />
          <small>رمز الطالب</small>
          <b>{studentCode}</b>
          <i />
          <small>المدرسة</small>
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
