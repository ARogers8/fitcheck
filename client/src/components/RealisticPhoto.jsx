import { useEffect, useRef, useState } from 'react';
import { renderPhoto, fileToDataUrl } from '../api.js';

// Photoreal view of the current outfit, generated on the server by a try-on model.
// Renders are cached by outfit so flipping back and forth doesn't cost another one.
const cache = new Map();

export default function RealisticPhoto({ avatar, outfit, onClose }) {
  const [myPhoto, setMyPhoto] = useState(null);
  const [state, setState] = useState({ status: 'idle' });
  const fileRef = useRef(null);
  const key = JSON.stringify([avatar, outfit.map((p) => [p.id, p.kind, p.textures?.front?.source]), myPhoto?.slice(-64)]);

  useEffect(() => {
    let live = true;
    if (cache.has(key)) {
      setState({ status: 'done', ...cache.get(key) });
      return undefined;
    }
    setState({ status: 'working' });
    renderPhoto({ avatar, outfit, modelImage: myPhoto })
      .then((out) => {
        cache.set(key, out);
        if (live) setState({ status: 'done', ...out });
      })
      .catch((e) => live && setState({ status: 'error', error: e.message }));
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (f) setMyPhoto(await fileToDataUrl(f, 1400));
  };

  return (
    <div className="realistic">
      <div className="realistic-frame">
        {state.status === 'working' && (
          <div className="realistic-wait">
            <div className="spinner" />
            <p>Dressing {myPhoto ? 'your photo' : 'a real-looking model'} in {outfit.length} piece{outfit.length > 1 ? 's' : ''}…</p>
          </div>
        )}
        {state.status === 'done' && <img src={state.image} alt="You in this outfit" />}
        {state.status === 'error' && <p className="realistic-error">{state.error}</p>}
      </div>
      <div className="realistic-tools">
        <button onClick={onClose}>Back to 3D</button>
        <button onClick={() => fileRef.current?.click()}>{myPhoto ? 'Change my photo' : 'Use my own photo'}</button>
        {myPhoto && <button className="ghost" onClick={() => setMyPhoto(null)}>Use the model</button>}
        {state.status === 'done' && (
          <a className="ghost" href={state.image} target="_blank" rel="noreferrer">Open full size ↗</a>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      </div>
      {state.skipped?.length > 0 && <p className="hint">Not shown in the photo: {state.skipped.join(', ')}.</p>}
      <p className="hint">A full-body photo, facing the camera, works best. Your photo is only sent to the try-on service to make this picture.</p>
    </div>
  );
}
