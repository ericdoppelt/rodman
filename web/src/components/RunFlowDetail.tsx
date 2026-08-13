import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { parseAnalysis, parseJudgeOutput, parseMarketContext, parseSearches } from '../lib/parseLlmCall';
import type { LlmCall, RunFlow } from '../types';
import { PulseLoader } from './PulseLoader';

const PRE_RESEARCH_REASONS = new Set(['below_min_market_cap', 'no_market_cap_data']);

/**
 * Bull/bear analyses can't carry inline citations (their only text block is schema-constrained
 * JSON), but the searches behind them are stored on the response. This shows what the agent
 * actually read — including searches the budget refused, which is the signal that the ticker
 * was researched on thinner evidence than the model wanted.
 */
function SearchSources({ call }: { call: LlmCall }) {
  const groups = parseSearches(call);
  const resultCount = groups.reduce((n, g) => n + g.results.length, 0);
  if (resultCount === 0) return null;

  return (
    <details className="flow-search">
      {/* Header stays a plain count — a capped search is normal cost control, not a fault,
          and shouldn't read as one at a glance. The detail is inside for anyone who opens it. */}
      <summary>Sources consulted ({resultCount})</summary>
      {groups.map((group, i) => (
        <div key={i} className="flow-search-group">
          <p className="flow-search-query">{group.query || '(query not recorded)'}</p>
          {group.errorCode ? (
            <p className="flow-search-error">
              {group.errorCode === 'max_uses_exceeded' ? 'not run — search budget reached' : `not run — ${group.errorCode.replaceAll('_', ' ')}`}
            </p>
          ) : (
            <ul>
              {group.results.map(result => (
                <li key={result.url}>
                  <a href={result.url} target="_blank" rel="noreferrer noopener">{result.title}</a>
                  <span className="flow-search-host">{result.host}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </details>
  );
}

interface Props {
  runId: string;
}

export function RunFlowDetail({ runId }: Props) {
  const [run, setRun] = useState<RunFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    supabase
      .from('runs')
      .select(
        'id, run_date, total_cost_usd, no_pick_reason, no_pick_reason_backfilled_at, reconstructed_at, picks(id, run_id, ticker, reasoning, entry_price, created_at), llm_calls(id, run_id, call_type, ticker, model, raw_response, cost_usd, latency_ms, created_at), rejected_candidates(id, run_id, ticker, reason, details, created_at)'
      )
      .eq('id', runId)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else {
          setRun(data as unknown as RunFlow);
        }
        setLoading(false);
      });
  }, [runId]);

  if (loading) {
    return (
      <div className="flow-inline-loading">
        <PulseLoader />
      </div>
    );
  }

  if (error || !run) {
    return <p className="error">Failed to load process: {error ?? 'not found'}</p>;
  }

  const marketContextCall = run.llm_calls.find(c => c.call_type === 'market_context');
  const marketContext = marketContextCall ? parseMarketContext(marketContextCall) : null;
  const judgeCall = run.llm_calls.find(c => c.call_type === 'judge');
  const bullCalls = run.llm_calls.filter(c => c.call_type === 'bull');
  const bearCalls = run.llm_calls.filter(c => c.call_type === 'bear');

  const researchedTickers = [...new Set([...bullCalls.map(c => c.ticker), ...bearCalls.map(c => c.ticker)])].filter(
    (t): t is string => t != null
  );
  const pickedTickers = new Set(run.picks.map(p => p.ticker));
  const judgeOutput = judgeCall ? parseJudgeOutput(judgeCall) : null;
  const judgePicks = judgeOutput?.picks ?? [];
  // Backfilled runs carry the reason on `runs`; live runs carry it in the judge's own response.
  const noPickReason = run.no_pick_reason ?? judgeOutput?.noPickReason ?? null;

  const preResearchRejects = run.rejected_candidates.filter(r => PRE_RESEARCH_REASONS.has(r.reason));
  const researchFailedRejects = run.rejected_candidates.filter(r => r.reason === 'research_failed');

  return (
    <div className="flow-steps">
      <section className="flow-step">
        <h2>Market context</h2>
        <div className="flow-card">
          {marketContext ? (
            <>
              <p className="flow-context-text">
                {marketContext.segments.map((segment, i) => (
                  <span key={i}>
                    {segment.text}
                    {segment.sourceNumbers.map(n => (
                      <sup key={n} className="flow-cite">
                        <a
                          href={marketContext.sources[n - 1].url}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={marketContext.sources[n - 1].title}
                        >
                          {n}
                        </a>
                      </sup>
                    ))}
                  </span>
                ))}
              </p>
              {marketContext.sources.length > 0 && (
                <ol className="flow-sources">
                  {marketContext.sources.map(source => (
                    <li key={source.url}>
                      <a href={source.url} target="_blank" rel="noreferrer noopener">
                        {source.title}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : (
            <p className="flow-context-text">Not recorded for this run.</p>
          )}
          {marketContextCall && (
            <p className="flow-meta">
              {marketContextCall.model} · {(marketContextCall.latency_ms / 1000).toFixed(1)}s · ${marketContextCall.cost_usd.toFixed(4)}
            </p>
          )}
        </div>
      </section>

      {preResearchRejects.length > 0 && (
        <section className="flow-step">
          <h2>Filtered before research</h2>
          <ul className="flow-chip-list">
            {preResearchRejects.map(r => (
              <li key={r.id} className="flow-chip" title={JSON.stringify(r.details)}>
                <span className="ticker">{r.ticker}</span>
                <span className="flow-chip-reason">{r.reason.replaceAll('_', ' ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flow-step">
        <h2>Candidates researched</h2>
        {researchedTickers.length === 0 && researchFailedRejects.length === 0 ? (
          <p className="no-pick">No candidates were researched this day.</p>
        ) : (
          <div className="flow-candidates">
            {researchedTickers.map(ticker => {
              const bull = bullCalls.find(c => c.ticker === ticker);
              const bear = bearCalls.find(c => c.ticker === ticker);
              const bullAnalysis = bull ? parseAnalysis(bull) : null;
              const bearAnalysis = bear ? parseAnalysis(bear) : null;
              const picked = pickedTickers.has(ticker);

              return (
                <div key={ticker} className={`flow-candidate${picked ? ' flow-candidate--picked' : ''}`}>
                  <div className="flow-candidate-header">
                    <span className="ticker">{ticker}</span>
                    {picked && <span className="flow-picked-badge">Picked</span>}
                  </div>
                  <div className="flow-cases">
                    <div className="flow-case flow-case--bull">
                      <div className="flow-case-head">
                        <span>Bull</span>
                        {bullAnalysis && <span className={`conviction conviction--${bullAnalysis.conviction}`}>{bullAnalysis.conviction}</span>}
                      </div>
                      {bullAnalysis ? (
                        <>
                          <p>{bullAnalysis.reasoning}</p>
                          <ul>
                            {bullAnalysis.keyFactors.map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p className="flow-case-missing">Not recorded.</p>
                      )}
                      {bull && <SearchSources call={bull} />}
                      {bull && (
                        <p className="flow-meta">
                          {bull.model} · {(bull.latency_ms / 1000).toFixed(1)}s · ${bull.cost_usd.toFixed(4)}
                        </p>
                      )}
                    </div>
                    <div className="flow-case flow-case--bear">
                      <div className="flow-case-head">
                        <span>Bear</span>
                        {bearAnalysis && <span className={`conviction conviction--${bearAnalysis.conviction}`}>{bearAnalysis.conviction}</span>}
                      </div>
                      {bearAnalysis ? (
                        <>
                          <p>{bearAnalysis.reasoning}</p>
                          <ul>
                            {bearAnalysis.keyFactors.map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p className="flow-case-missing">Not recorded.</p>
                      )}
                      {bear && <SearchSources call={bear} />}
                      {bear && (
                        <p className="flow-meta">
                          {bear.model} · {(bear.latency_ms / 1000).toFixed(1)}s · ${bear.cost_usd.toFixed(4)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {researchFailedRejects.map(r => (
              <div key={r.id} className="flow-candidate flow-candidate--failed">
                <div className="flow-candidate-header">
                  <span className="ticker">{r.ticker}</span>
                  <span className="flow-picked-badge flow-picked-badge--failed">Research failed</span>
                </div>
                <p className="flow-case-missing">{typeof r.details?.error === 'string' ? r.details.error : 'Research could not be completed.'}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flow-step">
        <h2>Judge</h2>
        <div className="flow-card">
          {judgePicks.length === 0 ? (
            noPickReason ? (
              <>
                <p className="no-pick no-pick--explained">{noPickReason}</p>
                {run.no_pick_reason_backfilled_at && (
                  <p className="flow-reconstructed">
                    Reconstructed after the fact — this run predates the judge recording its reason,
                    so this explains the decision rather than being what was written that day.
                  </p>
                )}
              </>
            ) : (
              <p className="no-pick">No stock met the bar for a recommendation this day.</p>
            )
          ) : (
            <ul className="flow-judge-list">
              {judgePicks.map(p => (
                <li key={p.ticker}>
                  <span className="ticker">{p.ticker}</span>
                  <p className="reasoning">{p.reasoning}</p>
                </li>
              ))}
            </ul>
          )}
          {judgeCall && <p className="flow-meta">{judgeCall.model} · {(judgeCall.latency_ms / 1000).toFixed(1)}s · ${judgeCall.cost_usd.toFixed(4)}</p>}
        </div>
      </section>
    </div>
  );
}
