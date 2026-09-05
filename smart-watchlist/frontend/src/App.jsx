import { useEffect, useRef, useState } from 'react';
import {
  fetchSymbols, fetchWatchlist,
  addSymbol, removeSymbol, checkpoint, setAlert, connectWebSocket, fetchConfig,
  isLoggedIn, logout, fetchMe, fetchMovers,
} from './api';
import TickerCard from './components/TickerCard';
import AddSymbol from './components/AddSymbol';
import AuthScreen from './components/AuthScreen';
import MarketMarquee from './components/MarketMarquee';
import CatchUpDigest from './components/CatchUpDigest';
import AlertsModal from './components/AlertsModal';
import './App.css';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function App() {
  const [authed, setAuthed] = useState(isLoggedIn());
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState([]);
  const [allSymbols, setAllSymbols] = useState([]);
  const [movers, setMovers] = useState([]);
  const [me, setMe] = useState(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileRef = useRef(null);
  const wsRef = useRef(null);
  const historyRef = useRef({}); // symbol -> [prices], not state (avoid re-render storms)
  const [historyTick, setHistoryTick] = useState(0); // bump to force re-render on new tick
  const [wsStatus, setWsStatus] = useState('connecting');
  const [toasts, setToasts] = useState([]); // [{ id, symbol, message }]
  const notifiedRef = useRef(new Set());

  useEffect(() => {
    items.forEach(item => {
      const crossed = item.change?.reasons?.find(r => r.startsWith('Crossed your alert level'));
      if (crossed && !notifiedRef.current.has(item.symbol)) {
        notifiedRef.current.add(item.symbol);
        pushToast(item.symbol, `${item.symbol}: ${crossed}`);
      }
    });
  }, [items]);
  useEffect(() => {
    if (!authed) return;
    (async () => {
      const [symbols, watchlist, config, meRes, moversRes] = await Promise.all([
        fetchSymbols(), fetchWatchlist(), fetchConfig(), fetchMe(), fetchMovers(),
      ]);
      setAllSymbols(symbols);
      setItems(watchlist);
      setAiEnabled(config.aiEnabled);
      setMe(meRes);
      setMovers(moversRes.slice(0, 10));
      watchlist.forEach(i => { historyRef.current[i.symbol] = [i.price]; });
      setReady(true);

       wsRef.current = connectWebSocket((tick) => {
        const hist = historyRef.current[tick.symbol] || [];
        hist.push(tick.price);
        if (hist.length > 30) hist.shift();
        historyRef.current[tick.symbol] = hist;
        setHistoryTick(t => t + 1);
 
        setItems(prev => {
          const exists = prev.some(i => i.symbol === tick.symbol);
          if (!exists) return prev;
          return prev.map(i => (i.symbol === tick.symbol ? { ...i, ...tick } : i));
        });
      }, setWsStatus);
    })();

    return () => wsRef.current?.close();
  }, [authed]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!authed) {
    return <AuthScreen onAuthed={() => setAuthed(true)} />;
  }
  const pushToast = (symbol, message) => {
    const id = `${symbol}-${Date.now()}`;
    setToasts(prev => [...prev, { id, symbol, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 6000);
  };
  const handleLogout = () => {
    logout();
    wsRef.current?.close();
    setAuthed(false);
    setReady(false);
    setItems([]);
  };

  const handleAdd = async (symbol) => {
    const updated = await addSymbol(symbol);
    setItems(updated);
    if (!historyRef.current[symbol]) {
      const added = updated.find(i => i.symbol === symbol);
      if (added) historyRef.current[symbol] = [added.price];
    }
    setShowAdd(false);
  };

  const handleRemove = async (symbol) => {
    const updated = await removeSymbol(symbol);
    setItems(updated);
    delete historyRef.current[symbol];
  };

  const handleSetAlert = async (symbol, threshold) => {
    await setAlert(symbol, threshold);
    const updated = await fetchWatchlist();
    setItems(updated);
  };

  const handleCheckpoint = async () => {
    await checkpoint();
    const updated = await fetchWatchlist();
    setItems(updated);
    notifiedRef.current.clear(); // allow the same alert to fire again after this checkpoint
  };

  const tierCounts = items.reduce(
    (acc, i) => {
      const tier = i.change?.isNew ? 'stable' : (i.change?.tier || 'stable');
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    },
    { critical: 0, watch: 0, stable: 0 }
  );

  const firstChangeMeta = items.find(i => i.change && !i.change.isNew)?.change;
  const hoursSinceCheckpoint = firstChangeMeta?.hoursSinceCheckpoint ?? 0.1;
  const initial = (me?.name || me?.email || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="app">
       <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className="toast">
            <span className="toast-icon">🔔</span>
            <span className="toast-text">{t.message}</span>
          </div>
        ))}
      </div>
      <div className="topbar">
        <div className="brand">
          <img src="/logo.png" alt="GoG" className="brand-logo" />
          <span className="brand-name">GoG</span>
          <span className={`live-pill live-pill-${wsStatus}`}>
          {wsStatus === 'open' && 'LIVE'}
          {wsStatus === 'connecting' && 'CONNECTING…'}
          {wsStatus === 'closed' && 'DISCONNECTED'}
          {wsStatus === 'error' && 'CONNECTION ISSUE'}
        </span>
        </div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={() => setShowAlerts(true)} title="Price alerts">🔔</button>
          <button className="icon-btn" onClick={() => window.location.reload()} title="Refresh">🔄</button>
          <button className="primary-btn" onClick={() => setShowAdd(s => !s)}>+ Add stock</button>
          <div className="profile-menu-wrap" ref={profileRef}>
            <div className="avatar" title={me?.email} onClick={() => setShowProfileMenu(s => !s)}>
              {initial}
            </div>
            {showProfileMenu && (
              <div className="profile-dropdown">
                <div className="profile-dropdown-header">
                  <div className="profile-name">{me?.name || 'Account'}</div>
                  <div className="profile-email">{me?.email}</div>
                </div>
                <button className="profile-dropdown-item" onClick={handleLogout}>
                  ⎋ Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <MarketMarquee movers={movers} />

      <main className="content">
        {ready && (
          <div className="greeting-block">
            <h1>{greeting()}, {me?.name || 'there'}</h1>
            <p>
  {tierCounts.critical + tierCounts.watch === 0
    ? `${items.length} stock${items.length !== 1 ? 's' : ''} tracked · all quiet.`
    : `${items.length} stock${items.length !== 1 ? 's' : ''} tracked · ${tierCounts.critical + tierCounts.watch} worth a look before you scroll past.`}
</p>
          </div>
        )}

        {showAdd && (
          <AddSymbol
            allSymbols={allSymbols}
            watchedSymbols={items.map(i => i.symbol)}
            onAdd={handleAdd}
          />
        )}

        {!ready && <div className="loading">Loading your watchlist…</div>}

        {ready && items.length > 0 && (
          <CatchUpDigest items={items} hoursSinceCheckpoint={hoursSinceCheckpoint} onCheckpoint={handleCheckpoint} />
        )}

        <div className="card-grid">
          {items
            .slice()
            .sort((a, b) => (b.change?.score || 0) - (a.change?.score || 0))
            .map(item => (
              <TickerCard
                key={item.symbol}
                item={item}
                history={historyRef.current[item.symbol]}
                onRemove={handleRemove}
                onSetAlert={handleSetAlert}
                aiEnabled={aiEnabled}
              />
            ))}
        </div>

        {ready && items.length === 0 && (
          <div className="empty-state">Nothing here yet. Add a stock and we'll start watching.</div>
        )}

        {!aiEnabled && ready && (
          <p className="ai-status">💬 Explanations are running on rule-based summaries right now — plug in an API key for full AI answers.</p>
        )}
      </main>

      {showAlerts && (
        <AlertsModal
          items={items}
          onClose={() => setShowAlerts(false)}
          onSetAlert={async (symbol, threshold) => {
            await setAlert(symbol, threshold);
            const updated = await fetchWatchlist();
            setItems(updated);
          }}
        />
      )}
    </div>
  );
}