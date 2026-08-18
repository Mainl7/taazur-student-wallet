'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

type BarcodeProps = {
  value: string;
  studentName: string;
  studentCode: string;
  schoolName: string;
  fileName?: string;
  downloadable?: boolean;
};

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

async function buildDownloadSvg(input: BarcodeProps) {
  const qrSvg = await QRCode.toString(input.value, { type: 'svg', width: 238, margin: 1, errorCorrectionLevel: 'M' });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="85.6mm" height="54mm" viewBox="0 0 856 540">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#eef7f2"/>
    </linearGradient>
    <linearGradient id="stripe" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0b5a42"/>
      <stop offset="1" stop-color="#c8a45b"/>
    </linearGradient>
  </defs>
  <rect width="856" height="540" rx="34" fill="url(#bg)"/>
  <rect x="20" y="20" width="816" height="500" rx="30" fill="none" stroke="#d9e9e1" stroke-width="3"/>
  <rect x="20" y="20" width="816" height="18" rx="9" fill="url(#stripe)"/>
  <circle cx="724" cy="430" r="100" fill="#0b5a42" opacity="0.08"/>
  <circle cx="85" cy="95" r="72" fill="#c8a45b" opacity="0.10"/>
  <g direction="rtl" unicode-bidi="plaintext" font-family="Tahoma, Arial, sans-serif">
    <text x="560" y="130" text-anchor="middle" font-size="30" font-weight="700" fill="#c8a45b">بطاقة طالب</text>
    <text x="560" y="218" text-anchor="middle" font-size="46" font-weight="800" fill="#0b5a42">${escapeXml(input.studentName)}</text>
    <text x="560" y="300" text-anchor="middle" font-size="26" fill="#14342a">رمز الطالب: ${escapeXml(input.studentCode)}</text>
    <text x="560" y="368" text-anchor="middle" font-size="25" fill="#14342a">${escapeXml(input.schoolName)}</text>
  </g>
  <rect x="54" y="132" width="272" height="272" rx="26" fill="#ffffff" stroke="#c8a45b" stroke-width="4"/>
  <image x="71" y="149" width="238" height="238" href="${svgToDataUri(qrSvg)}"/>
  <text x="190" y="450" text-anchor="middle" direction="rtl" unicode-bidi="plaintext" font-family="Tahoma, Arial, sans-serif" font-size="20" fill="#0b5a42">امسح QR للدفع</text>
</svg>`;
}

export default function Barcode(props: BarcodeProps) {
  const { value, studentName, studentCode, schoolName, fileName, downloadable = false } = props;
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(value, { width: 238, margin: 1, errorCorrectionLevel: 'M' }).then(url => {
      if (active) setQrUrl(url);
    });
    return () => { active = false; };
  }, [value]);

  const download = async () => {
    const svg = await buildDownloadSvg(props);
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName(fileName ?? `${studentCode}-${studentName}`)}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
      {downloadable && <button type="button" className="secondary barcode-download" onClick={() => void download()}>تنزيل بطاقة الطالب</button>}
    </div>
  );
}
