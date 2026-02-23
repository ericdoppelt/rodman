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
  reasoning: z.string(),
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