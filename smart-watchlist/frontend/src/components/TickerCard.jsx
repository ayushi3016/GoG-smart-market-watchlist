import { useState } from 'react';
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
  const { symbol, name, price, prevClose, volume, avgVolume, stale, change, alertThreshold } = item;
  const dayDelta = price - prevClose;
  const dayPct = ((dayDelta / prevClose) * 100).toFixed(2);
  const isUp = price >= prevClose;
  const tier = change?.tier || 'stable';
  const volRatio = avgVolume ? volume / avgVolume : 1;

  const [editingAlert, setEditingAlert] = useState(false);
  const [alertInput, setAlertInput] = useState(alertThreshold ?? '');

  const openEditor = () => {
    setAlertInput(alertThreshold ?? '');
    setEditingAlert(true);
  };

  const handleAlertSubmit = (e) => {
    e.preventDefault();
    const num = parseFloat(alertInput);
    if (Number.isNaN(num) || num <= 0) return;
    onSetAlert(symbol, num);
    setEditingAlert(false);
  };

  const handleClearAlert = () => {
    onSetAlert(symbol, null);
    setEditingAlert(false);
  };

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

      {editingAlert ? (
        // Editing mode gets its own full-width row — Remove is hidden here
        // on purpose, so this narrow card never has to squeeze 4-5 controls
        // into one row (that squeeze was causing Cancel/Remove to overlap).
        <form className="tc-alert-form" onSubmit={handleAlertSubmit}>
          <input
            type="number"
            step="0.01"
            min="0"
            autoFocus
            placeholder="Alert price"
            value={alertInput}
            onChange={e => setAlertInput(e.target.value)}
            className="tc-alert-input"
          />
          <div className="tc-alert-form-actions">
            <button type="submit" className="tc-btn tc-btn-small">Save</button>
            <button type="button" className="tc-btn tc-btn-small" onClick={() => setEditingAlert(false)}>
              Cancel
            </button>
            {alertThreshold != null && (
              <button type="button" className="tc-btn tc-btn-small tc-btn-danger" onClick={handleClearAlert}>
                Clear
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="tc-actions">
          <button className="tc-btn" onClick={openEditor}>
            {alertThreshold ? `🔔 ${alertThreshold}` : '🔕 Set alert'}
          </button>
          <button className="tc-btn tc-btn-danger" onClick={() => onRemove(symbol)}>Remove</button>
        </div>
      )}

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