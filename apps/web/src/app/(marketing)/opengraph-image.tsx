import { ImageResponse } from 'next/og';
import { site } from '@/marketing/lib/site';

export const alt = `${site.name} — One Platform. Every Employee. Endless Possibilities.`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Social share card, generated at build time. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: 'linear-gradient(135deg, #07122a 0%, #0b1a36 60%, #075e4b 100%)',
          color: '#fff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: '#10b88a', display: 'flex' }} />
          <div style={{ fontSize: 36, fontWeight: 700 }}>{site.name}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>One Platform. Every Employee.</div>
          <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, color: '#34d1a3' }}>Endless Possibilities.</div>
        </div>
        <div style={{ fontSize: 28, color: '#b8c0ce' }}>Hiring · Onboarding · Attendance · Leave · Payroll · Offboarding</div>
      </div>
    ),
    size
  );
}
