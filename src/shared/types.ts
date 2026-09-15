export interface AIConfig {
  apiEndpoint: string;
  apiKey: string;
  modelName: string;
  systemPrompt: string;
  temperature: number;
}

export interface RequestTimings {
  blocked?: number;
  dns?: number;
  connect?: number;
  send?: number;
  wait?: number;
  receive?: number;
  ssl?: number;
}

export interface CapturedRequest {
  key: string;
  url: string;
  method: string;
  status: number;
  statusText: string;
  mimeType: string;
  requestHeaders: { name: string; value: string }[];
  responseHeaders: { name: string; value: string }[];
  postData: string | null;
  startTime: string;
  totalTime: number;
  timings: RequestTimings;
  connection?: string;
  serverIP?: string;
  receivedAt: number;
}

export interface NetworkContextEntry {
  url: string;
  method: string;
  status: number;
  statusText: string;
  mimeType: string;
  requestHeaders: { name: string; value: string }[];
  responseHeaders: { name: string; value: string }[];
  requestBody: string | null;
  responseBody: string | null;
  duration: number;
  count: number;
}

export interface ConsoleMessage {
  level: 'log' | 'error' | 'warn' | 'info' | 'debug';
  message: string;
  timestamp: string;
  stack?: string;
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
  analysis?: AnalysisContext;
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

export interface JsonDiffEntry {
  path: string;
  from?: string;
  to?: string;
}

export interface JsonDiffResult {
  same: boolean;
  absolutePath?: string;
  addedValues: number;
  removedValues: number;
  added: JsonDiffEntry[];
  removed: JsonDiffEntry[];
  changed: JsonDiffEntry[];
  truncated: boolean;
  error?: string;
}

export type SensitiveType =
  | 'aws_key'
  | 'private_key'
  | 'generic_secret'
  | 'jwt'
  | 'internal_ip'
  | 'phone'
  | 'idcard'
  | 'email';

export interface SensitiveHit {
  url: string;
  type: SensitiveType;
  location: 'url' | 'responseBody' | 'requestBody' | 'authorization';
  sample: string;
  context: string;
}

export interface AuthAuditEntry {
  url: string;
  method: string;
  hasAuth: boolean;
  sensitive: boolean;
  bodySent: boolean;
}

export interface SecurityHeaderIssue {
  url: string;
  missing: ('csp' | 'hsts' | 'xfo' | 'xcto')[];
}

export interface JwtInfo {
  token: string;
  source: string;
  exp?: number;
  iat?: number;
  claims: Record<string, unknown>;
  parseError?: string;
}

export interface AttackSurfaceEntry {
  pattern: string;
  methods: string[];
  paths: string[];
  queryParams: string[];
  hasAuth: boolean;
}

export interface WaterfallRequest {
  url: string;
  method: string;
  status: number;
  mimeType: string;
  startTime: string;
  totalTime: number;
  timings: RequestTimings;
  connection?: string;
}

export interface AnalysisContext {
  diff?: JsonDiffResult;
  sensitive?: SensitiveHit[];
  authAudit?: AuthAuditEntry[];
  securityHeaders?: SecurityHeaderIssue[];
  attackSurface?: AttackSurfaceEntry[];
  waterfall?: WaterfallRequest[];
}
