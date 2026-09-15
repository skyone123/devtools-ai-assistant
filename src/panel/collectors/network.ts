import { MAX_FOCUS_BODY_LENGTH, MAX_NETWORK_ENTRIES, MAX_RESPONSE_BODY_LENGTH } from '../../shared/constants.js';
import type { NetworkContextEntry } from '../../shared/types.js';

type ChromeRequest = {
  request: {
    url: string;
    method: string;
    headers: { name: string; value: string }[];
  };
  response: {
    status: number;
    statusText: string;
    content: { mimeType: string };
    headers: { name: string; value: string }[];
  };
  time: number;
  getContent: (cb: (content: string, encoding?: string) => void) => void;
};

type ChromeHarEntry = {
  request: { url: string; method: string; headers?: { name: string; value: string }[] };
  response: {
    status: number;
    statusText?: string;
    content?: { mimeType?: string };
    headers?: { name: string; value: string }[];
  };
  time?: number;
};

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

function isStaticResource(mimeType: string): boolean {
  const lower = (mimeType || '').toLowerCase();
  if (!lower) return false;
  return STATIC_MIME_PREFIXES.some((p) => lower.startsWith(p) || lower.includes(p));
}

export class NetworkCollector {
  private requests: ChromeRequest[] = [];
  private maxEntries = 100;

  constructor() {
    chrome.devtools.network.onRequestFinished.addListener((request: ChromeRequest) => {
      this.requests.push(request);
      if (this.requests.length > this.maxEntries) {
        this.requests.shift();
      }
    });
  }

  getErrorCount(): number {
    return this.requests.filter((r) => r.response.status >= 400).length;
  }

  getRequestCount(): number {
    return this.requests.filter((r) => !isStaticResource(r.response.content.mimeType)).length;
  }

  hasUrl(url: string): boolean {
    return this.requests.some((r) => r.request.url === url);
  }

  async getEntryForUrl(url: string): Promise<NetworkContextEntry | null> {
    const matches = this.requests.filter((r) => r.request.url === url);
    if (matches.length === 0) return null;
    const latest = matches[matches.length - 1];
    const body = await new Promise<string | null>((resolve) => {
      latest.getContent((content) => {
        resolve(content || null);
      });
    });
    return {
      url: latest.request.url,
      method: latest.request.method,
      status: latest.response.status,
      statusText: latest.response.statusText,
      mimeType: latest.response.content.mimeType,
      requestHeaders: latest.request.headers || [],
      responseHeaders: latest.response.headers || [],
      responseBody: body ? body.substring(0, MAX_FOCUS_BODY_LENGTH) : null,
      duration: latest.time || 0,
      count: matches.length,
    };
  }

  async loadFromHAR(): Promise<void> {
    if (this.requests.length > 0) return;
    try {
      const har = await new Promise<{ entries?: ChromeHarEntry[] }>((resolve) => {
        chrome.devtools.network.getHAR((result) => resolve(result));
      });
      const entries = har.entries || [];
      for (const entry of entries) {
        this.requests.push({
          request: {
            url: entry.request.url,
            method: entry.request.method,
            headers: entry.request.headers || [],
          },
          response: {
            status: entry.response.status,
            statusText: entry.response.statusText || '',
            content: { mimeType: entry.response.content?.mimeType || '' },
            headers: entry.response.headers || [],
          },
          time: entry.time || 0,
          getContent: (cb: (content: string) => void) => cb(''),
        });
      }
      if (this.requests.length > this.maxEntries) {
        this.requests = this.requests.slice(-this.maxEntries);
      }
    } catch {
      /* HAR unavailable */
    }
  }

  private getTargetRequests(): ChromeRequest[] {
    return this.requests.slice(-MAX_NETWORK_ENTRIES * 3);
  }

  async getSelectedContext(): Promise<NetworkContextEntry[]> {
    const filtered = this.getTargetRequests().filter(
      (r) => !isStaticResource(r.response.content.mimeType)
    );

    const groups = new Map<string, ChromeRequest[]>();
    for (const req of filtered) {
      const key = `${req.request.method} ${req.request.url.split('?')[0]} ${req.response.status}`;
      const list = groups.get(key) || [];
      list.push(req);
      groups.set(key, list);
    }

    const uniqueGroups = Array.from(groups.values());
    const capped = uniqueGroups.slice(-MAX_NETWORK_ENTRIES);

    const entries: NetworkContextEntry[] = [];
    for (const list of capped) {
      const latest = list[list.length - 1];
      const isError = latest.response.status >= 400;
      let body: string | null = null;
      if (isError) {
        body = await new Promise<string | null>((resolve) => {
          latest.getContent((content) => {
            resolve(content || null);
          });
        });
      }

      entries.push({
        url: latest.request.url,
        method: latest.request.method,
        status: latest.response.status,
        statusText: latest.response.statusText,
        mimeType: latest.response.content.mimeType,
        requestHeaders: isError ? (latest.request.headers || []) : [],
        responseHeaders: isError ? (latest.response.headers || []) : [],
        responseBody: body ? body.substring(0, MAX_RESPONSE_BODY_LENGTH) : null,
        duration: latest.time || 0,
        count: list.length,
      });
    }

    return entries;
  }
}
