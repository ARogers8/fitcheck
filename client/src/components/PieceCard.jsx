import { useState } from 'react';
import { formatPrice, proxied } from '../api.js';
import { fitFor, recommendSize } from '../fit/sizes.js';

export const KIND_LABELS = {
  tee: 'T-shirt / top', longsleeve: 'Shirt / long sleeve', tank: 'Tank', sweater: 'Sweater', hoodie: 'Hoodie',
  jacket: 'Jacket', coat: 'Coat', pants: 'Pants / jeans', shorts: 'Shorts', skirt: 'Skirt', dress: 'Dress',
  shoes: 'Shoes', hat: 'Hat',
};
export const KIND_SLOTS = {
  tee: 'base', longsleeve: 'base', tank: 'base', sweater: 'mid', hoodie: 'mid', jacket: 'outer', coat: 'outer',
  pants: 'bottom', shorts: 'bottom', skirt: 'bottom', dress: 'dress', shoes: 'shoes', hat: 'hat',
};

/** "Brand · store.com", dropping the store when it just repeats the brand. */
function storeLine({ brand, store }) {
  if (!brand) return store;
  const key = brand.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
  return store && !store.replace(/[^a-z0-9]/gi, '').toLowerCase().includes(key) ? `${brand} · ${store}` : brand;
}

export default function PieceCard({ piece, wearing, size, body, sex, onWear, onTakeOff, onSize, onKind, onUsePhoto, onRemove }) {
  const [open, setOpen] = useState(false);
  const [recutting, setRecutting] = useState(null);
  const [recutError, setRecutError] = useState('');
  const usePhoto = (u) => {
    setRecutting(u);
    setRecutError('');
    onUsePhoto(u)
      .catch((e) => setRecutError(e.message))
      .finally(() => setRecutting(null));
  };
  const fit = fitFor(piece, size, body, sex);
  const rec = recommendSize(piece, body, sex);
  const thumb = piece.textures?.front?.url || (piece.images?.[0] && proxied(piece.images[0], piece.url));
  return (
    <article className={`piece ${wearing ? 'wearing' : ''}`}>
      <div className="piece-main">
        <button className="thumb" onClick={() => (wearing ? onTakeOff() : onWear())} title={wearing ? 'Take off' : 'Put on'}>
          {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span style={{ background: piece.color }} />}
          {wearing && <em>On</em>}
        </button>
        <div className="piece-info">
          <div className="piece-store">{storeLine(piece)}</div>
          <div className="piece-title" title={piece.title}>{piece.title}</div>
          <div className="piece-price">{formatPrice(piece.price, piece.currency)}</div>
        </div>
      </div>

      <div className="piece-controls">
        <label>
          <span>Size</span>
          {piece.sizes?.length ? (
            <select value={size || ''} onChange={(e) => onSize(e.target.value || null)}>
              <option value="">Choose</option>
              {piece.sizes.map((s) => (
                <option key={s} value={s}>
                  {s}{s === rec ? ' (best fit)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <input placeholder="e.g. M or 32x30" value={size || ''} onChange={(e) => onSize(e.target.value || null)} />
          )}
        </label>
        <label>
          <span>Type</span>
          <select value={piece.kind} onChange={(e) => onKind(e.target.value)}>
            {Object.entries(KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
      </div>
      {size && <div className={`fit fit-${fit.tone}`}>{fit.label}{rec && rec !== size ? ` · best fit for you: ${rec}` : ''}</div>}
      {!size && rec && <div className="fit fit-muted">Best fit for your model: {rec}</div>}

      <div className="piece-actions">
        {wearing ? <button onClick={onTakeOff}>Take off</button> : <button className="primary" onClick={onWear}>Put on</button>}
        {piece.url && (
          <a className="buy" href={piece.url} target="_blank" rel="noreferrer">
            Buy at {piece.store} ↗
          </a>
        )}
        <button className="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? 'Hide photos' : 'Photos'}</button>
        <button className="ghost danger" onClick={onRemove} aria-label="Remove piece">Remove</button>
      </div>

      {open && (
        <div className="photos">
          {piece.textures?.front?.url && (
            <figure>
              <img src={piece.textures.front.url} alt="" />
              <figcaption>Used on model</figcaption>
            </figure>
          )}
          {piece.textures?.back?.url && (
            <figure>
              <img src={piece.textures.back.url} alt="" />
              <figcaption>Back</figcaption>
            </figure>
          )}
          {(piece.images || []).map((u) => {
            const info = piece.photos?.find((p) => p.url === u);
            const inUse = piece.textures?.front?.source === u;
            return (
              <figure key={u} className={inUse ? 'in-use' : ''}>
                <img src={proxied(u, piece.url)} alt="" loading="lazy" />
                <figcaption>
                  {inUse ? (
                    'In use'
                  ) : (
                    <button className="link" disabled={Boolean(recutting)} onClick={() => usePhoto(u)}>
                      {recutting === u ? 'Cutting out…' : 'Use this photo'}
                    </button>
                  )}
                  {info?.packshot && !inUse ? ' · product only' : ''}
                </figcaption>
              </figure>
            );
          })}
          {recutError && <p className="hint error">{recutError}</p>}
          <p className="hint">
            {piece.vision
              ? 'Claude picked the photos that show this exact piece and boxed it out from the rest of the outfit.'
              : 'Fitcheck picked the cleanest photo of this piece. If it picked the wrong one, tap “Use this photo” under a better one, or set the right type above.'}
          </p>
        </div>
      )}
    </article>
  );
}
