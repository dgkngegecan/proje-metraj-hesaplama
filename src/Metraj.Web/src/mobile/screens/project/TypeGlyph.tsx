import type { CardType } from '../../../types';

const SHAPES: Record<CardType, string> = {
  // Klasör, altıgen, halka, dolu daire, yıldız: renk körlüğünde de ayırt edilsin diye şekil de değişir.
  Category: 'M3 7h7l2 2h9v10H3z',
  Scope: 'M12 3l7.5 4.3v9.4L12 21l-7.5-4.3V7.3z',
  System: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  Material: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z',
  Accessory: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
};

/** Kart tipinin küçük simgesi; rengi `--type-*` değişkenlerinden gelir. Süs olduğu için ekran okuyucuya gizlidir. */
export function TypeGlyph({ type, size = 22 }: { type: CardType; size?: number }) {
  return (
    <svg
      className={`m-proj-glyph m-proj-glyph--${type.toLowerCase()}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={SHAPES[type]} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
