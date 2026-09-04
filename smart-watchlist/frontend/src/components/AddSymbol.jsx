import { useState } from 'react';

export default function AddSymbol({ allSymbols, watchedSymbols, onAdd }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const available = allSymbols.filter(
    s => !watchedSymbols.includes(s.symbol) &&
      (s.symbol.toLowerCase().includes(query.toLowerCase()) ||
       s.name.toLowerCase().includes(query.toLowerCase()))
  );

  return (
    <div className="add-symbol">
      <input
        placeholder="Add a symbol to your watchlist…"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && query && (
        <div className="dropdown">
          {available.length === 0 && <div className="dropdown-empty">No matches</div>}
          {available.slice(0, 6).map(s => (
            <div
              key={s.symbol}
              className="dropdown-item"
              onClick={() => { onAdd(s.symbol); setQuery(''); setOpen(false); }}
            >
              <strong>{s.symbol}</strong> <span>{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
