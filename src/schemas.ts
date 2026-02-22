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
