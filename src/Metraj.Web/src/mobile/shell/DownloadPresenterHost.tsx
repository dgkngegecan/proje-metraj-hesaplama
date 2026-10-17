import { useEffect, useRef, useState } from 'react';
import { setDownloadPresenter, type DownloadAction } from '../../api';
import type { BridgeFile } from '../../lib/transport.ts';
import { Icon } from '../components/Icon';
import { BottomSheet } from './BottomSheet';

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

/**
 * Köprüde `api.download` dosyayı hazırladıktan sonra kullanıcıya ne yapılacağını
 * sorar: sistem paylaşım menüsü (WhatsApp, e-posta…) ya da "farklı kaydet" (SAF).
 * Tarayıcıda bu panel hiç açılmaz; dosya doğrudan indirilir.
 */
export function DownloadPresenterHost() {
  const [pending, setPending] = useState<BridgeFile | null>(null);
  const resolver = useRef<((action: DownloadAction | null) => void) | null>(null);

  useEffect(
    () =>
      setDownloadPresenter(
        (file) =>
          new Promise<DownloadAction | null>((resolve) => {
            // Önceki soru yanıtsız kaldıysa vazgeçilmiş sayılır.
            resolver.current?.(null);
            resolver.current = resolve;
            setPending(file);
          }),
      ),
    [],
  );

  const finish = (action: DownloadAction | null) => {
    resolver.current?.(action);
    resolver.current = null;
    setPending(null);
  };

  const size = pending ? formatFileSize(pending.size) : '';
  return (
    <BottomSheet
      open={pending !== null}
      onClose={() => finish(null)}
      title="Dosya hazır"
      description={pending ? `${pending.name}${size ? ` · ${size}` : ''}` : undefined}
    >
      <div className="m-action-list">
        <button type="button" className="m-action-row" onClick={() => finish('share')}>
          <Icon name="share" />
          <span>
            <strong>Paylaş</strong>
            <small>E-posta, mesajlaşma veya başka bir uygulamayla gönder</small>
          </span>
        </button>
        <button type="button" className="m-action-row" onClick={() => finish('saveAs')}>
          <Icon name="download" />
          <span>
            <strong>Cihaza kaydet</strong>
            <small>Klasörü ve dosya adını seç</small>
          </span>
        </button>
      </div>
    </BottomSheet>
  );
}
