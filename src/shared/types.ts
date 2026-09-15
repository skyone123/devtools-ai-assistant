export interface AIConfig {
  apiEndpoint: string;
  apiKey: string;
  modelName: string;
  systemPrompt: string;
  temperature: number;
}

export interface NetworkContextEntry {
  url: string;
  method: string;
  status: number;
  statusText: string;
  mimeType: string;
  requestHeaders: { name: string; value: string }[];
  responseHeaders: { name: string; value: string }[];
  responseBody: string | null;
  duration: number;
  count: number;
}

export interface ConsoleMessage {
  level: 'log' | 'error' | 'warn' | 'info' | 'debug';
  message: string;
  timestamp: string;
}

export interface DomContext {
  url: string;
  title: string;
  selectedHtml: string;
  computedStyles: string;
}

export type ContextSource = 'network' | 'console' | 'dom';

export interface CollectedContext {
  network?: NetworkContextEntry[];
  console?: ConsoleMessage[];
  dom?: DomContext;
  focusEntry?: NetworkContextEntry;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export type PortMessage =
  | { type: 'ask'; context: CollectedContext; question: string; history: ConversationMessage[] }
  | { type: 'abort' }
  | { type: 'chunk'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type PanelToBgMessage = PortMessage;
export type BgToPanelMessage =
  | { type: 'chunk'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
