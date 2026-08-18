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

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function safeFileName(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 90) || 'student-card';
}

function svgToDataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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

async function buildCardSvg(input: BarcodeProps) {
  const qrSvg = await QRCode.toString(input.value, { type: 'svg', width: 250, margin: 1, errorCorrectionLevel: 'M' });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="85.6mm" height="54mm" viewBox="0 0 ${cardWidth} ${cardHeight}">
  <defs>
    <linearGradient id="cardBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#063927"/>
      <stop offset="0.52" stop-color="#0b5a42"/>
      <stop offset="1" stop-color="#094630"/>
    </linearGradient>
    <linearGradient id="softShine" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="0.48" stop-color="#ffffff" stop-opacity="0.03"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${cardWidth}" height="${cardHeight}" rx="42" fill="#0b5a42"/>
  <rect x="0" y="0" width="${cardWidth}" height="${cardHeight}" rx="42" fill="url(#cardBg)"/>
  <path d="M-80 90 C170 5 360 42 575 -25 C710 -68 805 -44 930 25 L930 -60 L-80 -60 Z" fill="url(#softShine)"/>
  <circle cx="750" cy="432" r="170" fill="#ffffff" opacity="0.06"/>
  <circle cx="92" cy="88" r="92" fill="#c8a45b" opacity="0.14"/>
  <path d="M92 460 H520" stroke="#c8a45b" stroke-width="5" stroke-linecap="round" opacity="0.8"/>
  <path d="M92 486 H390" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.24"/>
  <g direction="rtl" unicode-bidi="plaintext" font-family="Tahoma, Arial, sans-serif">
    <text x="548" y="118" text-anchor="middle" font-size="30" font-weight="700" fill="#d9bd79">بطاقة طالب</text>
    <text x="548" y="222" text-anchor="middle" font-size="48" font-weight="800" fill="#ffffff">${escapeXml(input.studentName)}</text>
    <text x="548" y="304" text-anchor="middle" font-size="27" font-weight="700" fill="#e8f3ee">رمز الطالب: ${escapeXml(input.studentCode)}</text>
    <text x="548" y="374" text-anchor="middle" font-size="25" font-weight="700" fill="#e8f3ee">${escapeXml(input.schoolName)}</text>
  </g>
  <rect x="54" y="122" width="284" height="284" rx="30" fill="#ffffff" stroke="#d9bd79" stroke-width="5"/>
  <image x="71" y="139" width="250" height="250" href="${svgToDataUri(qrSvg)}"/>
  <text x="196" y="450" text-anchor="middle" direction="rtl" unicode-bidi="plaintext" font-family="Tahoma, Arial, sans-serif" font-size="20" font-weight="700" fill="#ffffff">امسح QR للدفع</text>
</svg>`;
}

async function svgToCanvas(svg: string) {
  const image = new Image();
  image.decoding = 'async';
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('IMAGE_RENDER_FAILED'));
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = cardWidth * 4;
    canvas.height = cardHeight * 4;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('CANVAS_NOT_SUPPORTED');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
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
    const svg = await buildCardSvg(props);
    const canvas = await svgToCanvas(svg);

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
