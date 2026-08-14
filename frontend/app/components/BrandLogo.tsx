'use client';
import { useState } from 'react';

export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  const [missing, setMissing] = useState(false);
  return <div className={compact ? 'brand compact' : 'brand'}>{!missing ? <img src="/rafed/uploads/system/widelogo.png" alt="شعار الجمعية" onError={() => setMissing(true)} /> : <div><strong>تآزر</strong><small>رعاية الأيتام</small></div>}</div>;
}
