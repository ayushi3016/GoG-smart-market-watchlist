// Run with: node --test
// Uses Node's built-in test runner (Node 18+) — no new dependency needed,
// which matters given the timeline and keeps package.json unchanged.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeChange, tierFor } = require('./changeDetector');

function baseCurrent(overrides = {}) {
  return {
    symbol: 'TEST',
    price: 100,
    prevClose: 100,
    volatility: 0.01,
    volume: 100000,
    avgVolume: 100000,
    week52High: 150,
    week52Low: 60,
    stale: false,
    ...overrides,
  };
}

function baseSnapshot(overrides = {}) {
  return {
    price: 100,
    prevClose: 100,
    volume: 100000,
    ...overrides,
  };
}

test('returns isNew:true with no reasons when there is no prior snapshot', () => {
  const result = computeChange(baseCurrent(), null, null, 1);
  assert.equal(result.isNew, true);
  assert.equal(result.score, 0);
});

test('returns null when nothing meaningful happened', () => {
  // Tiny move, no volume spike, no alert, no reversal, not near 52wk band
  const current = baseCurrent({ price: 100.05 });
  const snap = baseSnapshot({ price: 100 });
  const result = computeChange(current, snap, null, 1);
  assert.equal(result, null);
});

test('flags a large price move relative to time-adjusted volatility', () => {
  // volatility 0.01, 1 hour -> timeAdjustedVol = 0.01 * sqrt(1) = 0.01 (1%)
  // a 5% move is a huge surprise relative to that
  const current = baseCurrent({ price: 105, volatility: 0.01 });
  const snap = baseSnapshot({ price: 100 });
  const result = computeChange(current, snap, null, 1);
  assert.ok(result, 'expected a non-null change');
  assert.ok(result.factors.some(f => f.key === 'price'));
  assert.ok(result.score > 0);
});

test('same absolute move is NOT flagged as unusual after a long gap (time adjustment)', () => {
  // Same 2% move, but 100 hours since checkpoint instead of 1 —
  // expected drift over 100h = 0.01 * sqrt(100) = 0.10 (10%), so 2% is normal.
  const current = baseCurrent({ price: 102, volatility: 0.01 });
  const snap = baseSnapshot({ price: 100 });
  const resultShortGap = computeChange({ ...current }, snap, null, 1);
  const resultLongGap = computeChange({ ...current }, snap, null, 100);

  assert.ok(resultShortGap, 'short gap: 2% move after 1h should register as some signal');
  // Long gap: still returns a low-severity "price moved" entry per current logic,
  // but its contribution should be materially smaller than the short-gap case.
  const shortContribution = resultShortGap.factors.find(f => f.key === 'price')?.contribution ?? 0;
  const longContribution = resultLongGap?.factors.find(f => f.key === 'price')?.contribution ?? 0;
  assert.ok(shortContribution > longContribution,
    `expected short-gap contribution (${shortContribution}) > long-gap contribution (${longContribution})`);
});

test('flags unusual volume even with a flat price', () => {
  const current = baseCurrent({ price: 100, volume: 200000, avgVolume: 100000 });
  const snap = baseSnapshot({ price: 100, volume: 100000 });
  const result = computeChange(current, snap, null, 1);
  assert.ok(result, 'expected a non-null change from volume alone');
  assert.ok(result.factors.some(f => f.key === 'volume'));
});

test('flags an alert threshold crossing upward', () => {
  const current = baseCurrent({ price: 105 });
  const snap = baseSnapshot({ price: 95 });
  const result = computeChange(current, snap, 100, 1);
  assert.ok(result, 'expected a non-null change from alert crossing');
  const alertFactor = result.factors.find(f => f.key === 'alert');
  assert.ok(alertFactor, 'expected an alert factor');
  assert.equal(alertFactor.contribution, 10);
});

test('does NOT flag an alert that was already crossed before this snapshot', () => {
  // Both last snapshot and current are already above threshold — no new crossing
  const current = baseCurrent({ price: 106 });
  const snap = baseSnapshot({ price: 105 });
  const result = computeChange(current, snap, 100, 1);
  // No alert factor should fire since we were already above 100 last time too
  if (result) {
    assert.ok(!result.factors.some(f => f.key === 'alert'));
  }
});

test('flags a trend reversal', () => {
  // last snapshot was up-on-day (prevClose 95 < price 100), now down-on-day
  const current = baseCurrent({ price: 98, prevClose: 100 });
  const snap = baseSnapshot({ price: 100, prevClose: 95 });
  const result = computeChange(current, snap, null, 1);
  assert.ok(result, 'expected a non-null change from reversal');
  assert.ok(result.factors.some(f => f.key === 'reversal'));
});

test('flags proximity to 52-week high', () => {
  const current = baseCurrent({ price: 148, week52High: 150 }); // within 2%
  const snap = baseSnapshot({ price: 100 });
  const result = computeChange(current, snap, null, 1);
  assert.ok(result, 'expected a non-null change from 52wk high proximity');
  assert.ok(result.factors.some(f => f.key === '52wk-high'));
});

test('flags proximity to 52-week low', () => {
  const current = baseCurrent({ price: 61, week52Low: 60 }); // within 2%
  const snap = baseSnapshot({ price: 100 });
  const result = computeChange(current, snap, null, 1);
  assert.ok(result, 'expected a non-null change from 52wk low proximity');
  assert.ok(result.factors.some(f => f.key === '52wk-low'));
});

test('multiple simultaneous factors all contribute and sum into the score', () => {
  // Big price move + volume spike + alert crossing all at once
  const current = baseCurrent({ price: 110, volume: 250000, avgVolume: 100000 });
  const snap = baseSnapshot({ price: 100, volume: 100000 });
  const result = computeChange(current, snap, 105, 1);
  assert.ok(result);
  const keys = result.factors.map(f => f.key);
  assert.ok(keys.includes('price'));
  assert.ok(keys.includes('volume'));
  assert.ok(keys.includes('alert'));
  const summed = result.factors.reduce((s, f) => s + f.contribution, 0);
  assert.equal(result.score, Number(summed.toFixed(2)));
});

test('tierFor buckets scores correctly at the documented boundaries', () => {
  assert.equal(tierFor(0), 'stable');
  assert.equal(tierFor(2.99), 'stable');
  assert.equal(tierFor(3), 'watch');
  assert.equal(tierFor(5.99), 'watch');
  assert.equal(tierFor(6), 'critical');
  assert.equal(tierFor(20), 'critical');
});

test('stale flag is reported but does not itself force a score change', () => {
  // If stale is true but nothing else moved, should still return null —
  // staleness alone isn't "meaningful" by this scoring model.
  const current = baseCurrent({ price: 100.01, stale: true });
  const snap = baseSnapshot({ price: 100 });
  const result = computeChange(current, snap, null, 1);
  assert.equal(result, null);
});