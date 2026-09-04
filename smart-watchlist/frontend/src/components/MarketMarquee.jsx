export default function MarketMarquee({ movers }) {
  if (!movers || movers.length === 0) return null;
  // Duplicate the list so the CSS scroll loop is seamless.
  const doubled = [...movers, ...movers];

  return (
    <div className="marquee">
      <span className="marquee-label">MARKET MOVERS</span>
      <div className="marquee-track">
        {doubled.map((m, i) => (
          <span key={i} className={`marquee-item ${m.pctChange >= 0 ? 'up' : 'down'}`}>
            {m.symbol} {m.pctChange >= 0 ? '↗' : '↘'}{m.pctChange >= 0 ? '+' : ''}{m.pctChange}%
          </span>
        ))}
      </div>
    </div>
  );
}
