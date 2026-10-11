// App state, persisted to this browser.
import { useEffect, useReducer } from 'react';
import { DEFAULT_AVATAR } from './body/measurements.js';

const KEY = 'fitcheck.v1';

const initial = { avatar: DEFAULT_AVATAR, pieces: [], wearing: [], sizes: {} };

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) return { ...initial, ...saved, avatar: { ...DEFAULT_AVATAR, ...saved.avatar } };
  } catch {}
  return initial;
}

/** Takes off anything that can't be worn together with `piece`. */
function wearWith(state, piece) {
  const clash = (other) =>
    other.slot === piece.slot ||
    (piece.slot === 'dress' && (other.slot === 'base' || other.slot === 'bottom')) ||
    (other.slot === 'dress' && (piece.slot === 'base' || piece.slot === 'bottom'));
  const kept = state.wearing.filter((id) => {
    const other = state.pieces.find((p) => p.id === id);
    return other && !clash(other);
  });
  return [...kept, piece.id];
}

function reducer(state, action) {
  switch (action.type) {
    case 'avatar':
      return { ...state, avatar: { ...state.avatar, ...action.patch } };
    case 'add': {
      const pieces = [action.piece, ...state.pieces.filter((p) => p.url !== action.piece.url || !p.url)];
      const next = { ...state, pieces, sizes: { ...state.sizes, [action.piece.id]: action.size ?? null } };
      return { ...next, wearing: wearWith(next, action.piece) };
    }
    case 'update': {
      const pieces = state.pieces.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p));
      const next = { ...state, pieces };
      const piece = pieces.find((p) => p.id === action.id);
      return state.wearing.includes(action.id) && action.patch.slot ? { ...next, wearing: wearWith(next, piece) } : next;
    }
    case 'remove':
      return {
        ...state,
        pieces: state.pieces.filter((p) => p.id !== action.id),
        wearing: state.wearing.filter((id) => id !== action.id),
      };
    case 'wear': {
      const piece = state.pieces.find((p) => p.id === action.id);
      return piece ? { ...state, wearing: wearWith(state, piece) } : state;
    }
    case 'takeOff':
      return { ...state, wearing: state.wearing.filter((id) => id !== action.id) };
    case 'undressAll':
      return { ...state, wearing: [] };
    case 'size':
      return { ...state, sizes: { ...state.sizes, [action.id]: action.size } };
    default:
      return state;
  }
}

export function useFitcheckStore() {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }, [state]);
  return [state, dispatch];
}
