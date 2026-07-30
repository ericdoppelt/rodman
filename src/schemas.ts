import { z } from 'zod';

export const stockResultSchema = z.object({
  T: z.string(),
  o: z.number(),
  c: z.number(),
  v: z.number(),
});

export type StockResult = z.infer<typeof stockResultSchema>;

export const apiResponseSchema = z.object({
  status: z.string(),
  count: z.number().optional(),
  resultsCount: z.number().optional(),
  results: z.array(stockResultSchema).optional().default([]),
});

export type ApiResponse = z.infer<typeof apiResponseSchema>;

export const tickerDetailsResponseSchema = z.object({
  results: z.object({
    market_cap: z.number().optional(),
  }),
});

export type TickerDetailsResponse = z.infer<typeof tickerDetailsResponseSchema>;

const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export type TextBlock = z.infer<typeof textBlockSchema>;

const otherBlockSchema = z.object({
  type: z.string(),
}).passthrough();

export const anthropicResponseSchema = z.object({
  content: z.array(z.union([textBlockSchema, otherBlockSchema])),
});

type anthropicResponseSchema = z.infer<typeof anthropicResponseSchema>;

export const stockAnalysisSchema = z.object({
  reasoning: z.string().min(1),
  keyFactors: z.array(z.string()).min(3).max(5),
  conviction: z.enum(['strong', 'moderate', 'weak']),
});

export type StockAnalysis = z.infer<typeof stockAnalysisSchema>;

export const StanceSchema = z.enum(['bull', 'bear']);
export type Stance = z.infer<typeof StanceSchema>;

export const ConvictionSchema = z.enum(['strong', 'moderate', 'weak']);
export type Conviction = z.infer<typeof ConvictionSchema>;

export interface StockChange {
  ticker: string;             // ticker symbol
  open: number;               // open price
  close: number;              // close price
  percentageChange: number;   // drop (percentage)
  volume: number
}

export interface StockResearch {
  stockChange: StockChange;
  bull: StockAnalysis;
  bear: StockAnalysis;
}

export interface RejectedCandidate {
  ticker: string;
  reason: string;
  details?: Record<string, unknown>;
}

export const MAX_PICKS = 1;

export const stockPickSchema = z.array(z.object({
  ticker: z.string().min(1),
  reasoning: z.string().min(1),
})).max(MAX_PICKS);

export type StockPick = z.infer<typeof stockPickSchema>;

// --- Backtest-only schemas ---

export const tickerAggResultSchema = z.object({
  t: z.number(), // bar timestamp (ms)
  o: z.number(),
  c: z.number(),
  h: z.number(),
  l: z.number(),
  v: z.number(),
});

export const tickerRangeAggsResponseSchema = z.object({
  status: z.string(),
  results: z.array(tickerAggResultSchema).optional().default([]),
});

// Generic news-item shape used throughout the backtest, regardless of provider (Tavily).
// Field names (`published_utc`) kept from the original Polygon-backed implementation since
// nothing about them is Polygon-specific and it avoids churn in every call site.
export const newsItemSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  published_utc: z.string(),
  article_url: z.string().optional(),
});

export type NewsItem = z.infer<typeof newsItemSchema>;

export const tavilySearchResultSchema = z.object({
  title: z.string(),
  content: z.string().optional(),
  url: z.string().optional(),
  published_date: z.string().optional(),
});

export const tavilySearchResponseSchema = z.object({
  results: z.array(tavilySearchResultSchema).optional().default([]),
});