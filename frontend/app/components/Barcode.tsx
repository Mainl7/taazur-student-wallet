'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

const patterns = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'
];

type BarcodeProps = {
  value: string;
  label?: string;
  fileName?: string;
  downloadable?: boolean;
};

function encode(value: string) {
  const text = value.replace(/[^\x20-\x7e]/g, '');
  const codes = [104, ...text.split('').map(char => char.charCodeAt(0) - 32)];
  const checksum = codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103;
  return [...codes, checksum, 106].map(code => patterns[code]).join('');
}

function createBars(value: string) {
  const modules = encode(value);
  let x = 0;
  const bars = modules.split('').flatMap((width, index) => {
    const w = Number(width);
    const bar = index % 2 === 0 ? { x, width: w } : null;
    x += w;
    return bar ? [bar] : [];
  });

  return { bars, width: x };
}

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
    .slice(0, 90) || 'taazur-student-card';
}

function svgToDataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function buildDownloadSvg(value: string, label?: string) {
  const { bars, width } = createBars(value);
  const scale = 3;
  const canvasWidth = Math.max(680, width * scale + 260);
  const barcodeWidth = width * scale;
  const barcodeX = 205 + (canvasWidth - 235 - barcodeWidth) / 2;
  const barRects = bars
    .map(bar => `<rect x="${barcodeX + bar.x * scale}" y="105" width="${bar.width * scale}" height="88" />`)
    .join('');
  const qrSvg = await QRCode.toString(value, { type: 'svg', width: 150, margin: 1, errorCorrectionLevel: 'M' });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="300" viewBox="0 0 ${canvasWidth} 300">
  <rect width="100%" height="100%" rx="28" fill="#ffffff"/>
  <rect x="14" y="14" width="${canvasWidth - 28}" height="272" rx="24" fill="#f7fbf8" stroke="#dce8e1" stroke-width="2"/>
  <text x="${canvasWidth / 2}" y="52" text-anchor="middle" direction="rtl" unicode-bidi="plaintext" font-family="Tahoma, Arial, sans-serif" font-size="22" font-weight="700" fill="#0b5a42">${escapeXml(label ?? 'بطاقة الطالب')}</text>
  <image x="38" y="82" width="150" height="150" href="${svgToDataUri(qrSvg)}"/>
  <text x="113" y="255" text-anchor="middle" direction="rtl" unicode-bidi="plaintext" font-family="Tahoma, Arial, sans-serif" font-size="13" fill="#0b5a42">امسح QR بالكاميرا</text>
  <g fill="#101a16">${barRects}</g>
  <text x="${(canvasWidth + 210) / 2}" y="232" text-anchor="middle" font-family="Consolas, monospace" font-size="14" fill="#16392f">${escapeXml(value)}</text>
  <text x="${canvasWidth / 2}" y="275" text-anchor="middle" direction="rtl" unicode-bidi="plaintext" font-family="Tahoma, Arial, sans-serif" font-size="12" fill="#6b7f75">تآزر — بطاقة دفع مدرسية</text>
</svg>`;
}

export default function Barcode({ value, label, fileName, downloadable = false }: BarcodeProps) {
  const { bars, width } = createBars(value);
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(value, { width: 150, margin: 1, errorCorrectionLevel: 'M' }).then(url => {
      if (active) setQrUrl(url);
    });
    return () => { active = false; };
  }, [value]);

  const download = async () => {
    const svg = await buildDownloadSvg(value, label);
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName(fileName ?? label ?? value)}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="barcode-card">
      {label && <strong className="barcode-label">{label}</strong>}
      <div className="barcode-media">
        {qrUrl && <img className="qr-code" src={qrUrl} alt={`QR ${value}`} />}
        <svg className="barcode-lines" viewBox={`0 0 ${width} 58`} preserveAspectRatio="none" role="img" aria-label={`باركود ${value}`}>
          {bars.map(bar => <rect key={`${bar.x}-${bar.width}`} x={bar.x} y="0" width={bar.width} height="58" />)}
        </svg>
      </div>
      <small>{value}</small>
      {downloadable && <button type="button" className="secondary barcode-download" onClick={() => void download()}>تنزيل بطاقة الطالب</button>}
    </div>
  );
}
