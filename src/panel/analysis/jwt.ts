import { JWT_PATTERNS } from '../../shared/constants.js';
import type { JwtInfo } from '../../shared/types.js';

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

export function parseJwt(token: string): JwtInfo {
  const parts = token.split('.');
  const info: JwtInfo = { token, source: '', claims: {} };
  if (parts.length !== 3) {
    info.parseError = 'not-a-jwt';
    return info;
  }
  try {
    const payloadRaw = b64urlDecode(parts[1]);
    const claims = JSON.parse(payloadRaw) as Record<string, unknown>;
    info.claims = claims;
    if (typeof claims.exp === 'number') info.exp = claims.exp;
    if (typeof claims.iat === 'number') info.iat = claims.iat;
  } catch {
    info.parseError = 'payload-unparseable';
  }
  return info;
}

export function extractJwtFromText(text: string): string[] {
  const out = new Set<string>();
  if (!text) return [];
  for (const pat of JWT_PATTERNS) {
    pat.lastIndex = 0;
    for (const m of text.matchAll(pat)) {
      out.add(m[0]);
    }
  }
  return Array.from(out);
}

export function collectJwts(requests: { requestHeaders: { name: string; value: string }[]; url: string }[]): JwtInfo[] {
  const out: JwtInfo[] = [];
  const seen = new Set<string>();
  for (const req of requests) {
    const auth = req.requestHeaders.find((h) => h.name.toLowerCase() === 'authorization');
    if (auth?.value?.startsWith('Bearer ')) {
      const token = auth.value.slice(7);
      if (!seen.has(token)) {
        seen.add(token);
        const info = parseJwt(token);
        info.source = 'Authorization: ' + req.url.split('?')[0];
        out.push(info);
      }
    }
  }
  return out.slice(0, 10);
}