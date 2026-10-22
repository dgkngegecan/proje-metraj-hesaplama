import { useState } from 'react';
import { api } from '../../../api';
import type { DatabaseBackup, DatabaseIntegrity } from '../../../types';
import { Icon } from '../../components';
import { EmptyState, ErrorState, ScreenHeader, SkeletonList, Spinner, notify } from '../../shell';
import { actions } from '../../store';
import { ConfirmSheet } from '../library/shared/ConfirmSheet';
import { CLEAR_PROJECTS_PHRASE } from '../library/shared/confirmText';
import { Notice, Section } from '../library/shared/FormParts';
import { perform } from '../library/shared/perform';
import { reloadEverything, resourceKeys, useBackups, useIntegrity } from './settingsData';
import { INTEGRITY_TEXT, backupMeta, integrityState } from './settingsModel';

/**
 * Yedekler ve veri güvenliği: bütünlük denetimi, elle yedek, yedekten geri yükleme ve
 * bütün proje verilerini temizleme. Son ikisi mevcut veriyi değiştirir; önceden ayrıca
 * otomatik yedek alınır ama yine de güçlü onay istenir.
 */
export function BackupsPanel() {
  const backups = useBackups();
  const integrity = useIntegrity();
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [restoring, setRestoring] = useState<DatabaseBackup | null>(null);
  const [clearing, setClearing] = useState(false);

  const state = integrityState(integrity.data);

  const createBackup = async () => {
    setCreating(true);
    const result = await perform(() => api.post('/database/backups'), {
      success: 'Yedek alındı.',
      error: 'Yedek alınamadı.',
    });
    setCreating(false);
    if (result.ok) actions.invalidateResources(resourceKeys.backups);
  };

  const checkIntegrity = async () => {
    setChecking(true);
    const result = await perform(() => api.get<DatabaseIntegrity>('/database/integrity'), {
      error: 'Veriler kontrol edilemedi.',
    });
    setChecking(false);
    if (!result.ok) return;
    // Sonucu önbelleğe yaz: ikinci bir istek atmadan ekran ve Ayarlar özeti güncellenir.
    await actions.loadResource(resourceKeys.integrity, async () => result.value);
    notify(result.value.isHealthy ? 'Veriler sağlam.' : 'Verilerde sorun bulundu. Son yedeği geri yükleyin.');
  };

  const restore = async () => {
    if (!restoring) return false;
    const result = await perform(() => api.post('/database/backups/restore', { fullPath: restoring.fullPath }), {
      success: 'Yedek geri yüklendi.',
      error: 'Yedek geri yüklenemedi.',
    });
    if (!result.ok) return false;
    await reloadEverything();
  };

  const clearProjects = async () => {
    const result = await perform(() => api.delete<{ deletedProjectCount: number }>('/database/projects'), {
      success: (value) => `${value.deletedProjectCount} proje silindi. Öncesinde yedek alındı.`,
      error: 'Projeler temizlenemedi.',
    });
    if (!result.ok) return false;
    await reloadEverything();
  };

  return (
    <div className="m-detail">
      <ScreenHeader title="Yedekler ve güvenlik" />
      <div className="m-detail__scroll">
        <Section title="Veri kontrolü">
          <div className={`m-set-integrity m-set-integrity--${state}`} role="status" aria-live="polite">
            <Icon name={state === 'healthy' ? 'check' : 'warning'} size={24} />
            <span>
              <strong>{INTEGRITY_TEXT[state]}</strong>
              <small>
                {integrity.status === 'loading' && !integrity.data
                  ? 'Kontrol ediliyor…'
                  : integrity.status === 'error'
                    ? integrity.error
                    : (integrity.data?.details ?? 'Kontrol sonucu henüz alınmadı.')}
              </small>
            </span>
          </div>
          <button
            type="button"
            className="m-btn m-btn--secondary"
            disabled={checking}
            onClick={() => void checkIntegrity()}
          >
            {checking ? <Spinner size={18} /> : <Icon name="refresh" size={18} />}
            {checking ? 'Kontrol ediliyor…' : 'Şimdi kontrol et'}
          </button>
        </Section>

        <Section title="Yedekler">
          <button
            type="button"
            className="m-btn m-btn--primary m-btn--large"
            disabled={creating}
            onClick={() => void createBackup()}
          >
            {creating ? <Spinner size={20} /> : <Icon name="download" size={20} />}
            {creating ? 'Yedekleniyor…' : 'Şimdi yedekle'}
          </button>
          {!backups.data && backups.status !== 'error' ? (
            <SkeletonList rows={3} label="Yedekler okunuyor" />
          ) : !backups.data ? (
            <ErrorState message={backups.error} onRetry={() => backups.reload()} />
          ) : backups.data.length === 0 ? (
            <EmptyState
              icon="download"
              title="Henüz yedek yok"
              message="“Şimdi yedekle” ile verilerin bugünkü hâlini saklayın."
            />
          ) : (
            <ul className="m-set-backups" aria-label="Yedekler">
              {backups.data.map((backup) => (
                <li key={backup.fullPath} className="m-set-backup">
                  <span className="m-set-backup__text">
                    <strong>{backup.fileName}</strong>
                    <small>{backupMeta(backup)}</small>
                  </span>
                  <button
                    type="button"
                    className="m-btn m-btn--secondary m-btn--small m-btn--danger-text"
                    onClick={() => setRestoring(backup)}
                    aria-label={`${backup.fileName} yedeğini geri yükle`}
                  >
                    Geri yükle
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Geri alınamaz işlemler">
          <Notice tone="warning">
            Bütün projeleri, revizyonları, yerleşimleri, metrajları, notları ve hesap geçmişini kaldırır. Kart
            kütüphanesi ve genel ayarlar korunur. İşlemden hemen önce otomatik bir güvenlik yedeği alınır.
          </Notice>
          <button type="button" className="m-btn m-btn--danger m-btn--large" onClick={() => setClearing(true)}>
            <Icon name="trash" size={20} />
            Bütün projeleri temizle
          </button>
        </Section>
      </div>

      <ConfirmSheet
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        title="Bu yedeğe dönülsün mü?"
        description={restoring ? `${restoring.fileName} · ${backupMeta(restoring)}` : undefined}
        confirmLabel="Yedeği geri yükle"
        acknowledge="Mevcut verilerin bu yedekle değişeceğini anlıyorum."
        onConfirm={restore}
      >
        <ul>
          <li>Şu anki bütün projeler ve ayarlar bu yedekteki hâle döner; yedekten sonra girilen veriler kaybolur.</li>
          <li>Geri yüklemeden hemen önce şu anki hâl ayrıca yedeklenir, gerekirse ona dönebilirsiniz.</li>
          <li>Uygulama verileri yeniden yükler.</li>
        </ul>
      </ConfirmSheet>
      <ConfirmSheet
        open={clearing}
        onClose={() => setClearing(false)}
        title="Bütün proje verileri temizlensin mi?"
        description="Bu işlem geri alınamaz."
        confirmLabel="Evet, projeleri temizle"
        phrase={CLEAR_PROJECTS_PHRASE}
        onConfirm={clearProjects}
      >
        <ul>
          <li>Bütün projeler, revizyonlar, kartlar, girişler ve notlar silinir.</li>
          <li>Kart kütüphanesi ve genel ayarlar (fire payları gibi) korunur.</li>
          <li>Silmeden önce otomatik yedek alınır; gerekirse geri dönebilirsiniz.</li>
        </ul>
      </ConfirmSheet>
    </div>
  );
}
