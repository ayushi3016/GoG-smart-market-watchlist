import { useState } from 'react';

export default function AlertsModal({ items, onClose, onSetAlert }) {
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [threshold, setThreshold] = useState('');

  const active = items.filter(i => i.alertThreshold != null);
  const triggered = items.filter(i => i.change?.reasons?.some(r => r.startsWith('Crossed your alert level')));

  const handleAdd = () => {
    if (!selectedSymbol || !threshold) return;
    onSetAlert(selectedSymbol, parseFloat(threshold));
    setSelectedSymbol('');
    setThreshold('');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Price alerts</h2>
            <p className="modal-subtitle">{active.length} active · {triggered.length} triggered</p>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="alert-new-row">
          <select value={selectedSymbol} onChange={e => setSelectedSymbol(e.target.value)}>
            <option value="">Choose a stock…</option>
            {items.map(i => <option key={i.symbol} value={i.symbol}>{i.symbol}</option>)}
          </select>
          <input
            type="number"
            placeholder="Target price"
            value={threshold}
            onChange={e => setThreshold(e.target.value)}
          />
          <button className="add-alert-btn" onClick={handleAdd}>+ New</button>
        </div>

        {active.length === 0 ? (
          <div className="modal-empty">
            <div className="modal-empty-icon">🔔</div>
            <div className="modal-empty-title">No alerts yet</div>
            <div className="modal-empty-sub">Get notified the moment a stock hits your target.</div>
          </div>
        ) : (
          <div className="alert-list">
            {active.map(i => (
              <div key={i.symbol} className="alert-list-item">
                <span>{i.symbol}</span>
                <span>Target ₹{i.alertThreshold}</span>
                <span className={i.change?.reasons?.some(r => r.startsWith('Crossed')) ? 'alert-triggered' : 'alert-pending'}>
                  {i.change?.reasons?.some(r => r.startsWith('Crossed')) ? 'Triggered' : 'Watching'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
