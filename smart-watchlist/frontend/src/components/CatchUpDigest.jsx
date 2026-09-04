import { useState, useMemo } from 'react';

const CATEGORY_MAP = {
  price: 'bigmoves',
  volume: 'volume',
  '52wk-high': 'breakouts',
  '52wk-low': 'breakouts',
  reversal: 'breakouts',
  alert: 'breakouts',
};

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'bigmoves', label: 'Big Moves' },
  { key: 'volume', label: 'Volume Spikes' },
  { key: 'breakouts', label: 'Technical Breakouts' },
];

function hoursAgoLabel(hours) {
  if (hours < 1) return `${Math.round(hours * 60)} mins ago`;
  if (hours < 48) return `${hours.toFixed(1)} hrs ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export default function CatchUpDigest({ items, hoursSinceCheckpoint, onCheckpoint }) {
  const [tab, setTab] = useState('all');

  const feed = useMemo(() => {
    const entries = [];
    items.forEach(item => {
      (item.change?.factors || []).forEach(f => {
        entries.push({
          symbol: item.symbol,
          category: CATEGORY_MAP[f.key] || 'breakouts',
          label: `${item.symbol} — ${f.detail}`,
          headline: f.key === 'volume'
            ? `${item.symbol} volume unusually high`
            : f.key === 'price'
              ? `${item.symbol} moved sharply`
              : `${item.symbol}: ${f.label.toLowerCase()}`,
          contribution: f.contribution,
        });
      });
    });
    return entries.sort((a, b) => b.contribution - a.contribution);
  }, [items]);

  const counts = {
    all: feed.length,
    bigmoves: feed.filter(f => f.category === 'bigmoves').length,
    volume: feed.filter(f => f.category === 'volume').length,
    breakouts: feed.filter(f => f.category === 'breakouts').length,
  };

  const visible = tab === 'all' ? feed : feed.filter(f => f.category === tab);
  const attentionCount = items.filter(i => i.change && !i.change.isNew && i.change.tier !== 'stable').length;

  if (feed.length === 0) return null;

  return (
    <div className="digest">
      <div className="digest-banner-2">
        <div className="digest-meta">Auto-tracked since your last visit · {hoursAgoLabel(hoursSinceCheckpoint)}</div>
        <p className="digest-summary">
          {attentionCount} stock{attentionCount !== 1 ? 's' : ''} in your watchlist need{attentionCount === 1 ? 's' : ''} attention.
          {feed[0] ? ` ${feed[0].headline}.` : ''} {counts.breakouts} technical signal{counts.breakouts !== 1 ? 's' : ''} detected.
        </p>
        <button className="reset-baseline-btn" onClick={onCheckpoint}>✓ Reset baseline to now</button>
      </div>

      <div className="digest-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`digest-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}{t.key !== 'all' ? ` · ${counts[t.key]}` : ` · ${counts.all}`}
          </button>
        ))}
      </div>

      <div className="digest-list">
        {visible.slice(0, 8).map((f, i) => (
          <div key={i} className="digest-item">
            <span className="digest-icon">{f.category === 'volume' ? '🔥' : f.category === 'bigmoves' ? '📈' : '📊'}</span>
            <div>
              <div className="digest-headline">{f.headline}</div>
              <div className="digest-detail">{f.label.split(' — ')[1]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
