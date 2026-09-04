const Anthropic = require('@anthropic-ai/sdk');

// --- Provider setup ---------------------------------------------------
// Priority: Groq (free tier, no card required) -> Anthropic (paid) -> template fallback.
// This means if GROQ_API_KEY is set, it's used even if ANTHROPIC_API_KEY is also set.
// Flip the priority below if you'd rather default to Anthropic when both are present.

const anthropicClient = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const GROQ_API_KEY = process.env.GROQ_API_KEY || null;

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Free-tier, hosted on Groq's LPUs. Swap for 'llama-3.1-8b-instant' if you want it faster/cheaper.
const GROQ_MODEL = 'openai/gpt-oss-120b';

const ANTHROPIC_MODEL = 'claude-sonnet-5';

const provider = GROQ_API_KEY ? 'groq' : (anthropicClient ? 'anthropic' : null);

/**
 * IMPORTANT SCOPE NOTE (say this out loud in the demo/Q&A):
 * This does NOT know why a stock moved in the real-world/news sense — we
 * have no news feed. It explains the MOVE using only the structured signals
 * our own system already computed (price delta, volatility, volume ratio,
 * 52-week proximity, alert crossings). That's an intentional scope
 * boundary, not a missing feature — an LLM guessing at "why" without real
 * news data would just be confident-sounding speculation, which is worse
 * than not answering.
 */
function buildContext(current, change, history) {
  const historyLine = history && history.length
    ? history.map(h => h.price).join(' → ')
    : 'no recent tick history available';

  const factorLines = change?.factors?.length
    ? change.factors.map(f => `  - ${f.label}: contributes ${f.contribution} points — ${f.detail}`).join('\n')
    : '  (no scored factors)';

  return `Stock: ${current.symbol} (${current.name})
Current price: ₹${current.price}
Previous close: ₹${current.prevClose}
Day range: ₹${current.dayLow?.toFixed(2)} - ₹${current.dayHigh?.toFixed(2)}
52-week range: ₹${current.week52Low?.toFixed(2)} - ₹${current.week52High?.toFixed(2)}
Current volume: ${current.volume} (avg ${current.avgVolume})
Volatility profile: ${current.volatility}
Data freshness: ${current.stale ? 'STALE — feed has not updated recently' : 'live'}
Recent price sequence: ${historyLine}
System's computed significance: ${change ? `total score ${change.score}, tier ${change.tier}` : 'no meaningful change flagged'}
${change?.hoursSinceCheckpoint != null ? `Time since user's last checkpoint: ${change.hoursSinceCheckpoint}h (expected normal drift over that window: ±${change.timeAdjustedVolPct}%, using volatility × √time)` : ''}
Score breakdown by factor:
${factorLines}`;
}

const SYSTEM_PROMPT = `You are "Pulse Assistant", an explainer embedded in a stock watchlist app.
Rules:
- Explain price/volume moves ONLY using the structured data given to you. Never invent news, earnings, or events you weren't told about.
- If asked WHY something happened in a real-world/news sense, say plainly that you don't have news data — you can only describe the size and pattern of the move itself.
- If asked why a score is what it is, walk through the factor breakdown you were given (each factor's point contribution), and explain the time-adjustment (volatility × √hours-since-checkpoint) in plain terms if it's relevant.
- Never give investment advice (no buy/sell/hold recommendations).
- Keep responses to 2-4 short sentences unless the user asks for more detail.
- Be concrete: reference the actual numbers you were given.`;

function templateExplain(current, change) {
  // Deterministic fallback used when no API key is configured, so the
  // feature degrades gracefully instead of breaking the demo.
  if (!change || change.isNew) {
    return `${current.symbol} hasn't been flagged as significant — no meaningful change detected since your last checkpoint.`;
  }
  const reasonText = change.reasons.join('. ');
  return `${current.symbol} is at ₹${current.price} (score ${change.score}, tier "${change.tier}"). ${reasonText}. (AI explanations are running in template mode — set GROQ_API_KEY, or ANTHROPIC_API_KEY, on the backend for natural-language answers and follow-up questions.)`;
}

// --- Groq call (OpenAI-compatible chat completions) --------------------
async function callGroq(systemPrompt, chatMessages) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 300,
      messages: [{ role: 'system', content: systemPrompt }, ...chatMessages],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    const err = new Error(`Groq API error ${res.status}`);
    err.detail = errBody;
    throw err;
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// --- Anthropic call ------------------------------------------------------
async function callAnthropic(systemPrompt, chatMessages) {
  const res = await anthropicClient.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 300,
    system: systemPrompt,
    messages: chatMessages, // [{role: 'user'|'assistant', content: '...'}, ...]
  });
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

async function explainStock({ current, change, history }) {
  if (!provider) return { text: templateExplain(current, change), mode: 'template' };

  const context = buildContext(current, change, history);
  const userMessage = { role: 'user', content: `Here is the current data for this stock:\n\n${context}\n\nExplain what's happening with this stock right now, in plain language.` };

  try {
    const text = provider === 'groq'
      ? await callGroq(SYSTEM_PROMPT, [userMessage])
      : await callAnthropic(SYSTEM_PROMPT, [userMessage]);
    return { text, mode: 'ai', provider };
  } catch (e) {
    // Graceful degrade instead of surfacing a raw provider error to the UI.
    return { text: templateExplain(current, change), mode: 'template', providerError: e.detail || e.message };
  }
}

async function chatAboutStock({ current, change, history, messages }) {
  if (!provider) {
    return { text: templateExplain(current, change) + ' Ask again once an API key is configured for real follow-up answers.', mode: 'template' };
  }

  const context = buildContext(current, change, history);
  const systemWithContext = `${SYSTEM_PROMPT}\n\nCurrent stock context:\n${context}`;

  try {
    const text = provider === 'groq'
      ? await callGroq(systemWithContext, messages)
      : await callAnthropic(systemWithContext, messages);
    return { text, mode: 'ai', provider };
  } catch (e) {
    return { text: templateExplain(current, change), mode: 'template', providerError: e.detail || e.message };
  }
}

module.exports = { explainStock, chatAboutStock, aiEnabled: !!provider, provider };