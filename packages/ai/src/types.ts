import { Type, type Static } from '@sinclair/typebox';

// --- Messages ---

export const MessageRole = Type.Union([
  Type.Literal('user'),
  Type.Literal('assistant'),
  Type.Literal('system'),
]);
export type MessageRole = Static<typeof MessageRole>;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  call_id?: string;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingContent {
  type: 'thinking';
  text: string;
}

export type ContentBlock = TextContent | ToolUseContent | ToolResultContent | ThinkingContent;

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

// --- Tool Definition ---

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// --- Provider ---

export interface StreamEvent {
  type: 'text' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'thinking' | 'done' | 'error' | 'usage' | 'retry';
  text?: string;
  toolUse?: {
    id: string;
    name: string;
    input: string; // partial JSON accumulated
    callId?: string;
  };
  error?: string;
  usage?: TokenUsage;
  /** Seconds to wait before retry. Only present on type='retry'. */
  waitSeconds?: number;
  /** True if the retry-after exceeds the interactive cap and no retry will occur. */
  retryFinal?: boolean;
}

export interface CompletionRequest {
  model: string;
  messages: Message[];
  system?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  thinking?: boolean;
}

export interface CompletionResponse {
  message: Message;
  usage: TokenUsage;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export interface Provider {
  name: string;
  stream(request: CompletionRequest): AsyncIterable<StreamEvent>;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  models(): string[];
}
