import { describe, expect, it } from 'bun:test';
import { choice, createJevClient, fromGateway, jevProvider, noul, parseAnswers } from '../src/jev.ts';

const q = { pick: choice('which?', { '1': 'a', '2': 'b' }), done: noul('done?') };

describe('parseAnswers', () => {
  it('accepts a well-formed response', () => {
    const r = parseAnswers(
      {
        answers: { pick: { choice: '2', confidence: 0.8, probabilities: { '1': 0.2, '2': 0.8 } }, done: { noul: 0.1 } },
      },
      q,
    );
    expect(typeof r).not.toBe('string');
    expect((r as Record<string, { type: string }>).pick?.type).toBe('choice');
  });

  it('rejects an unoffered label, a non-argmax pick, and a distribution that does not sum to 1', () => {
    expect(
      parseAnswers(
        { answers: { pick: { choice: '9', confidence: 1, probabilities: { '1': 0, '2': 1 } }, done: { noul: 0 } } },
        q,
      ),
    ).toContain('unoffered');
    expect(
      parseAnswers(
        { answers: { pick: { choice: '1', confidence: 1, probabilities: { '1': 0.2, '2': 0.8 } }, done: { noul: 0 } } },
        q,
      ),
    ).toContain('not the most probable');
    expect(
      parseAnswers(
        { answers: { pick: { choice: '1', confidence: 1, probabilities: { '1': 0.7, '2': 0.7 } }, done: { noul: 0 } } },
        q,
      ),
    ).toContain('sum to');
    expect(
      parseAnswers(
        { answers: { pick: { choice: '1', confidence: 1, probabilities: { '1': 1 } }, done: { noul: 0 } } },
        q,
      ),
    ).toContain('keys');
    expect(
      parseAnswers(
        { answers: { pick: { choice: '1', confidence: 1, probabilities: { '1': 1, '2': 0 } }, done: { noul: 2 } } },
        q,
      ),
    ).toContain('out of range');
  });
});

describe('gateway dialect', () => {
  it('renames boolean → noul and lifts the confidence head from providerMetadata', () => {
    const native = fromGateway({
      model: 'typesafe-ai/jev',
      answers: {
        pick: { type: 'choice', choice: '1', probabilities: { '1': 0.9, '2': 0.1 } },
        done: { type: 'boolean', probability: 0.3 },
      },
      providerMetadata: { typesafe: { confidence: { pick: 0.95 } } },
    }) as { answers: Record<string, Record<string, unknown>> };
    expect(native.answers.done).toEqual({ type: 'noul', noul: 0.3 });
    expect(native.answers.pick?.confidence).toBe(0.95);
  });

  it('estimates a missing confidence head as the top-minus-runner-up margin', () => {
    const native = fromGateway({
      answers: { pick: { type: 'choice', choice: '1', probabilities: { '1': 0.7, '2': 0.3 } } },
    }) as { answers: Record<string, Record<string, unknown>> };
    expect(native.answers.pick?.confidence).toBeCloseTo(0.4);
  });

  it('selects the transport from the environment', () => {
    expect(jevProvider({ TYPESAFE_API_KEY: 't' })).toBe('typesafe');
    expect(jevProvider({ AI_GATEWAY_API_KEY: 'g' })).toBe('vercel');
    expect(jevProvider({ TYPESAFE_API_KEY: 't', AI_GATEWAY_API_KEY: 'g' })).toBe('typesafe');
    expect(jevProvider({ TYPESAFE_API_KEY: 't', AI_GATEWAY_API_KEY: 'g', JEV_PROVIDER: 'vercel' })).toBe('vercel');
  });
});

describe('client', () => {
  it('never throws: an unset key, an HTTP error, and an invalid body all resolve to ok:false', async () => {
    expect((await createJevClient({}, {}).ask({}, q)).ok).toBe(false);
    const http500 = createJevClient(
      { apiKey: 'k', maxRetries: 0, fetch: async () => new Response('down', { status: 500 }) },
      {},
    );
    const r = await http500.ask({}, q);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain('HTTP 500');
    const bad = createJevClient(
      { apiKey: 'k', fetch: async () => Response.json({ answers: { pick: { choice: 'zzz' } } }) },
      {},
    );
    expect((await bad.ask({}, q)).ok).toBe(false);
  });

  it('retries a 503 and then returns the validated answer', async () => {
    let calls = 0;
    const client = createJevClient(
      {
        apiKey: 'k',
        fetch: async () => {
          calls += 1;
          if (calls === 1) return new Response('busy', { status: 503 });
          return Response.json({
            model: 'jev-1',
            answers: {
              pick: { choice: '1', confidence: 0.9, probabilities: { '1': 0.9, '2': 0.1 } },
              done: { noul: 0.05 },
            },
          });
        },
      },
      {},
    );
    const r = await client.ask({ goal: 'x' }, q);
    expect(calls).toBe(2);
    expect(r.ok && r.model).toBe('jev-1');
  });
});
