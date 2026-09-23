// A plain-fetch client for TypeSafe's Jev (System One). Jev does not generate
// text: it takes a state plus typed questions — `choice` picks one of N labels,
// `noul` returns P(yes) — and answers with probabilities in a few hundred ms.
//
// Two transports, one result shape: TypeSafe's API (TYPESAFE_API_KEY) and the
// Vercel AI Gateway (AI_GATEWAY_API_KEY, model `typesafe-ai/jev`), which speaks
// a slightly different dialect (model id in a header, `noul` called `boolean`).
//
// Answers are validated strictly: the probability keys must equal the offered
// labels, sum to 1 (±0.03), and the chosen label must be the argmax. Anything
// else is a failure — never repaired, never acted on. The client never throws
// for provider failures; every call resolves to a JevResult.

export type JevEntry = string | number | boolean | null | JevEntry[] | { [k: string]: JevEntry };

export type JevQuestion =
  | { type: 'choice'; instructions: JevEntry; criteria: Record<string, JevEntry> }
  | { type: 'noul'; instructions: JevEntry };

export type ChoiceAnswer = {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type NoulAnswer = { type: 'noul'; noul: number };
export type JevAnswer = ChoiceAnswer | NoulAnswer;

export type JevResult =
  | { ok: true; answers: Record<string, JevAnswer>; ms: number; model: string }
  | { ok: false; reason: string; ms: number };

export type JevProvider = 'typesafe' | 'vercel';

export type JevClientOptions = {
  provider?: JevProvider;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  /** Per-attempt timeout (default 10s). */
  timeoutMs?: number;
  /** Retries on 408/429/5xx and network errors (default 2). */
  maxRetries?: number;
  fetch?: FetchLike;
};

/** The subset of fetch the client uses — easy to script in tests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type JevClient = {
  readonly model: string;
  readonly provider: JevProvider;
  ask(
    state: JevEntry,
    questions: Record<string, JevQuestion>,
    opts?: { signal?: AbortSignal | undefined },
  ): Promise<JevResult>;
};

export const choice = (instructions: JevEntry, criteria: Record<string, JevEntry>): JevQuestion => ({
  type: 'choice',
  instructions,
  criteria,
});
export const noul = (instructions: JevEntry): JevQuestion => ({ type: 'noul', instructions });

/** Which transport the environment selects: an explicit JEV_PROVIDER, else the first key present. */
export function jevProvider(env: Record<string, string | undefined> = process.env): JevProvider {
  if (env.JEV_PROVIDER === 'typesafe' || env.JEV_PROVIDER === 'vercel') return env.JEV_PROVIDER;
  return !env.TYPESAFE_API_KEY && env.AI_GATEWAY_API_KEY ? 'vercel' : 'typesafe';
}

const ENDPOINTS: Record<JevProvider, { base: string; path: string; model: string; key: string }> = {
  typesafe: { base: 'https://api.typesafe.ai', path: '/v1/systemone', model: 'jev-latest', key: 'TYPESAFE_API_KEY' },
  vercel: {
    base: 'https://ai-gateway.vercel.sh',
    path: '/v4/ai/evaluation-model',
    model: 'typesafe-ai/jev',
    key: 'AI_GATEWAY_API_KEY',
  },
};

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);
const PROB_TOLERANCE = 0.03;

export function createJevClient(opts: JevClientOptions = {}, env = process.env): JevClient {
  const provider = opts.provider ?? jevProvider(env);
  const ep = ENDPOINTS[provider];
  const apiKey = opts.apiKey ?? env[ep.key];
  const baseURL = (opts.baseURL ?? env[`${ep.key.replace('_API_KEY', '')}_BASE_URL`] ?? ep.base).replace(/\/+$/, '');
  const model = opts.model ?? env.JEV_MODEL ?? ep.model;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRetries = opts.maxRetries ?? 2;
  const doFetch: FetchLike = opts.fetch ?? fetch;

  async function ask(
    state: JevEntry,
    questions: Record<string, JevQuestion>,
    callOpts: { signal?: AbortSignal | undefined } = {},
  ): Promise<JevResult> {
    const start = performance.now();
    const elapsed = () => Math.round(performance.now() - start);
    if (!apiKey) return { ok: false, reason: `${ep.key} is not set`, ms: 0 };
    for (const [id, q] of Object.entries(questions)) {
      if (q.type === 'choice' && Object.keys(q.criteria).length < 2)
        return { ok: false, reason: `choice "${id}" needs ≥2 options`, ms: 0 };
    }
    const body = JSON.stringify(
      provider === 'vercel' ? { state, questions: toGatewayQuestions(questions) } : { model, state, questions },
    );
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (provider === 'vercel') {
      headers['ai-gateway-protocol-version'] = '0.0.1';
      headers['ai-evaluation-model-specification-version'] = '4';
      headers['ai-model-id'] = model;
    }
    let lastError = 'no attempt made';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (callOpts.signal?.aborted) return { ok: false, reason: 'aborted', ms: elapsed() };
      if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** (attempt - 1), 5000)));
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = callOpts.signal ? AbortSignal.any([callOpts.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await doFetch(`${baseURL}${ep.path}`, { method: 'POST', headers, body, signal });
      } catch (error) {
        if (callOpts.signal?.aborted) return { ok: false, reason: 'aborted', ms: elapsed() };
        lastError = `network: ${error instanceof Error ? error.message : String(error)}`;
        continue;
      }
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        lastError = `HTTP ${res.status}${detail ? `: ${detail}` : ''}`;
        if (RETRY_STATUS.has(res.status)) continue;
        return { ok: false, reason: lastError, ms: elapsed() };
      }
      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        return { ok: false, reason: 'response was not JSON', ms: elapsed() };
      }
      const parsed = parseAnswers(provider === 'vercel' ? fromGateway(payload) : payload, questions);
      if (typeof parsed === 'string') return { ok: false, reason: parsed, ms: elapsed() };
      const served = (payload as { model?: unknown }).model;
      return { ok: true, answers: parsed, ms: elapsed(), model: typeof served === 'string' ? served : model };
    }
    return { ok: false, reason: lastError, ms: elapsed() };
  }

  return { model, provider, ask };
}

/** Native → gateway dialect: `noul` is called `boolean` there. */
function toGatewayQuestions(questions: Record<string, JevQuestion>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(questions).map(([id, q]) => [id, q.type === 'noul' ? { ...q, type: 'boolean' } : q]),
  );
}

/**
 * Gateway → native shape, so one validator covers both transports. The
 * confidence head arrives out-of-band (providerMetadata.typesafe.confidence);
 * when absent it is ESTIMATED as top-minus-runner-up, which reads at or below
 * the real head — a missing head can only make the agent more cautious.
 */
export function fromGateway(payload: unknown): unknown {
  const p = payload as {
    answers?: Record<string, Record<string, unknown>>;
    providerMetadata?: { typesafe?: { confidence?: Record<string, unknown> } };
    model?: unknown;
  } | null;
  if (!p?.answers || typeof p.answers !== 'object') return payload;
  const heads = p.providerMetadata?.typesafe?.confidence ?? {};
  const answers: Record<string, unknown> = {};
  for (const [id, a] of Object.entries(p.answers)) {
    if (a?.type === 'boolean') {
      answers[id] = { type: 'noul', noul: a.probability };
      continue;
    }
    const head = heads[id];
    answers[id] = { ...a, confidence: typeof head === 'number' ? head : margin(a?.probabilities) };
  }
  return { model: p.model, answers };
}

function margin(probs: unknown): number | undefined {
  if (!probs || typeof probs !== 'object') return undefined;
  const v = Object.values(probs as Record<string, unknown>)
    .filter((x): x is number => typeof x === 'number')
    .sort((a, b) => b - a);
  return v.length ? Math.max(0, (v[0] ?? 0) - (v[1] ?? 0)) : undefined;
}

const unit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

/** Validate a response against the questions asked. Returns a reason string on failure. */
export function parseAnswers(
  payload: unknown,
  questions: Record<string, JevQuestion>,
): Record<string, JevAnswer> | string {
  const answers = (payload as { answers?: unknown } | null)?.answers;
  if (!answers || typeof answers !== 'object') return 'response has no answers';
  const raw = answers as Record<string, Record<string, unknown> | undefined>;
  const out: Record<string, JevAnswer> = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = raw[id];
    if (!a) return `no answer for "${id}"`;
    if (q.type === 'noul') {
      if (!unit(a.noul)) return `noul "${id}" out of range`;
      out[id] = { type: 'noul', noul: a.noul };
      continue;
    }
    const labels = Object.keys(q.criteria);
    const picked = a.choice;
    if (typeof picked !== 'string' || !labels.includes(picked)) return `choice "${id}" picked an unoffered label`;
    if (!unit(a.confidence)) return `choice "${id}" has no valid confidence`;
    const probs = a.probabilities;
    if (!probs || typeof probs !== 'object') return `choice "${id}": missing probabilities`;
    const p = probs as Record<string, unknown>;
    if (Object.keys(p).length !== labels.length || !labels.every((l) => l in p))
      return `choice "${id}": probability keys ≠ options`;
    let sum = 0;
    let best = -1;
    for (const l of labels) {
      const v = p[l];
      if (!unit(v)) return `choice "${id}": probability for "${l}" out of range`;
      sum += v;
      best = Math.max(best, v);
    }
    if (Math.abs(sum - 1) > PROB_TOLERANCE) return `choice "${id}": probabilities sum to ${sum.toFixed(3)}`;
    if ((p[picked] as number) < best - 1e-9) return `choice "${id}": "${picked}" is not the most probable option`;
    out[id] = { type: 'choice', choice: picked, confidence: a.confidence, probabilities: p as Record<string, number> };
  }
  return out;
}
