/**
 * Phones and tablets versus computers. The game is made for touch screens; on a computer the site
 * points visitors to their phone (with a QR code) and only plays here if they insist.
 */
export function isTouchDevice(): boolean {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua);
  // iPadOS reports itself as a Mac with a touch screen.
  const iPad = typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return coarse || mobileUa || iPad;
}

/** This site's address, opened straight on Play: what the QR code on a computer carries. */
export function phoneUrl(): string {
  return `${location.origin}${location.pathname}#play`;
}
