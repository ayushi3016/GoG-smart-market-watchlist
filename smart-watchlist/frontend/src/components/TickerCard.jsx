import ExplainPanel from './ExplainPanel';
import Sparkline from './Sparkline';

const SECTOR = {
  RELIANCE: 'Energy', TCS: 'IT', HDFCBANK: 'Banking', INFY: 'IT',
  ICICIBANK: 'Banking', GROWW: 'Fintech', TATAMOTORS: 'Auto',
  ZOMATO: 'Consumer', ADANIENT: 'Infra', SUNPHARMA: 'Pharma',
  BAJFINANCE: 'Finance', ITC: 'FMCG',
};

const TIER_DOT = { critical: '🔴', watch: '🟠', stable: '🟢' };

export default function TickerCard({ item, history, onRemove, onSetAlert, aiEnabled }) {
  const { symbol, name, price, prevClose, volume, avgVolume, stale, change, alertThreshold, asOf } = item;
  const dayDelta = price - prevClose;
  const dayPct = ((dayDelta / prevClose) * 100).toFixed(2);
  const isUp = price >= prevClose;
  const tier = change?.tier || 'stable';
  const volRatio = avgVolume ? volume / avgVolume : 1;

  return (
    <div className={`ticker-card tier-${tier}`}>
      <div className="tc-top">
        <div>
          <div className="tc-title-row">
            <span className="tc-symbol">{symbol}</span>
            {SECTOR[symbol] && <span className="tc-sector">{SECTOR[symbol]}</span>}
          </div>
          <div className="tc-name">{name}</div>
        </div>
        <span className="tc-tier-dot" title={tier}>{TIER_DOT[tier]}</span>
      </div>

      <div className="tc-price-row">
        <div>
          <div className="tc-price">₹{price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
          <div className={`tc-day-change ${isUp ? 'up' : 'down'}`}>
            {isUp ? '▲' : '▼'} {Math.abs(dayDelta).toFixed(2)} ({Math.abs(dayPct)}%)
          </div>
        </div>
        <Sparkline prices={history} up={isUp} />
      </div>

      <div className="tc-badges">
        {change && !change.isNew && (
          <span className={`badge since-visit ${change.pctChange >= 0 ? 'up' : 'down'}`}>
            {change.pctChange >= 0 ? '▲' : '▼'} {Math.abs(change.pctChange)}% since visit
          </span>
        )}
        {volRatio >= 1.5 && (
          <span className="badge vol-badge">🔥 {volRatio.toFixed(1)}x Vol</span>
        )}
        <span className={`badge freshness-badge ${stale ? 'stale' : 'live'}`}>
          {stale ? '⚠ stale' : '● live'}
        </span>
      </div>

      <div className="tc-actions">
        <button className="tc-btn" onClick={() => onSetAlert(symbol, alertThreshold)}>
          {alertThreshold ? `🔔 ${alertThreshold}` : '🔕 Set alert'}
        </button>
        <button className="tc-btn tc-btn-danger" onClick={() => onRemove(symbol)}>Remove</button>
      </div>

      {change && change.reasons?.length > 0 && (
        <div className="tc-reasons">
          <span className={`tag ${change.isNew ? 'new' : 'changed'}`}>{change.isNew ? 'new' : 'changed'}</span>
          <ul>
            {change.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      <ExplainPanel symbol={symbol} aiEnabled={aiEnabled} />
    </div>
  );
}
