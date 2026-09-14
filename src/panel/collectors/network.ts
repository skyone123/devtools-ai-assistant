import { MAX_RESPONSE_BODY_LENGTH } from '../../shared/constants.js';
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
    return this.requests.length;
  }

  private getTargetRequests(): ChromeRequest[] {
    const errorEntries = this.requests.filter((r) => r.response.status >= 400);
    const target = errorEntries.length > 0 ? errorEntries : this.requests;
    return target.slice(-3);
  }

  async getSelectedContext(): Promise<NetworkContextEntry[]> {
    const targets = this.getTargetRequests();
    if (targets.length === 0) return [];

    const entries = await Promise.all(
      targets.map(async (req): Promise<NetworkContextEntry> => {
        const body = await new Promise<string | null>((resolve) => {
          req.getContent((content) => {
            resolve(content || null);
          });
        });

        return {
          url: req.request.url,
          method: req.request.method,
          status: req.response.status,
          statusText: req.response.statusText,
          mimeType: req.response.content.mimeType,
          requestHeaders: req.request.headers || [],
          responseHeaders: req.response.headers || [],
          responseBody: body ? body.substring(0, MAX_RESPONSE_BODY_LENGTH) : null,
          duration: req.time || 0,
        };
      })
    );

    return entries;
  }
}
