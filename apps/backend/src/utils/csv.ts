/** Minimal RFC 4180 CSV helpers (exports open directly in Excel). */

type Cell = string | number | boolean | Date | null | undefined;

function esc(v: Cell): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds a CSV string (with a UTF-8 BOM so Excel detects the encoding). */
export function toCsv(headers: string[], rows: Cell[][]): string {
  return '\uFEFF' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

/** Parses CSV text into rows of strings. Handles quotes, escaped quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** Parses CSV with a header row into objects keyed by the (trimmed) header names. */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const [header, ...rest] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/** Sends a CSV download. */
export function sendCsv(res: import('express').Response, fileName: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
  res.send(csv);
}
