import {
  MAX_SENSITIVE_SAMPLE_LENGTH,
  SENSITIVE_PATTERNS,
} from '../../shared/constants.js';
import type {
  AuthAuditEntry,
  CapturedRequest,
  SensitiveHit,
  SensitiveType,
  SecurityHeaderIssue,
} from '../../shared/types.js';

export function maskSample(s: string): string {
  const t = s.length > MAX_SENSITIVE_SAMPLE_LENGTH ? s.substring(0, MAX_SENSITIVE_SAMPLE_LENGTH) + '…' : s;
  return t;
}

function extractValueFromMatch(m: RegExpMatchArray): string {
  if (m.length > 1 && m[1]) return m[1];
  return m[0];
}

function scanText(type: SensitiveType, text: string, limit = 200): string[] {
  const spec = SENSITIVE_PATTERNS[type];
  if (!spec) return [];
  const out: string[] = [];
  for (const m of text.matchAll(spec.regex)) {
    out.push(extractValueFromMatch(m));
    if (out.length >= limit) break;
  }
  return out;
}

export function scanSensitiveInText(
  url: string,
  type: SensitiveType,
  text: string,
  location: SensitiveHit['location'],
  context: string
): SensitiveHit[] {
  const hits: SensitiveHit[] = [];
  const values = scanText(type, text);
  for (const v of values.slice(0, 10)) {
    hits.push({ url, type, location, sample: maskSample(v), context });
  }
  return hits;
}

function contextOf(text: string, index: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + 60);
  return text.substring(start, end).replace(/\r?\n/g, ' ');
}

export function scanUrlForSecrets(request: CapturedRequest): SensitiveHit[] {
  const hits: SensitiveHit[] = [];
  let url: string;
  try {
    const u = new URL(request.url);
    url = u.search;
  } catch {
    url = request.url;
  }
  for (const type of ['jwt', 'aws_key', 'internal_ip', 'generic_secret'] as SensitiveType[]) {
    for (const v of scanText(type, url)) {
      hits.push({ url: request.url, type, location: 'url', sample: maskSample(v), context: url.substring(0, 120) });
    }
  }
  return hits;
}

export function scanHeaderForSecrets(entry: CapturedRequest): SensitiveHit[] {
  const hits: SensitiveHit[] = [];
  const auth = entry.requestHeaders.find((h) => h.name.toLowerCase() === 'authorization');
  if (auth?.value?.startsWith('Bearer ')) {
    const token = auth.value.slice(7);
    hits.push({ url: entry.url, type: 'jwt', location: 'authorization', sample: maskSample(token), context: 'request header' });
  }
  return hits;
}

export async function scanBodiesForSecrets(
  requests: CapturedRequest[],
  loadBody: (r: CapturedRequest) => Promise<string | null>
): Promise<SensitiveHit[]> {
  const types: SensitiveType[] = ['aws_key', 'private_key', 'jwt', 'internal_ip', 'phone', 'idcard', 'email', 'generic_secret'];
  const hits: SensitiveHit[] = [];
  const candidates = requests.filter((r) => !r.mimeType.includes('javascript') && !r.mimeType.startsWith('text/css')).slice(-40);
  for (const req of candidates) {
    let body: string | null = null;
    try {
      body = await loadBody(req);
    } catch {
      body = null;
    }
    if (!body) continue;
    const head = body.substring(0, 4000);
    for (const type of types) {
      const spec = SENSITIVE_PATTERNS[type];
      spec.regex.lastIndex = 0;
      for (const m of head.matchAll(spec.regex)) {
        const index = m.index ?? 0;
        hits.push({
          url: req.url,
          type,
          location: 'responseBody',
          sample: maskSample(extractValueFromMatch(m)),
          context: contextOf(head, index).substring(0, 120),
        });
        if (hits.length >= 150) return hits;
      }
    }
  }
  return hits;
}

export function authAudit(requests: CapturedRequest[]): AuthAuditEntry[] {
  const seen = new Map<string, AuthAuditEntry>();
  for (const r of requests) {
    const key = `${r.method} ${r.url.split('?')[0]}`;
    const auth = r.requestHeaders.find((h) => h.name.toLowerCase() === 'authorization');
    const entry =
      seen.get(key) ||
      ({
        url: r.url,
        method: r.method,
        hasAuth: !!auth,
        sensitive: false,
        bodySent: !!r.postData,
      } as AuthAuditEntry);
    entry.hasAuth = entry.hasAuth || !!auth;
    entry.sensitive = entry.sensitive || /(admin|login|auth|token|user|account|password|session|order|billing|payment|profile)/i.test(key);
    entry.bodySent = entry.bodySent || !!r.postData;
    seen.set(key, entry);
  }
  return Array.from(seen.values()).slice(-200);
}

function headerValue(headers: { name: string; value: string }[], name: string): string | undefined {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value;
}

export function securityHeaderAudit(requests: CapturedRequest[]): SecurityHeaderIssue[] {
  const out: SecurityHeaderIssue[] = [];
  const checked = requests.filter(
    (r) => (r.mimeType.includes('html') || r.mimeType.includes('json') || r.mimeType === '') && r.status < 400
  );
  for (const r of checked.slice(-60)) {
    const missing: SecurityHeaderIssue['missing'] = [];
    if (!headerValue(r.responseHeaders, 'content-security-policy')) missing.push('csp');
    if (!headerValue(r.responseHeaders, 'strict-transport-security')) missing.push('hsts');
    if (!headerValue(r.responseHeaders, 'x-frame-options')) missing.push('xfo');
    if (!headerValue(r.responseHeaders, 'x-content-type-options')) missing.push('xcto');
    if (missing.length > 0) out.push({ url: r.url, missing });
  }
  return out;
}