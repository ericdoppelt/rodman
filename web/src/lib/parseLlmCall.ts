import type { LlmCall } from '../types';

interface AnthropicCitation {
  url?: string;
  title?: string;
  cited_text?: string;
}

interface AnthropicSearchResult {
  type?: string;
  url?: string;
  title?: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  citations?: AnthropicCitation[];
  // server_tool_use
  id?: string;
  input?: { query?: string };
  // web_search_tool_result — `content` is a list of results, or an error object
  tool_use_id?: string;
  content?: AnthropicSearchResult[] | { error_code?: string };
}

export interface SearchResult {
  url: string;
  title: string;
  host: string;
}

/** One `web_search` call: the query the model chose, and what came back. */
export interface SearchGroup {
  query: string;
  results: SearchResult[];
  errorCode: string | null;
}

export interface MarketContextSource {
  url: string;
  title: string;
}

/** One run of prose plus the 1-based source numbers backing it (empty when uncited). */
export interface MarketContextSegment {
  text: string;
  sourceNumbers: number[];
}

export interface ParsedMarketContext {
  segments: MarketContextSegment[];
  sources: MarketContextSource[];
}

export interface ParsedAnalysis {
  reasoning: string;
  keyFactors: string[];
  conviction: 'strong' | 'moderate' | 'weak';
}

export interface ParsedJudgePick {
  ticker: string;
  reasoning: string;
}

function textBlocks(rawResponse: unknown): string[] {
  const content = (rawResponse as { content?: AnthropicContentBlock[] } | null)?.content ?? [];
  return content
    .filter((block): block is AnthropicContentBlock & { text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text);
}

// The last text block, matching parseWithRetry.ts — a response that searched again after
// drafting an answer holds several complete drafts, and only the final one is what the
// pipeline parsed and acted on.
function extractText(rawResponse: unknown): string {
  return textBlocks(rawResponse).at(-1) ?? '';
}

// Market context is free-form prose that a web_search response splits into one text block
// per citation span, plus bare whitespace blocks for the gaps between them. Concatenating
// every block in order reproduces the summary exactly — that's what fetchMarketContext.ts
// hands the research step. Here the blocks stay separate so each cited span can link to the
// source backing it. Sources are deduped by URL so a repeated source keeps one number.
export function parseMarketContext(call: LlmCall): ParsedMarketContext {
  const content = (call.raw_response as { content?: AnthropicContentBlock[] } | null)?.content ?? [];
  const sources: MarketContextSource[] = [];
  const numberByUrl = new Map<string, number>();
  const segments: MarketContextSegment[] = [];

  for (const block of content) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue;

    const sourceNumbers: number[] = [];
    for (const citation of block.citations ?? []) {
      if (!citation.url) continue;
      let n = numberByUrl.get(citation.url);
      if (n === undefined) {
        n = sources.length + 1;
        numberByUrl.set(citation.url, n);
        sources.push({ url: citation.url, title: citation.title || citation.url });
      }
      if (!sourceNumbers.includes(n)) sourceNumbers.push(n);
    }

    segments.push({ text: block.text, sourceNumbers });
  }

  return { segments, sources };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Bull/bear can't carry citations — their only text block is a schema-constrained JSON
// object, and a citation is a split of prose into separate blocks, which would leave each
// piece invalid JSON. The evidence is still in the response though: every `web_search`
// emits a `server_tool_use` block holding the query, paired by id with a
// `web_search_tool_result` block holding what came back. Pairing them recovers what the
// agent actually read, with no per-claim attribution.
export function parseSearches(call: LlmCall): SearchGroup[] {
  const content = (call.raw_response as { content?: AnthropicContentBlock[] } | null)?.content ?? [];

  const queryById = new Map<string, string>();
  for (const block of content) {
    if (block.type === 'server_tool_use' && block.id) {
      queryById.set(block.id, block.input?.query ?? '');
    }
  }

  const groups: SearchGroup[] = [];
  for (const block of content) {
    if (block.type !== 'web_search_tool_result') continue;
    const query = (block.tool_use_id && queryById.get(block.tool_use_id)) || '';

    if (!Array.isArray(block.content)) {
      groups.push({ query, results: [], errorCode: block.content?.error_code ?? 'unknown_error' });
      continue;
    }

    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const result of block.content) {
      if (!result.url || seen.has(result.url)) continue;
      seen.add(result.url);
      results.push({ url: result.url, title: result.title || result.url, host: hostOf(result.url) });
    }
    groups.push({ query, results, errorCode: null });
  }

  return groups;
}

export function parseAnalysis(call: LlmCall): ParsedAnalysis | null {
  try {
    return JSON.parse(extractText(call.raw_response)) as ParsedAnalysis;
  } catch {
    return null;
  }
}

export function parseJudgePicks(call: LlmCall): ParsedJudgePick[] {
  try {
    return JSON.parse(extractText(call.raw_response)) as ParsedJudgePick[];
  } catch {
    return [];
  }
}
