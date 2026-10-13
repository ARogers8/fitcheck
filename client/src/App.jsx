import { useCallback, useEffect, useMemo, useState } from 'react';
import Scene, { VIEWS } from './three/Scene.jsx';
import AvatarPanel from './components/AvatarPanel.jsx';
import AddPiece from './components/AddPiece.jsx';
import PieceCard, { KIND_SLOTS } from './components/PieceCard.jsx';
import FallbackDialog from './components/FallbackDialog.jsx';
import PhotoStage from './components/PhotoStage.jsx';
import { useFitcheckStore } from './store.js';
import { importPiece, recutPiece, formatPrice } from './api.js';
import { bodyMeasurements } from './body/measurements.js';
import { recommendSize } from './fit/sizes.js';

export default function App() {
  const [state, dispatch] = useFitcheckStore();
  const [pending, setPending] = useState([]);
  const [error, setError] = useState(null);
  const [fallback, setFallback] = useState(null);
  const [view, setView] = useState({ name: 'full', n: 0 });
  const [autoRotate, setAutoRotate] = useState(false);
  const [mode, setMode] = useState('photo');

  const body = useMemo(() => bodyMeasurements(state.avatar), [state.avatar]);
  const outfit = useMemo(() => state.wearing.map((id) => state.pieces.find((p) => p.id === id)).filter(Boolean), [state.wearing, state.pieces]);
  const total = outfit.reduce((sum, p) => sum + (p.price || 0), 0);

  const runImport = useCallback(
    async (request, label) => {
      const tag = Math.random().toString(36).slice(2);
      setPending((p) => [...p, { tag, label }]);
      setError(null);
      try {
        const piece = await importPiece(request);
        dispatch({ type: 'add', piece, size: recommendSize(piece, body, state.avatar.sex) });
        setFallback(null);
        return piece;
      } catch (err) {
        if (!request.page && (err.blocked || err.status === 422)) setFallback({ url: request.url, error: err.message });
        else setError(err.message);
        throw err;
      } finally {
        setPending((p) => p.filter((x) => x.tag !== tag));
      }
    },
    [dispatch, body, state.avatar.sex]
  );

  // Pieces sent from the bookmarklet arrive in the URL hash.
  useEffect(() => {
    const m = window.location.hash.match(/^#import=(.+)$/);
    if (!m) return;
    history.replaceState(null, '', window.location.pathname);
    try {
      const { url, page } = JSON.parse(decodeURIComponent(m[1]));
      runImport({ url, page }, page?.title || url).catch(() => {});
    } catch {
      setError('That import link was damaged. Try the bookmarklet again.');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changeKind = (piece, kind) => {
    dispatch({ type: 'update', id: piece.id, patch: { kind, slot: KIND_SLOTS[kind] } });
    // Re-cut the photos for the new type (model shots are cropped by type).
    if (piece.url && !piece.sources?.includes('manual') && !piece.sources?.includes('bookmarklet')) {
      importPiece({ url: piece.url, kind })
        .then((fresh) => dispatch({ type: 'update', id: piece.id, patch: { textures: fresh.textures, color: fresh.color, photos: fresh.photos } }))
        .catch(() => {});
    } else if (piece.textures?.front?.source && !piece.textures.front.source.startsWith('data:')) {
      recutPiece({ image: piece.textures.front.source, ref: piece.url, kind })
        .then((fresh) => dispatch({ type: 'update', id: piece.id, patch: { textures: { ...fresh.textures, back: piece.textures.back }, color: fresh.color } }))
        .catch(() => {});
    }
  };

  // "Use this photo": the user overrides which product photo dresses the model.
  const usePhoto = (piece, image) =>
    recutPiece({ image, ref: piece.url, kind: piece.kind }).then((fresh) =>
      dispatch({ type: 'update', id: piece.id, patch: { textures: fresh.textures, color: fresh.color } })
    );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          fit<span>check</span>
        </div>
        <AddPiece busy={pending.length > 0} onAdd={(url) => runImport({ url }, url).catch(() => {})} />
      </header>
      {error && (
        <div className="toast" role="alert">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <main className="layout">
        <aside className="left">
          <AvatarPanel avatar={state.avatar} onChange={(patch) => dispatch({ type: 'avatar', patch })} />
        </aside>

        <section className="stage">
          {mode === 'photo' ? (
            <PhotoStage avatar={state.avatar} outfit={outfit} onShow3d={() => setMode('3d')} />
          ) : (
            <Scene avatar={state.avatar} outfit={outfit} sizes={state.sizes} view={view} autoRotate={autoRotate} />
          )}
          <div className="stage-tools">
            <button className={mode === 'photo' ? 'on' : ''} onClick={() => setMode('photo')}>Photo</button>
            <button className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>3D</button>
            {mode === '3d' && (
              <>
                <span className="sep" />
                {Object.keys(VIEWS).map((v) => (
                  <button key={v} className={view.name === v ? 'on' : ''} onClick={() => setView((p) => ({ name: v, n: p.n + 1 }))}>
                    {v === 'full' ? 'Head to toe' : v[0].toUpperCase() + v.slice(1)}
                  </button>
                ))}
                <button className={autoRotate ? 'on' : ''} onClick={() => setAutoRotate((r) => !r)}>
                  {autoRotate ? 'Stop' : 'Spin 360°'}
                </button>
              </>
            )}
          </div>
          {mode === '3d' && <div className="stage-hint">Drag to rotate · scroll or pinch to zoom · right-drag to move</div>}
          {outfit.length > 0 && (
            <div className="outfit-bar">
              <span>Wearing {outfit.length} piece{outfit.length > 1 ? 's' : ''}</span>
              {total > 0 && <strong>{formatPrice(total, outfit[0].currency)}</strong>}
              <button onClick={() => dispatch({ type: 'undressAll' })}>Take all off</button>
            </div>
          )}
          {state.pieces.length === 0 && pending.length === 0 && (
            <div className="empty">
              <h1>Try on clothes from any store</h1>
              <p>Paste a product link above. Mix pants from one store with a sweater from another and see them together on your model.</p>
            </div>
          )}
        </section>

        <aside className="right">
          <div className="right-head">
            <h2>
              Saved pieces <b>{state.pieces.length}</b>
            </h2>
            <button className="link" onClick={() => setFallback({ url: '', error: '' })}>
              Other ways to add
            </button>
          </div>
          <div className="pieces">
            {pending.map((p) => (
              <div key={p.tag} className="piece loading">
                <div className="spinner" />
                <div>
                  <div className="piece-title">Reading the product page…</div>
                  <div className="muted small ellipsis">{p.label}</div>
                </div>
              </div>
            ))}
            {state.pieces.map((piece) => (
              <PieceCard
                key={piece.id}
                piece={piece}
                wearing={state.wearing.includes(piece.id)}
                size={state.sizes[piece.id]}
                body={body}
                sex={state.avatar.sex}
                onWear={() => dispatch({ type: 'wear', id: piece.id })}
                onTakeOff={() => dispatch({ type: 'takeOff', id: piece.id })}
                onSize={(size) => dispatch({ type: 'size', id: piece.id, size })}
                onKind={(kind) => changeKind(piece, kind)}
                onUsePhoto={(image) => usePhoto(piece, image)}
                onRemove={() => dispatch({ type: 'remove', id: piece.id })}
              />
            ))}
            {state.pieces.length === 0 && pending.length === 0 && <p className="muted pad">Every piece you add is saved here with a link back to buy it.</p>}
          </div>
        </aside>
      </main>

      {fallback && <FallbackDialog state={fallback} onClose={() => setFallback(null)} onSubmit={(req) => runImport(req, req.page.title).catch(() => {})} />}
    </div>
  );
}
