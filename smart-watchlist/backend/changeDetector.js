/**
 * "Meaningful change" is deliberately NOT a flat % threshold.
 * It's a composite significance score built from:
 *   1. Price move relative to the symbol's OWN volatility, TIME-ADJUSTED
 *      (see below)
 *   2. Volume relative to that symbol's average volume (unusual interest)
 *   3. Whether a user-set alert threshold was crossed since last visit
 *   4. Whether the direction reversed since last visit (was up, now down, etc.)
 *   5. Proximity to the 52-week high/low (psychological + technical signal)
 *
 * Returns null if nothing meaningful happened (so the UI can stay quiet —
 * the whole point is NOT surfacing noise).
 *
 * TIME ADJUSTMENT — why √time, not a flat multiplier:
 * A stock's expected drift over an interval scales with the SQUARE ROOT of
 * elapsed time (standard random-walk/Brownian-motion behavior — this is the
 * same assumption options pricing uses). So we compare the move you actually
 * saw against volatility × √(hours since you last checked), not raw
 * volatility. Concretely: the same 2% move is a big surprise if you checked
 * an hour ago, but unsurprising — just normal drift — if you've been away
 * three days. This intentionally differs from a simpler "longer away =
 * always more important" rule: what matters is whether the move was FAST
 * relative to the gap, not just large in absolute terms.
 */
function computeChange(current, lastSnapshot, alertThreshold, hoursSinceCheckpoint = 1) {
  if (!lastSnapshot) {
    return {
      symbol: current.symbol,
      isNew: true,
      reasons: ['First time viewing this symbol'],
      score: 0,
      factors: [],
    };
  }

  const priceDelta = current.price - lastSnapshot.price;
  const pctChange = priceDelta / lastSnapshot.price;
  const timeAdjustedVol = (current.volatility || 0.01) * Math.sqrt(Math.max(hoursSinceCheckpoint, 0.25));
  const volNorm = Math.abs(pctChange) / timeAdjustedVol; // in "surprise units"

  const volumeDelta = current.volume - (lastSnapshot.volume || 0);
  const volumeRatio = current.avgVolume ? volumeDelta / current.avgVolume : 0;

  const reasons = [];
  const factors = []; // per-component breakdown, exposed to the UI/AI, not just summed away
  let score = 0;

  if (volNorm >= 1.5) {
    const contribution = Number((volNorm * 2).toFixed(2));
    reasons.push(`Price moved ${(pctChange * 100).toFixed(2)}% — unusually large for this stock`);
    factors.push({
      key: 'price',
      label: 'Price movement',
      detail: `${(pctChange * 100).toFixed(2)}% move vs a time-adjusted expected drift of ±${(timeAdjustedVol * 100).toFixed(2)}% (volatility × √${hoursSinceCheckpoint.toFixed(1)}h)`,
      contribution,
    });
    score += contribution;
  } else if (Math.abs(pctChange) >= 0.005) {
    const contribution = Number(volNorm.toFixed(2));
    reasons.push(`Price moved ${(pctChange * 100).toFixed(2)}%`);
    factors.push({
      key: 'price',
      label: 'Price movement',
      detail: `${(pctChange * 100).toFixed(2)}% move, within normal range for this time gap`,
      contribution,
    });
    score += contribution;
  }

  if (volumeRatio > 0.15) {
    const contribution = Number((volumeRatio * 3).toFixed(2));
    reasons.push(`Volume up ${(volumeRatio * 100).toFixed(0)}% vs average — unusual interest`);
    factors.push({
      key: 'volume',
      label: 'Volume spike',
      detail: `Volume ${(volumeRatio * 100).toFixed(0)}% above average since last checkpoint`,
      contribution,
    });
    score += contribution;
  }

  if (alertThreshold != null) {
    const crossedUp = lastSnapshot.price < alertThreshold && current.price >= alertThreshold;
    const crossedDown = lastSnapshot.price > alertThreshold && current.price <= alertThreshold;
    if (crossedUp || crossedDown) {
      reasons.push(`Crossed your alert level of ${alertThreshold}`);
      factors.push({
        key: 'alert',
        label: 'User alert crossed',
        detail: `Crossed your set level of ₹${alertThreshold}`,
        contribution: 10,
      });
      score += 10; // user-set alerts always matter most
    }
  }

  const wasUp = lastSnapshot.price >= (lastSnapshot.prevClose ?? lastSnapshot.price);
  const isUp = current.price >= current.prevClose;
  if (wasUp !== isUp && Math.abs(pctChange) >= 0.003) {
    reasons.push(`Trend reversed — now trading ${isUp ? 'up' : 'down'} on the day`);
    factors.push({
      key: 'reversal',
      label: 'Trend reversal',
      detail: `Now trading ${isUp ? 'up' : 'down'} on the day, opposite of last checkpoint`,
      contribution: 1.5,
    });
    score += 1.5;
  }

  if (current.week52High) {
    const distFromHigh = (current.week52High - current.price) / current.week52High;
    if (distFromHigh <= 0.02) {
      reasons.push(`Trading within 2% of its 52-week high (₹${current.week52High.toFixed(2)})`);
      factors.push({
        key: '52wk-high',
        label: '52-week high proximity',
        detail: `Within ${(distFromHigh * 100).toFixed(2)}% of 52-week high ₹${current.week52High.toFixed(2)}`,
        contribution: 2,
      });
      score += 2;
    }
  }
  if (current.week52Low) {
    const distFromLow = (current.price - current.week52Low) / current.week52Low;
    if (distFromLow <= 0.02) {
      reasons.push(`Trading within 2% of its 52-week low (₹${current.week52Low.toFixed(2)})`);
      factors.push({
        key: '52wk-low',
        label: '52-week low proximity',
        detail: `Within ${(distFromLow * 100).toFixed(2)}% of 52-week low ₹${current.week52Low.toFixed(2)}`,
        contribution: 2,
      });
      score += 2;
    }
  }

  const hasMeaningfulChange = reasons.length > 0;

  if (current.stale) {
    reasons.push('Data feed for this symbol is currently stale/delayed');
  }

  if (!hasMeaningfulChange) return null;

  return {
    symbol: current.symbol,
    isNew: false,
    pctChange: Number((pctChange * 100).toFixed(2)),
    reasons,
    factors,
    hoursSinceCheckpoint: Number(hoursSinceCheckpoint.toFixed(2)),
    timeAdjustedVolPct: Number((timeAdjustedVol * 100).toFixed(2)),
    score: Number(score.toFixed(2)),
    tier: tierFor(score),
  };
}

/**
 * Buckets a raw score into the tiers the UI groups by. Thresholds are a
 * product decision (tuned, not derived) — documented here so they're easy
 * to defend and retune in one place.
 */
function tierFor(score) {
  if (score >= 6) return 'critical';
  if (score >= 3) return 'watch';
  return 'stable';
}

module.exports = { computeChange, tierFor };
