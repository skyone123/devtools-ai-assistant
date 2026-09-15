import type { CapturedRequest, WaterfallRequest } from '../../shared/types.js';

export interface WaterfallAnalysis {
  entries: WaterfallRequest[];
  slowTotal: CapturedRequest[];
  slowTtfbs: CapturedRequest[];
  sequentialChains: string[];
}

const SLOW_TOTAL_MS = 1000;
const SLOW_TTFB_MS = 500;

export function analyzeWaterfall(filtered: CapturedRequest[]): WaterfallAnalysis {
  const entries: WaterfallRequest[] = filtered
    .slice(-80)
    .map((r) => ({
      url: r.url,
      method: r.method,
      status: r.status,
      mimeType: r.mimeType,
      startTime: r.startTime,
      totalTime: r.totalTime,
      timings: r.timings,
      connection: r.connection,
    }));

  const slowTotal = filtered
    .filter((r) => r.totalTime >= SLOW_TOTAL_MS)
    .sort((a, b) => b.totalTime - a.totalTime)
    .slice(0, 10);

  const slowTtfbs = filtered
    .filter((r) => (r.timings.wait ?? 0) >= SLOW_TTFB_MS)
    .sort((a, b) => (b.timings.wait ?? 0) - (a.timings.wait ?? 0))
    .slice(0, 10);

  const sequentialChains = detectSequential(filtered);

  return { entries, slowTotal, slowTtfbs, sequentialChains };
}

function tsOf(r: CapturedRequest): number {
  const t = Date.parse(r.startTime);
  return Number.isNaN(t) ? r.receivedAt : t;
}

function detectSequential(filtered: CapturedRequest[]): string[] {
  const sorted = filtered.slice(-80).sort((a, b) => tsOf(a) - tsOf(b));
  const chains: string[] = [];
  let cur: CapturedRequest[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const sameHost = (s: CapturedRequest) => {
      try {
        return new URL(s.url).host === new URL(r.url).host;
      } catch {
        return false;
      }
    };
    const idle = cur.length === 0;
    if (!idle && sameHost(sorted[i - 1]) && tsOf(r) >= tsOf(sorted[i - 1]) + sorted[i - 1].totalTime) {
      cur.push(r);
    } else {
      if (cur.length >= 3) chains.push(renderChain(cur));
      cur = [r];
    }
  }
  if (cur.length >= 3) chains.push(renderChain(cur));
  return chains.slice(0, 5);
}

function renderChain(list: CapturedRequest[]): string {
  const total = list.reduce((s, r) => s + r.totalTime, 0);
  const lines = list
    .map((r, i) => `  ${i + 1}. ${r.method} ${trimPath(r.url)} (${Math.round(r.totalTime)}ms, wait ${Math.round(r.timings.wait ?? 0)}ms)`)
    .join('\n');
  return `${trimPath(list[0].url)}\n${lines}\n  → 串行合计约 ${Math.round(total)}ms`;
}

function trimPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.substring(0, 80) + (u.search ? '…' : '');
  } catch {
    return url.substring(0, 100);
  }
}