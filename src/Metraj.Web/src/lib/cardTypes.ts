import type { CardType } from '../types';

/**
 * Kart tipinin görünen adı, rengi ve simgesi.
 *
 * Önceden `uiTypes.ts` içindeydi; o dosya React Flow düğüm tipini de
 * tanımladığı için `@xyflow/react`'i içe aktarıyor. Telefon arayüzü React
 * Flow'u paketine almamalı, ama kart tipi etiketlerine ve katalog destelerine
 * (`catalogDecks.ts`) ihtiyaç duyuyor. Tablo bu yüzden bağımlılıksız bir
 * modüle taşındı; `uiTypes.ts` aynı değeri yeniden dışa aktarır.
 */
export const TYPE_META: Record<CardType, { label: string; color: string; icon: string }> = {
  Category: { label: 'Kategori', color: '#b58cff', icon: '◆' },
  Scope: { label: 'Kapsam', color: '#ffc65b', icon: '◈' },
  System: { label: 'Sistem', color: '#50caff', icon: '◉' },
  Material: { label: 'Malzeme', color: '#62e3ad', icon: '●' },
  Accessory: { label: 'Ek parça', color: '#ff86aa', icon: '✦' },
};
