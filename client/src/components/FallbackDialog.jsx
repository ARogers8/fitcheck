import { useState } from 'react';
import { bookmarkletHref } from '../bookmarklet.js';
import { fileToDataUrl } from '../api.js';
import { KIND_LABELS } from './PieceCard.jsx';

export default function FallbackDialog({ state, onClose, onSubmit }) {
  const [form, setForm] = useState({ title: '', brand: '', price: '', sizes: '', kind: '', url: state.url || '' });
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const addPhotos = async (files) => {
    const urls = await Promise.all([...files].slice(0, 8).map((f) => fileToDataUrl(f)));
    setPhotos((p) => [...p, ...urls].slice(0, 8));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit({
        url: form.url || undefined,
        kind: form.kind || undefined,
        page: {
          title: form.title,
          brand: form.brand,
          price: form.price,
          sizes: form.sizes.split(/[,\s]+/).filter(Boolean),
          images: photos,
          source: 'manual',
        },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="fb-title" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
        <h2 id="fb-title">{state.error ? 'That store blocked the automatic read' : 'Other ways to add a piece'}</h2>
        {state.error && <p className="muted">{state.error}</p>}

        <h3>Option 1: Send it from the store page</h3>
        <p>
          Drag this button to your bookmarks bar once. Then on any product page, click it and the piece opens here with all its photos and sizes.
        </p>
        <a className="bookmarklet" href={bookmarkletHref(window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, ''))} onClick={(e) => e.preventDefault()} draggable>
          ➜ Send to Fitcheck
        </a>
        {state.url && (
          <p>
            <a href={state.url} target="_blank" rel="noreferrer">Open the product page ↗</a>
          </p>
        )}

        <h3>Option 2: Add it by hand</h3>
        <form className="manual" onSubmit={submit}>
          <input required placeholder="Name (e.g. Wide-Leg Pleated Trousers)" value={form.title} onChange={set('title')} />
          <div className="row">
            <input placeholder="Brand" value={form.brand} onChange={set('brand')} />
            <input placeholder="Price" value={form.price} onChange={set('price')} inputMode="decimal" />
          </div>
          <input placeholder="Sizes, comma separated (XS, S, M, L or 30x30, 32x30)" value={form.sizes} onChange={set('sizes')} />
          <input type="url" placeholder="Link to buy it" value={form.url} onChange={set('url')} />
          <select value={form.kind} onChange={set('kind')}>
            <option value="">Type (detect from name)</option>
            {Object.entries(KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <label className="upload">
            <input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} />
            <span>{photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''} added` : 'Add product photos (save them from the store page)'}</span>
          </label>
          {photos.length > 0 && (
            <div className="photo-strip">
              {photos.map((p, i) => <img key={i} src={p} alt="" />)}
            </div>
          )}
          <button className="primary" disabled={busy || !photos.length || !form.title}>{busy ? 'Adding…' : 'Add piece'}</button>
        </form>
      </div>
    </div>
  );
}
