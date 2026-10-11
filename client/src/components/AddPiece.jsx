import { useState } from 'react';

export default function AddPiece({ onAdd, busy }) {
  const [url, setUrl] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const u = url.trim();
    if (!u) return;
    onAdd(u);
    setUrl('');
  };
  return (
    <form className="add-piece" onSubmit={submit}>
      <input
        type="url"
        placeholder="Paste a link to any clothing piece (Zara, Abercrombie, PacSun, Gucci…)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="Product link"
      />
      <button type="submit" disabled={!url.trim()}>{busy ? 'Adding…' : 'Try it on'}</button>
    </form>
  );
}
