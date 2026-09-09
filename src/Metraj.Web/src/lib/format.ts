import type { MeasurementSummary, Placement } from '../types';

export function measurementVariantOf(measurement: { variant?: string | null; notes?: string | null }): string {
  return measurement.variant || measurement.notes?.match(/(?:Çap|Boyut):\s*([^·]+)/i)?.[1]?.trim() || '';
}

export function parseDecimal(input: string): number {
  return Number(input.replace(',', '.'));
}

export function quantity(value: number) {
  // Rapor çıktılarıyla aynı hassasiyet. 3 basamakla sınırlıyken 0,0004 gibi
  // küçük ama geçerli bir miktar ekranda ve Excel'de 0 görünüyor, PDF'te
  // görünüyordu; kullanıcı ya sıfır sanıp veriyi siliyor ya da iki çıktının
  // çeliştiğini görüyordu. Sondaki sıfırlar yine gösterilmez.
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 6 }).format(value);
}

export function purchaseUnit(summary: MeasurementSummary) {
  return summary.purchaseUnit || (summary.unit === 'm' && summary.variant ? 'boy' : summary.unit);
}

export function makeCardCode(name: string) {
  const stem = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase()
    .slice(0, 18);
  return `${stem || 'KART'}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Radyatör girişinin açılıp açılmayacağını belirler.
 *
 * Öncelik sırası: kartın malzeme ailesi -> katalog kodu -> (son çare) görünen ad.
 * Ad, kullanıcının serbestçe değiştirebildiği bir alandır; tek ölçüt olarak
 * kullanılması yeniden adlandırmayı davranış değişikliğine dönüştürüyordu.
 */
export function isRadiatorPlacement(placement: Placement) {
  const family = placement.materialType ?? '';
  if (/radiator|radyat[öo]r/i.test(family)) return true;
  if (/(^|-)(RAD|RADYATOR)(-|$)/i.test(placement.cardCode)) return true;
  return /radyat[öo]r/i.test(placement.displayName);
}

export function measurementLabel(notes?: string | null) {
  const radiator = notes?.match(/Radyatör:\s*([^·]+)\s*·\s*Yükseklik:\s*([^·]+)\s*·\s*Genişlik:\s*(.+)$/i);
  if (radiator)
    return `${(radiator[1] ?? '').trim()} · H${(radiator[2] ?? '').trim()} · W${(radiator[3] ?? '').trim()}`;
  return notes?.split(' · ')[0]?.trim() || 'Standart';
}
