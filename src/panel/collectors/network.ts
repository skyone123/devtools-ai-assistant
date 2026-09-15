import {
  MAX_FOCUS_BODY_LENGTH,
  MAX_NETWORK_ENTRIES,
  MAX_RESPONSE_BODY_LENGTH,
} from '../../shared/constants.js';
import type { CapturedRequest, NetworkContextEntry, RequestTimings } from '../../shared/types.js';

type ChromeRequest = {
  request: {
    url: string;
    method: string;
    headers: { name: string; value: string }[];
    postData?: { text?: string };
  };
  response: {
    status: number;
    statusText: string;
    content: { mimeType: string };
    headers: { name: string; value: string }[];
  };
  time: number;
  startedDateTime?: string;
  connection?: string;
  _connectionId?: string;
  serverIPAddress?: string;
  timings?: {
    blocked?: number;
    dns?: number;
    connect?: number;
    send?: number;
    wait?: number;
    receive?: number;
    ssl?: number;
  };
  getContent: (cb: (content: string, encoding?: string) => void) => void;
};

type ChromeHarEntry = {
  request: {
    url: string;
    method: string;
    headers?: { name: string; value: string }[];
    postData?: { text?: string };
  };
  response: {
    status: number;
    statusText?: string;
    content?: { mimeType?: string };
    headers?: { name: string; value: string }[];
  };
  time?: number;
  startedDateTime?: string;
  connection?: string;
  _connectionId?: string;
  serverIPAddress?: string;
  timings?: {
    blocked?: number;
    dns?: number;
    connect?: number;
    send?: number;
    wait?: number;
    receive?: number;
    ssl?: number;
  };
};

interface StoredRequest extends CapturedRequest {
  source: ChromeRequest;
  bodyLoaded: boolean;
  body: string | null;
}

const STATIC_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'font/',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'application/font-',
  'application/vnd.ms-fontobject',
  'application/wasm',
  'manifest',
];

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isStaticResource(mimeType: string): boolean {
  const lower = (mimeType || '').toLowerCase();
  if (!lower) return false;
  return STATIC_MIME_PREFIXES.some((p) => lower.startsWith(p) || lower.includes(p));
}

export function isSensitivePath(url: string): boolean {
  const lower = url.toLowerCase();
  const needles = [
    '/admin',
    '/login',
    '/session',
    '/auth',
    '/token',
    '/user',
    '/password',
    '/account',
    '/profile',
    '/api/me',
    '/billing',
    '/payment',
    '/order',
  ];
  return needles.some((n) => lower.includes(n));
}

function groupKey(r: { request: { url: string; method: string }; response: { status: number } }): string {
  return `${r.request.method} ${r.request.url.split('?')[0]} ${r.response.status}`;
}

function toTimings(t: ChromeRequest['timings']): RequestTimings {
  return {
    blocked: t?.blocked,
    dns: t?.dns,
    connect: t?.connect,
    send: t?.send,
    wait: t?.wait,
    receive: t?.receive,
    ssl: t?.ssl,
  };
}

function toCaptured(r: ChromeRequest, receivedAt: number): CapturedRequest {
  const key = groupKey(r);
  const url = r.request.url;
  return {
    key,
    url,
    method: r.request.method,
    status: r.response.status,
    statusText: r.response.statusText,
    mimeType: r.response.content.mimeType,
    requestHeaders: r.request.headers || [],
    responseHeaders: r.response.headers || [],
    postData: r.request.postData?.text ? r.request.postData.text : null,
    startTime: r.startedDateTime || new Date(receivedAt).toISOString(),
    totalTime: r.time || 0,
    timings: toTimings(r.timings),
    connection: r.connection || r._connectionId,
    serverIP: r.serverIPAddress,
    receivedAt,
  };
}

export class NetworkCollector {
  private groups = new Map<string, StoredRequest[]>();
  private clock = 0;
  private maxPerGroup = 8;

  constructor() {
    chrome.devtools.network.onRequestFinished.addListener((request: ChromeRequest) => {
      this.push(request);
    });
  }

  private push(request: ChromeRequest) {
    const entry: StoredRequest = {
      ...toCaptured(request, ++this.clock),
      source: request,
      bodyLoaded: false,
      body: null,
    };
    const list = this.groups.get(entry.key) || [];
    list.push(entry);
    if (list.length > this.maxPerGroup) list.shift();
    this.groups.set(entry.key, list);
  }

  private get all(): StoredRequest[] {
    return Array.from(this.groups.values())
      .flat()
      .sort((a, b) => a.receivedAt - b.receivedAt);
  }

  getErrorCount(): number {
    return this.all.filter((r) => r.status >= 400).length;
  }

  getRequestCount(): number {
    return this.all.filter((r) => !isStaticResource(r.mimeType)).length;
  }

  hasUrl(url: string): boolean {
    return this.all.some((r) => r.url === url);
  }

  async loadResponseBody(entry: CapturedRequest): Promise<string | null> {
    const stored = this.findStored(entry);
    if (!stored) return null;
    if (stored.bodyLoaded) return stored.body ?? null;
    stored.bodyLoaded = true;
    return new Promise<string | null>((resolve) => {
      try {
        stored.source.getContent((content) => {
          stored.body = content || null;
          resolve(stored.body);
        });
      } catch {
        stored.body = null;
        resolve(null);
      }
    });
  }

  private findStored(entry: CapturedRequest): StoredRequest | null {
    for (const list of this.groups.values()) {
      for (const r of list) {
        if (r.receivedAt === entry.receivedAt) return r;
      }
    }
    return null;
  }

  async getEntryForUrl(url: string): Promise<NetworkContextEntry | null> {
    const matches = this.all.filter((r) => r.url === url);
    if (matches.length === 0) return null;
    const latest = matches[matches.length - 1];
    const body = await this.loadResponseBody(latest);
    return {
      url: latest.url,
      method: latest.method,
      status: latest.status,
      statusText: latest.statusText,
      mimeType: latest.mimeType,
      requestHeaders: latest.requestHeaders,
      responseHeaders: latest.responseHeaders,
      requestBody: latest.postData ? latest.postData.substring(0, MAX_FOCUS_BODY_LENGTH) : null,
      responseBody: body ? body.substring(0, MAX_FOCUS_BODY_LENGTH) : null,
      duration: latest.totalTime,
      count: matches.length,
    };
  }

  async loadFromHAR(): Promise<void> {
    if (this.groups.size > 0) return;
    try {
      const har = await new Promise<{ entries?: ChromeHarEntry[] }>((resolve) => {
        chrome.devtools.network.getHAR((result) => resolve(result as { entries?: ChromeHarEntry[] }));
      });
      for (const entry of har.entries || []) {
        const req = {
          request: {
            url: entry.request.url,
            method: entry.request.method,
            headers: entry.request.headers || [],
            postData: entry.request.postData,
          },
          response: {
            status: entry.response.status,
            statusText: entry.response.statusText || '',
            content: { mimeType: entry.response.content?.mimeType || '' },
            headers: entry.response.headers || [],
          },
          time: entry.time || 0,
          startedDateTime: entry.startedDateTime,
          connection: entry.connection,
          _connectionId: entry._connectionId,
          serverIPAddress: entry.serverIPAddress,
          timings: entry.timings,
          getContent: () => {},
        } as unknown as ChromeRequest;
        this.pushBackdated(req);
      }
      this.trimAll();
    } catch {
      /* HAR unavailable */
    }
  }

  private pushBackdated(request: ChromeRequest) {
    const entry: StoredRequest = {
      ...toCaptured(request, ++this.clock),
      source: request,
      bodyLoaded: true,
      body: null,
    };
    const list = this.groups.get(entry.key) || [];
    list.push(entry);
    if (list.length > this.maxPerGroup) list.shift();
    this.groups.set(entry.key, list);
  }

  private trimAll() {
    const all = this.all;
    if (all.length <= MAX_NETWORK_ENTRIES * 3) return;
    const keep = Array.from(this.groups.values())
      .flat()
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, MAX_NETWORK_ENTRIES * 3);
    const keepSet = new Set(keep);
    for (const [key, list] of this.groups) {
      const filtered = list.filter((r) => keepSet.has(r));
      if (filtered.length === 0) this.groups.delete(key);
      else this.groups.set(key, filtered);
    }
  }

  async getSelectedContext(): Promise<NetworkContextEntry[]> {
    const filtered = this.all.filter((r) => !isStaticResource(r.mimeType));

    const byUrl = new Map<string, StoredRequest[]>();
    for (const r of filtered) {
      const list = byUrl.get(r.key) || [];
      list.push(r);
      byUrl.set(r.key, list);
    }

    const capped = Array.from(byUrl.values()).slice(-MAX_NETWORK_ENTRIES);

    const entries: NetworkContextEntry[] = [];
    for (const list of capped) {
      const latest = list[list.length - 1];
      const isError = latest.status >= 400;
      let body: string | null = null;
      if (isError) {
        try {
          body = await this.loadResponseBody(latest);
        } catch {
          body = null;
        }
      }

      entries.push({
        url: latest.url,
        method: latest.method,
        status: latest.status,
        statusText: latest.statusText,
        mimeType: latest.mimeType,
        requestHeaders: isError ? latest.requestHeaders : [],
        responseHeaders: isError ? latest.responseHeaders : [],
        requestBody:
          isError && latest.postData
            ? latest.postData.substring(0, MAX_RESPONSE_BODY_LENGTH)
            : null,
        responseBody: body ? body.substring(0, MAX_RESPONSE_BODY_LENGTH) : null,
        duration: latest.totalTime,
        count: list.length,
      });
    }

    return entries;
  }

  getDuplicateGroups(countThreshold = 1): { key: string; requests: CapturedRequest[] }[] {
    const result: { key: string; requests: CapturedRequest[] }[] = [];
    for (const [key, list] of this.groups) {
      if (list.length > countThreshold) {
        result.push({ key, requests: [...list] });
      }
    }
    return result;
  }

  getAll(): CapturedRequest[] {
    return this.all.map((r) => ({ ...r }));
  }

  getAllNonStatic(): CapturedRequest[] {
    return this.all.filter((r) => !isStaticResource(r.mimeType));
  }

  getApiRequests(): CapturedRequest[] {
    const json = this.all.filter(
      (r) =>
        !isStaticResource(r.mimeType) &&
        (r.mimeType.includes('json') ||
          r.mimeType.startsWith('text/plain') ||
          r.mimeType === '' ||
          r.method !== 'GET')
    );
    const seen = new Set<string>();
    const out: CapturedRequest[] = [];
    for (const r of json.slice(-400)) {
      const k = `${r.method} ${r.url.split('?')[0]}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(r);
      }
    }
    return out.slice(-120);
  }

  hasMutatingNoAuth(): boolean {
    return this.getAll().some((r) => MUTATING_METHODS.has(r.method));
  }

  static isMutating(method: string): boolean {
    return MUTATING_METHODS.has(method);
  }
}