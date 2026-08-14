import type Anthropic from '@anthropic-ai/sdk';

const MAX_VALIDATION_RETRIES = 2;

type ParseableFormat<ParsedT> = Anthropic.Messages.JSONOutputFormat & { parse(content: string): ParsedT };

/**
 * client.messages.parse() throws when the model's JSON doesn't satisfy Zod refinements like
 * .min(1)/.min(3) — Anthropic's structured-output constrained decoding strips those into
 * description hints rather than hard constraints, so the SDK's post-hoc .parse() is what
 * actually catches violations, and it throws instead of giving the run a chance to recover
 * (seen in a live backtest run: bull/bear returning keyFactors with <3 items and an invalid
 * conviction value). This wraps client.messages.create() directly (not .parse(), which would
 * discard the raw response on failure) so a validation failure can be fed back to the model —
 * the invalid response plus the error — as a follow-up turn, bounded to MAX_VALIDATION_RETRIES
 * attempts before giving up and throwing.
 */
export async function parseWithRetry<ParsedT>(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming & { output_config: { format: ParseableFormat<ParsedT> } },
  requestOptions: Anthropic.RequestOptions,
  onAttempt?: (response: Anthropic.Message) => void | Promise<void>,
): Promise<{ response: Anthropic.Message; parsedOutput: ParsedT }> {
  let messages: Anthropic.Messages.MessageParam[] = [...params.messages];

  for (let attempt = 0; ; attempt++) {
    const response = await client.messages.create({ ...params, messages }, requestOptions);
    await onAttempt?.(response);

    // findLast, not find: server-side web_search keeps the turn alive after each search, so the
    // model can write a complete answer, search again, and rewrite it — leaving several full JSON
    // drafts in one response. Only the last one reflects every search it ran. Taking the first
    // fed the judge a pre-final draft on 44 of 244 bull/bear calls before this was caught.
    const textBlock = response.content.findLast((block): block is Anthropic.TextBlock => block.type === 'text');
    if (!textBlock) {
      // Distinguish truncation from a genuinely malformed response. Both surface here as "no
      // text block", but they need opposite fixes, and the 2026-08-13 research_failed pair read
      // as a parse bug for a day before anyone checked stop_reason. Name the budget instead.
      if (response.stop_reason === 'max_tokens') {
        throw new Error(
          `Response hit max_tokens (${params.max_tokens}) before emitting any text — thinking and tool-result blocks consumed the whole budget (${response.usage.output_tokens} output tokens). Raise max_tokens or lower the thinking budget / search count.`
        );
      }
      throw new Error(`No text content block in response to parse (stop_reason: ${response.stop_reason})`);
    }

    try {
      return { response, parsedOutput: params.output_config.format.parse(textBlock.text) };
    } catch (error) {
      if (attempt >= MAX_VALIDATION_RETRIES) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Structured output failed validation (attempt ${attempt + 1}/${MAX_VALIDATION_RETRIES + 1}), retrying:`, message);
      messages = [
        ...messages,
        // Echo the whole content array, not just the text: with thinking enabled the
        // assistant turn carries signed thinking blocks that must be replayed unmodified.
        { role: 'assistant', content: response.content },
        { role: 'user', content: `That response did not satisfy the required schema:\n${message}\n\nRespond again with valid output that satisfies the schema.` },
      ];
    }
  }
}
