import { useState } from 'react';
import { api } from '../../../api';
import type { WorkspaceImportResult } from '../../../types';
import { Icon } from '../../components';
import { BottomSheet, ScreenHeader, Spinner, notify, shellActions } from '../../shell';
import { actions } from '../../store';
import { ConfirmSheet } from '../library/shared/ConfirmSheet';
import { Notice, Section } from '../library/shared/FormParts';
import { perform } from '../library/shared/perform';
import { formatByteSize } from '../output/reportModel';
import { reloadAfterAddition } from './settingsData';
import { importIsEmpty, importSummaryLines, sampleMessage } from './settingsModel';

interface SampleResult {
  project: { id: string; name: string };
  alreadyExisted: boolean;
  importedPlacementCount: number;
  importedMeasurementCount: number;
}

/**
 * Çalışma alanı: bütün projeleri ve kütüphaneyi tek `.metraj` dosyasında dışa aktarma, başka
 * bir dosyadan mevcut veriye EKLEME ve sentetik örnek. İçe aktarmada onay çağrıdan ÖNCE
 * sorulur: köprüde dosya seçimi ve içe aktarma tek adımdır, seçimden sonra durdurulamaz.
 */
export function WorkspacePanel() {
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'import' | 'sample' | null>(null);
  const [imported, setImported] = useState<WorkspaceImportResult | null>(null);

  const exportWorkspace = async () => {
    setExporting(true);
    setExportNote(null);
    const result = await perform(() => api.download('/workspace/export', 'ProjeMetraj.metraj'), {
      error: 'Veriler dışa aktarılamadı.',
    });
    setExporting(false);
    if (!result.ok) return;
    const { outcome, name, size } = result.value;
    setExportNote(
      outcome === 'cancelled'
        ? 'Dışa aktarma iptal edildi.'
        : `${name} (${formatByteSize(size)}) ${outcome === 'share' ? 'paylaşıma hazırlandı' : outcome === 'saveAs' ? 'cihaza kaydedildi' : 'indirildi'}.`,
    );
  };

  const importWorkspace = async () => {
    const result = await perform(() => api.importWorkspace(), { error: 'Dosya içe aktarılamadı.' });
    if (!result.ok) return false;
    if (result.value === null) {
      notify('İçe aktarma iptal edildi.');
      return;
    }
    await reloadAfterAddition();
    setImported(result.value);
  };

  const loadSample = async () => {
    const result = await perform(() => api.post<SampleResult>('/synthetic-clean-water'), {
      error: 'Örnek proje yüklenemedi.',
    });
    if (!result.ok) return false;
    await reloadAfterAddition();
    const sample = result.value;
    notify(sampleMessage(sample), {
      action: {
        label: 'Aç',
        onAction: () => {
          shellActions.setTab('project');
          void actions.selectProject(sample.project.id);
        },
      },
    });
  };

  return (
    <div className="m-detail">
      <ScreenHeader title="Veri aktarımı" />
      <div className="m-detail__scroll">
        <Section title="Dışa aktar">
          <p className="m-muted">
            Bütün projeler, kütüphane ve fire payları tek bir <strong>.metraj</strong> dosyasında toplanır. Dosyayı
            yedek olarak saklayabilir ya da başka bir cihaza taşıyabilirsiniz.
          </p>
          <button
            type="button"
            className="m-btn m-btn--primary m-btn--large"
            disabled={exporting}
            onClick={() => void exportWorkspace()}
          >
            {exporting ? <Spinner size={20} /> : <Icon name="upload" size={20} />}
            {exporting ? 'Hazırlanıyor…' : 'Verileri dışa aktar'}
          </button>
          <p className="m-set-status" role="status" aria-live="polite">
            {exporting ? 'Dosya hazırlanıyor; çok proje varsa birkaç saniye sürebilir.' : (exportNote ?? '')}
          </p>
        </Section>

        <Section title="İçe aktar">
          <p className="m-muted">
            Başka bir <strong>.metraj</strong> dosyasındaki yeni projeler ve eksik kütüphane kayıtları mevcut verilere
            eklenir. Mevcut veriler silinmez; aynı projeler atlanır.
          </p>
          <button type="button" className="m-btn m-btn--secondary m-btn--large" onClick={() => setConfirm('import')}>
            <Icon name="download" size={20} />
            Dosyadan içe aktar
          </button>
        </Section>

        <Section title="Örnek proje">
          <Notice tone="info">
            Örnek Temiz Su projesi <strong>gerçek veri değildir</strong>; uygulamayı denemek içindir. Gerçek işlerinizde
            kullanmayın.
          </Notice>
          <button type="button" className="m-btn m-btn--secondary m-btn--large" onClick={() => setConfirm('sample')}>
            <Icon name="plus" size={20} />
            Örnek projeyi yükle
          </button>
        </Section>
      </div>

      <ConfirmSheet
        open={confirm === 'import'}
        onClose={() => setConfirm(null)}
        title="Dosya içe aktarılsın mı?"
        description="Onaylarsanız dosya seçici açılır; seçtiğiniz dosya hemen içe aktarılır."
        tone="primary"
        confirmLabel="Dosya seç ve içe aktar"
        onConfirm={importWorkspace}
      >
        <ul>
          <li>Dosyadaki yeni projeler ve eksik kütüphane kayıtları eklenir.</li>
          <li>Mevcut projeler, kartlar ve ayarlar silinmez ya da değiştirilmez.</li>
          <li>Dosyayı seçtikten sonra işlem durdurulamaz; vazgeçmek için seçiciyi kapatın.</li>
        </ul>
      </ConfirmSheet>
      <ConfirmSheet
        open={confirm === 'sample'}
        onClose={() => setConfirm(null)}
        title="Örnek proje yüklensin mi?"
        description="Gerçek veri değildir; denemek içindir."
        tone="primary"
        confirmLabel="Örneği yükle"
        onConfirm={loadSample}
      >
        <ul>
          <li>Örnek Temiz Su projesi ve kullandığı kartlar eklenir.</li>
          <li>Zaten yüklüyse tekrar eklenmez.</li>
          <li>Mevcut projelerinize dokunulmaz.</li>
        </ul>
      </ConfirmSheet>
      <BottomSheet
        open={imported !== null}
        onClose={() => setImported(null)}
        title="İçe aktarma tamamlandı"
        footer={
          <button
            type="button"
            className="m-btn m-btn--primary m-btn--large m-btn--block"
            onClick={() => setImported(null)}
          >
            Tamam
          </button>
        }
      >
        {imported && (
          <div className="m-confirm" role="status">
            {importIsEmpty(imported) ? <p>Dosyadaki her şey zaten mevcut; yeni bir şey eklenmedi.</p> : null}
            <ul>
              {importSummaryLines(imported).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
