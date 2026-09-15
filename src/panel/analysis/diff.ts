import { MAX_DIFF_ENTRIES, MAX_DIFF_VALUE_LENGTH } from '../../shared/constants.js';
import type { CapturedRequest, JsonDiffEntry, JsonDiffResult } from '../../shared/types.js';

function fmt(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') {
    const t = v.length > MAX_DIFF_VALUE_LENGTH ? v.substring(0, MAX_DIFF_VALUE_LENGTH) + '…' : v;
    return JSON.stringify(t);
  }
  if (typeof v === 'object') {
    const t = JSON.stringify(v);
    return t.length > MAX_DIFF_VALUE_LENGTH ? t.substring(0, MAX_DIFF_VALUE_LENGTH) + '…' : t;
  }
  return String(v);
}

function pathOf(prefix: string, key: string | number): string {
  return typeof key === 'number' ? `${prefix}[${key}]` : prefix ? `${prefix}.${key}` : String(key);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

const MAX_DEPTH = 12;
const MAX_ARRAY_ITEMS = 60;

function stableItemKey(v: unknown): string {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    const orderKeys = ['id', 'key', 'name', 'code', 'uuid'];
    for (const k of orderKeys) {
      if (obj[k] !== undefined) return `${k}=${JSON.stringify(obj[k])}`;
    }
    return JSON.stringify(v);
  }
  return JSON.stringify(v);
}

export function diffJson(
  a: unknown,
  b: unknown,
  base = ''
): {
  added: JsonDiffEntry[];
  removed: JsonDiffEntry[];
  changed: JsonDiffEntry[];
  truncated: boolean;
} {
  const added: JsonDiffEntry[] = [];
  const removed: JsonDiffEntry[] = [];
  const changed: JsonDiffEntry[] = [];
  let truncated = false;
  let budget = MAX_DIFF_ENTRIES;

  function walk(x: unknown, y: unknown, prefix: string, depth: number) {
    if (budget <= 0) {
      truncated = true;
      return;
    }
    if (depth > MAX_DEPTH) {
      truncated = true;
      return;
    }

    if (valuesEqual(x, y)) return;

    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length === y.length && x.length > 0) {
        const sa = x.map((v) => stableItemKey(v)).sort();
        const sb = y.map((v) => stableItemKey(v)).sort();
        if (JSON.stringify(sa) === JSON.stringify(sb)) {
          return;
        }
      }
      if (x.length !== y.length) {
        changed.push({ path: prefix || '$', from: `array x${x.length}→y${y.length}` });
        budget--;
      }
      const len = Math.max(x.length, y.length);
      for (let i = 0; i < Math.min(len, MAX_ARRAY_ITEMS); i++) {
        if (budget <= 0) break;
        const p = pathOf(prefix, i);
        if (i >= x.length) {
          added.push({ path: p, to: fmt(y[i]) });
          budget--;
        } else if (i >= y.length) {
          removed.push({ path: p, from: fmt(x[i]) });
          budget--;
        } else {
          walk(x[i], y[i], p, depth + 1);
        }
      }
      if (len > MAX_ARRAY_ITEMS) truncated = true;
      return;
    }

    if (x !== null && typeof x === 'object' && y !== null && typeof y === 'object') {
      const xObj = x as Record<string, unknown>;
      const yObj = y as Record<string, unknown>;
      const keysX = Object.keys(xObj);
      const keysY = Object.keys(yObj);
      for (const k of keysY) {
        if (budget <= 0) break;
        const p = pathOf(prefix, k);
        if (!(k in xObj)) {
          added.push({ path: p, to: fmt(yObj[k]) });
          budget--;
        } else {
          walk(xObj[k], yObj[k], p, depth + 1);
        }
      }
      for (const k of keysX) {
        if (budget <= 0) break;
        if (!(k in yObj)) {
          removed.push({ path: pathOf(prefix, k), from: fmt(xObj[k]) });
          budget--;
        }
      }
      return;
    }

    changed.push({ path: prefix || '$', from: fmt(x), to: fmt(y) });
    budget--;
  }

  walk(a, b, base, 0);
  return { added, removed, changed, truncated };
}

export function parseJsonSafely(text: string): unknown {
  if (!text) return undefined;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/^\{[\s\S]*\}$/) || trimmed.match(/^\[[\s\S]*\]$/);
    return match ? undefined : text;
  }
}

export function afterBaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, '');
  } catch {
    return url;
  }
}

export async function diffLatestPair(
  requests: CapturedRequest[],
  loadBody: (r: CapturedRequest) => Promise<string | null>
): Promise<JsonDiffResult> {
  const absolutePath = requests[0]?.url.split('?')[0];
  if (requests.length < 2) {
    return { same: false, absolutePath, addedValues: 0, removedValues: 0, added: [], removed: [], changed: [], truncated: false, error: '同分组请求不足两次' };
  }
  const prev = requests[requests.length - 2];
  const curr = requests[requests.length - 1];

  const prevBody = await loadBody(prev);
  const currBody = await loadBody(curr);
  if (!prevBody || !currBody) {
    return {
      same: false,
      absolutePath,
      addedValues: 0,
      removedValues: 0,
      added: [],
      removed: [],
      changed: [],
      truncated: false,
      error: '响应体不可用（可能已从内存移除），尝试先触发一次新的相同请求',
    };
  }

  const a = parseJsonSafely(prevBody);
  const b = parseJsonSafely(currBody);
  if (a === undefined || b === undefined) {
    return {
      same: false,
      absolutePath,
      addedValues: 0,
      removedValues: 0,
      added: [],
      removed: [],
      changed: [],
      truncated: false,
      error: '响应体不是有效 JSON，无法做字段级 diff',
    };
  }

  const { added, removed, changed, truncated } = diffJson(a, b);
  return {
    same: added.length === 0 && removed.length === 0 && changed.length === 0,
    absolutePath,
    addedValues: added.length,
    removedValues: removed.length,
    added,
    removed,
    changed,
    truncated,
  };
}