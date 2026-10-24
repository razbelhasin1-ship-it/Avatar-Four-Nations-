import { renderMapRaster } from './mapRender';

/** Renders the parchment world map off the main thread. Message: { size } → { size, px }. */
self.onmessage = (e: MessageEvent<{ size: number }>) => {
  const size = Math.max(64, Math.min(2048, Math.floor(e.data?.size ?? 512)));
  const px = renderMapRaster(size);
  self.postMessage({ size, px }, { transfer: [px.buffer] });
};
