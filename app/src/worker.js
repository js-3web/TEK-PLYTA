// Wątek obliczeniowy (Web Worker): liczy w tle, okno aplikacji reaguje na kliknięcia.
import { runProject } from '../../src/app/pipeline.js';

self.onmessage = ({ data }) => {
  if (data.type !== 'run') return;
  try {
    const res = runProject(data.project, (stage, frac) => self.postMessage({ type: 'progress', stage, frac }));
    // mapy jako bufory przenoszone (bez kopiowania)
    const transfer = res.ok ? Object.values(res.maps).map(a => a.buffer) : [];
    self.postMessage({ type: 'result', res }, transfer);
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message, stack: e.stack });
  }
};
