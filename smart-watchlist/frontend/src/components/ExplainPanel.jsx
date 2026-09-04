import { useState } from 'react';
import { explainStock, chatAboutStock } from '../api';

export default function ExplainPanel({ symbol, aiEnabled }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]); // {role: 'user'|'assistant', content}
  const [input, setInput] = useState('');
  const [mode, setMode] = useState(null); // 'ai' | 'template'

  const handleOpen = async () => {
    setOpen(true);
    if (messages.length > 0) return; // already loaded
    setLoading(true);
    try {
      const res = await explainStock(symbol);
      if (res.error) {
        setMessages([{ role: 'assistant', content: `Couldn't get an explanation: ${res.detail || res.error}` }]);
      } else {
        setMode(res.mode);
        setMessages([{ role: 'assistant', content: res.text }]);
      }
    } catch (e) {
      setMessages([{ role: 'assistant', content: 'Could not load explanation right now — check that the backend is running.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const next = [...messages, { role: 'user', content: input.trim() }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const res = await chatAboutStock(symbol, next);
      if (res.error) {
        setMessages([...next, { role: 'assistant', content: `Couldn't answer that: ${res.detail || res.error}` }]);
      } else {
        setMode(res.mode);
        setMessages([...next, { role: 'assistant', content: res.text }]);
      }
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: 'Something went wrong answering that.' }]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button className="explain-btn" onClick={handleOpen}>💬 Explain this</button>
    );
  }

  return (
    <div className="explain-panel">
      <div className="explain-header">
        <span>Ask about {symbol}</span>
        {mode === 'template' && (
          <span className="mode-badge" title="Set GROQ_API_KEY on the backend for real AI answers">
            template mode
          </span>
        )}
        <button className="close-btn" onClick={() => setOpen(false)}>✕</button>
      </div>

      <div className="explain-messages">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>{m.content}</div>
        ))}
        {loading && <div className="msg assistant loading-dots">thinking…</div>}
      </div>

      <div className="explain-input">
        <input
          placeholder={aiEnabled ? 'Ask a follow-up…' : 'Ask (template mode — set API key for real answers)'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
        />
        <button onClick={handleSend} disabled={loading}>Send</button>
      </div>
      <div className="explain-disclaimer">
        Explains from this app's own signals only — no live news, no investment advice.
      </div>
    </div>
  );
}