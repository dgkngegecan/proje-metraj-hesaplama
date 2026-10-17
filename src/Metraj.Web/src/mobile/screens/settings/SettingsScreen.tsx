import { useEffect, useState } from 'react';
import { api } from '../../../api';
import { ActionSheet, ChipGrid, Icon, setHapticsEnabled } from '../../components';
import {
  applyTheme,
  HAPTICS_KEY,
  notifyError,
  notifySuccess,
  REVISION_STATUS_LABEL,
  shellActions,
  THEME_KEY,
  type ThemePreference,
} from '../../shell';
import {
  actions,
  readSavedSelection,
  useDraft,
  useRevisionsOf,
  useSelectedProject,
  useSelectedRevision,
} from '../../store';

/*
 * YER TUTUCU — Dalga 2'de Ajan 6 bu klasörü doldurur (revizyon oluştur/onayla,
 * fire ayarları, hesap kuralları ve onayı, sorumluluklar, yedekler, bütünlük,
 * tüm projeleri temizle). Buradaki sürüm: tema ve titreşim tercihi (kalıcı
 * taslak), revizyon listesi, çalışma alanını dışa/içe aktarma.
 */

const THEME_OPTIONS = [
  { value: 'system', label: 'Sistem' },
  { value: 'light', label: 'Açık' },
  { value: 'dark', label: 'Koyu' },
] as const;

const HAPTIC_OPTIONS = [
  { value: 'on', label: 'Açık' },
  { value: 'off', label: 'Kapalı' },
] as const;

export default function SettingsScreen() {
  const [theme, setTheme] = useDraft<ThemePreference>(THEME_KEY, 'system');
  const [haptics, setHaptics] = useDraft<'on' | 'off'>(HAPTICS_KEY, 'on');
  const project = useSelectedProject();
  const selected = useSelectedRevision();
  const revisions = useRevisionsOf(project?.id ?? null);
  const [confirmImport, setConfirmImport] = useState(false);
  const [working, setWorking] = useState<'export' | 'import' | null>(null);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => setHapticsEnabled(haptics !== 'off'), [haptics]);

  const exportWorkspace = async () => {
    setWorking('export');
    try {
      const result = await api.download('/workspace/export', 'ProjeMetraj.metraj');
      if (result.outcome !== 'cancelled' && result.outcome !== 'share') notifySuccess(`${result.name} hazırlandı.`);
    } catch (error) {
      notifyError(error, 'Çalışma alanı dışa aktarılamadı.');
    } finally {
      setWorking(null);
    }
  };

  const importWorkspace = async () => {
    setWorking('import');
    try {
      const result = await api.importWorkspace();
      if (!result) return;
      await actions.bootstrap(readSavedSelection() ?? {});
      void actions.loadCatalog();
      notifySuccess(
        `${result.importedProjects} proje eklendi${result.skippedProjects ? `, ${result.skippedProjects} mevcut proje atlandı` : ''}.`,
      );
    } catch (error) {
      notifyError(error, 'Çalışma alanı içe aktarılamadı.');
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="m-screen m-settings">
      <div className="m-detail__scroll">
        <section className="m-section" aria-labelledby="m-settings-look">
          <h2 id="m-settings-look" className="m-section__title">
            Görünüm
          </h2>
          <ChipGrid mode="single" label="Tema" options={THEME_OPTIONS} value={theme} onChange={setTheme} columns={3} />
          <h3 className="m-section__subtitle">Titreşim</h3>
          <ChipGrid
            mode="single"
            label="Titreşim"
            options={HAPTIC_OPTIONS}
            value={haptics}
            onChange={setHaptics}
            columns={2}
          />
        </section>

        {project && (
          <section className="m-section" aria-labelledby="m-settings-revisions">
            <h2 id="m-settings-revisions" className="m-section__title">
              Revizyonlar · {project.name}
            </h2>
            <ul className="m-choice-list">
              {revisions.map((revision) => (
                <li key={revision.id}>
                  <button
                    type="button"
                    className="m-choice"
                    aria-current={revision.id === selected?.id ? 'true' : undefined}
                    onClick={() => {
                      shellActions.resetStacks();
                      void actions.selectRevision(revision.id);
                    }}
                  >
                    <span className="m-choice__text">
                      <strong>{revision.code}</strong>
                      <small>{REVISION_STATUS_LABEL[revision.status]}</small>
                    </span>
                    {revision.status !== 'Draft' && <Icon name="lock" label="Kilitli" />}
                    {revision.id === selected?.id && <Icon name="check" label="Seçili" />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="m-section" aria-labelledby="m-settings-workspace">
          <h2 id="m-settings-workspace" className="m-section__title">
            Çalışma alanı
          </h2>
          <div className="m-action-list">
            <button
              type="button"
              className="m-action-row"
              disabled={working !== null}
              onClick={() => void exportWorkspace()}
            >
              <Icon name="upload" />
              <span>
                <strong>{working === 'export' ? 'Hazırlanıyor…' : 'Dışa aktar'}</strong>
                <small>Bütün projeler ve kütüphane tek bir .metraj dosyasında</small>
              </span>
            </button>
            <button
              type="button"
              className="m-action-row"
              disabled={working !== null}
              onClick={() => setConfirmImport(true)}
            >
              <Icon name="download" />
              <span>
                <strong>{working === 'import' ? 'İçe aktarılıyor…' : 'İçe aktar'}</strong>
                <small>Başka bir cihazdan .metraj dosyası ekle</small>
              </span>
            </button>
          </div>
        </section>
      </div>
      <ActionSheet
        open={confirmImport}
        onClose={() => setConfirmImport(false)}
        title="Çalışma alanı eklensin mi?"
        description="Seçeceğiniz dosyadaki yeni projeler ve eksik kütüphane kayıtları eklenir. Mevcut veriler silinmez."
        actions={[
          {
            id: 'pick',
            label: 'Dosya seç ve içe aktar',
            icon: 'download',
            onSelect: () => void importWorkspace(),
          },
        ]}
      />
    </div>
  );
}
