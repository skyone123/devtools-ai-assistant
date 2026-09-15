import type { AttackSurfaceEntry, CapturedRequest } from '../../shared/types.js';

const PATH_PARAM: RegExp = /^\d+$/;
const UUID_PARAM: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_PARAM: RegExp = /^[0-9a-f]{16,64}$/i;
const HEX_PARAM: RegExp = /^[a-zA-Z0-9_-]{16,}$/;

function paramKind(seg: string): string {
  if (UUID_PARAM.test(seg)) return '{uuid}';
  if (PATH_PARAM.test(seg)) return '{id}';
  if (HASH_PARAM.test(seg)) return '{hash}';
  if (HEX_PARAM.test(seg)) return '{key}';
  return seg;
}

function toPattern(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map(paramKind)
    .join('/');
}

interface SurfaceAcc {
  pattern: string;
  methods: string[];
  paths: string[];
  queryParams: Set<string>;
  hasAuth: boolean;
}

export function enumerateAttackSurface(requests: CapturedRequest[]): AttackSurfaceEntry[] {
  const map = new Map<string, SurfaceAcc>();

  for (const r of requests) {
    let pathname: string;
    try {
      pathname = new URL(r.url).pathname;
    } catch {
      continue;
    }
    const pattern = toPattern(pathname);
    const hasAuth = r.requestHeaders.some((h) => h.name.toLowerCase() === 'authorization');

    const key = `${r.method} /${pattern}`;
    const entry =
      map.get(key) ||
      ({
        pattern: '/' + pattern,
        methods: [],
        paths: [],
        queryParams: new Set<string>(),
        hasAuth: false,
      } as SurfaceAcc);

    if (!entry.methods.includes(r.method)) entry.methods.push(r.method);
    if (!entry.paths.includes('/' + pattern)) entry.paths.push('/' + pattern);
    entry.hasAuth = entry.hasAuth || hasAuth;

    try {
      const u = new URL(r.url);
      for (const name of u.searchParams.keys()) {
        entry.queryParams.add(name);
      }
    } catch {
      /* ignore */
    }

    map.set(key, entry);
  }

  const sorted = Array.from(map.values())
    .map((e) => ({ ...e, queryParams: Array.from(e.queryParams) }))
    .sort((a, b) => {
      const pa = a.pattern.split('/').filter(Boolean).length;
      const pb = b.pattern.split('/').filter(Boolean).length;
      return pb - pa;
    });

  return sorted.slice(0, 60);
}