import { quantity } from '../lib/format';
import type {
  CalculationResult,
  CalculationRule,
  DatabaseBackup,
  DatabaseIntegrity,
  MaterialWasteSetting,
  Placement,
  ResponsibilityData,
  Revision,
} from '../types';

export function AdvancedControls(props: {
  inline?: boolean;
  revisions: Revision[];
  selectedRevisionId: string;
  canEdit: boolean;
  busy: boolean;
  rules: CalculationRule[];
  results: CalculationResult[];
  responsibilities: ResponsibilityData | null;
  backups: DatabaseBackup[];
  integrity: DatabaseIntegrity | null;
  wasteSettings: MaterialWasteSetting[];
  wasteDraft: { materialType: string; wasteRatePct: string };
  placements: Placement[];
  selectedPlacementId: string | null;
  calculationTargetId: string;
  calculationSourceId: string;
  ruleDraft: { code: string; name: string; multiplier: string };
  dimensionDraft: { code: string; name: string };
  partyDraft: { code: string; name: string };
  assignmentDraft: { dimensionId: string; partyId: string; placementId: string; state: string };
  onClose: () => void;
  onSelectRevision: (id: string) => void;
  onCreateDraft: () => void;
  onApproveRevision: () => void;
  onRuleDraft: (value: { code: string; name: string; multiplier: string }) => void;
  onCreateRule: () => void;
  onCalculationTarget: (id: string) => void;
  onCalculationSource: (id: string) => void;
  onLinkCalculationSource: () => void;
  onRunCalculation: (ruleId: string) => void;
  onReviewCalculation: (resultId: string, decision: 'approve' | 'reject') => void;
  onOverrideCalculation: (result: CalculationResult) => void;
  onDimensionDraft: (value: { code: string; name: string }) => void;
  onPartyDraft: (value: { code: string; name: string }) => void;
  onAssignmentDraft: (value: { dimensionId: string; partyId: string; placementId: string; state: string }) => void;
  onWasteDraft: (value: { materialType: string; wasteRatePct: string }) => void;
  onSaveWaste: () => void;
  onEditWaste: (setting: MaterialWasteSetting) => void;
  onDeleteWaste: (setting: MaterialWasteSetting) => void;
  onCreateDimension: () => void;
  onCreateParty: () => void;
  onAssign: () => void;
  onCreateBackup: () => void;
  onCheckIntegrity: () => void;
  onRestoreBackup: (backup: DatabaseBackup) => void;
}) {
  const { responsibilities } = props;
  const targetId = props.calculationTargetId || props.selectedPlacementId || '';
  const pendingResults = props.results.filter((result) => result.status === 'PendingReview');
  return (
    <div
      className={props.inline ? 'settings-inline' : 'modal-backdrop advanced-backdrop'}
      onMouseDown={props.inline ? undefined : props.onClose}
    >
      <div
        className={props.inline ? 'settings-inline-body' : 'modal advanced-modal'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {!props.inline && (
          <button className="modal-close" onClick={props.onClose}>
            ×
          </button>
        )}
        <span className="eyebrow">AYARLAR</span>
        <h2>Proje ve hesap ayarları</h2>
        <p>Fire payları, sürümler, kontrollü hesaplar, sorumluluklar ve veri güvenliği aynı ekranda.</p>
        <div className="advanced-grid">
          <section className="advanced-card">
            <span className="advanced-icon">01</span>
            <h3>Sürüm</h3>
            <label>
              Çalışılan sürüm
              <select value={props.selectedRevisionId} onChange={(event) => props.onSelectRevision(event.target.value)}>
                {props.revisions.map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    {revision.code} · {revision.status === 'Draft' ? 'düzenlenebilir' : 'onaylı'}
                  </option>
                ))}
              </select>
            </label>
            <div className="inline-actions">
              <button disabled={props.busy} onClick={props.onCreateDraft}>
                + Düzenleme kopyası
              </button>
              <button className="primary" disabled={!props.canEdit || props.busy} onClick={props.onApproveRevision}>
                Bu sürümü onayla
              </button>
            </div>
            <small>Onaylanan sürüm korunur; değişiklik için yeni bir kopya açılır.</small>
          </section>

          <section className="advanced-card">
            <span className="advanced-icon">02</span>
            <h3>Hesap önerisi</h3>
            <p className="compact-note">
              Serbest kod yoktur. Kural, kaynak miktarı güvenli bir çarpanla öneriye dönüştürür.
            </p>
            <div className="mini-form three">
              <label>
                Kod
                <input
                  placeholder="Örn. DIRSEK"
                  value={props.ruleDraft.code}
                  onChange={(event) => props.onRuleDraft({ ...props.ruleDraft, code: event.target.value })}
                />
              </label>
              <label>
                Ad
                <input
                  placeholder="Örn. Dirsek payı"
                  value={props.ruleDraft.name}
                  onChange={(event) => props.onRuleDraft({ ...props.ruleDraft, name: event.target.value })}
                />
              </label>
              <label>
                Çarpan
                <input
                  inputMode="decimal"
                  value={props.ruleDraft.multiplier}
                  onChange={(event) => props.onRuleDraft({ ...props.ruleDraft, multiplier: event.target.value })}
                />
              </label>
            </div>
            <button className="full" disabled={!props.canEdit || props.busy} onClick={props.onCreateRule}>
              Kuralı ekle
            </button>
            <label>
              Hesaplanacak ek parça
              <select value={targetId} onChange={(event) => props.onCalculationTarget(event.target.value)}>
                <option value="">Kart seç</option>
                {props.placements
                  .filter((placement) => placement.isMeasurable)
                  .map((placement) => (
                    <option key={placement.id} value={placement.id}>
                      {placement.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <div className="calculation-link">
              <label>
                Bu hesabın kaynak kartı
                <select
                  value={props.calculationSourceId}
                  onChange={(event) => props.onCalculationSource(event.target.value)}
                >
                  <option value="">Kaynak seç</option>
                  {props.placements
                    .filter((placement) => placement.isMeasurable && placement.id !== targetId)
                    .map((placement) => (
                      <option key={placement.id} value={placement.id}>
                        {placement.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={!props.canEdit || props.busy || !targetId || !props.calculationSourceId}
                onClick={props.onLinkCalculationSource}
              >
                Kaynağı bağla
              </button>
            </div>
            <small className="compact-note">
              Örnek: Boru kartını kaynak, dirsek veya te kartını hesaplanacak ek parça olarak seç.
            </small>
            <div className="rule-list">
              {props.rules.length ? (
                props.rules
                  .filter((rule) => rule.isActive)
                  .map((rule) => (
                    <div key={rule.id}>
                      <span>
                        <b>{rule.code}</b> · ×{quantity(rule.multiplier)}
                      </span>
                      <button
                        disabled={!props.canEdit || props.busy || !targetId}
                        onClick={() => props.onRunCalculation(rule.id)}
                      >
                        Öner
                      </button>
                    </div>
                  ))
              ) : (
                <small>Henüz kural yok.</small>
              )}
            </div>
            {pendingResults.length > 0 && (
              <div className="review-list">
                {pendingResults.map((result) => (
                  <div key={result.id}>
                    <span>
                      <b>{result.targetPlacementName}</b>
                      <small>
                        {quantity(result.proposedQuantity)} {result.unit} önerildi
                      </small>
                    </span>
                    <button
                      disabled={!props.canEdit || props.busy}
                      onClick={() => props.onReviewCalculation(result.id, 'approve')}
                    >
                      Onayla
                    </button>
                    <button disabled={!props.canEdit || props.busy} onClick={() => props.onOverrideCalculation(result)}>
                      Elle düzelt
                    </button>
                    <button
                      className="danger-link"
                      disabled={!props.canEdit || props.busy}
                      onClick={() => props.onReviewCalculation(result.id, 'reject')}
                    >
                      Reddet
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="advanced-card waste-settings-card">
            <span className="advanced-icon">03</span>
            <h3>Malzeme fire payları</h3>
            <p className="compact-note">
              Aynı malzeme ailesindeki bütün kartlara uygulanacak oranı tanımla. Bu kural, kartın varsayılan fire oranı
              yerine kullanılır; aile kuralı yoksa kart oranı geçerlidir.
            </p>
            <div className="mini-form two">
              <label>
                Malzeme ailesi
                <input
                  placeholder="Örn. Galvaniz Çelik Boru"
                  value={props.wasteDraft.materialType}
                  onChange={(event) => props.onWasteDraft({ ...props.wasteDraft, materialType: event.target.value })}
                />
              </label>
              <label>
                Fire payı (%)
                <input
                  inputMode="decimal"
                  placeholder="5"
                  value={props.wasteDraft.wasteRatePct}
                  onChange={(event) => props.onWasteDraft({ ...props.wasteDraft, wasteRatePct: event.target.value })}
                />
              </label>
            </div>
            <button className="full" disabled={props.busy} onClick={props.onSaveWaste}>
              Fire kuralını kaydet
            </button>
            <div className="waste-list">
              {props.wasteSettings.length ? (
                props.wasteSettings.map((setting) => (
                  <div key={setting.id}>
                    <span>
                      <b>{setting.materialType}</b>
                      <small>%{quantity(setting.wasteRatePct)} fire</small>
                    </span>
                    <div className="inline-actions">
                      <button disabled={props.busy} onClick={() => props.onEditWaste(setting)}>
                        Düzenle
                      </button>
                      <button
                        className="danger-link"
                        disabled={props.busy}
                        onClick={() => props.onDeleteWaste(setting)}
                      >
                        Sil
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <small>Henüz malzeme ailesi için ayrı fire kuralı yok.</small>
              )}
            </div>
          </section>

          <section className="advanced-card">
            <span className="advanced-icon">04</span>
            <h3>Sorumluluk</h3>
            <p className="compact-note">
              “Temin”, “montaj” gibi alanlar sabit değildir; ihtiyacın kadar yeni boyut ekleyebilirsin.
            </p>
            <div className="mini-form two">
              <label>
                Boyut kodu
                <input
                  placeholder="Örn. MONTAJ"
                  value={props.dimensionDraft.code}
                  onChange={(event) => props.onDimensionDraft({ ...props.dimensionDraft, code: event.target.value })}
                />
              </label>
              <label>
                Boyut adı
                <input
                  placeholder="Örn. Montaj"
                  value={props.dimensionDraft.name}
                  onChange={(event) => props.onDimensionDraft({ ...props.dimensionDraft, name: event.target.value })}
                />
              </label>
            </div>
            <button disabled={!props.canEdit || props.busy} onClick={props.onCreateDimension}>
              Boyut ekle
            </button>
            <div className="mini-form two">
              <label>
                Taraf kodu
                <input
                  placeholder="Örn. TAŞERON"
                  value={props.partyDraft.code}
                  onChange={(event) => props.onPartyDraft({ ...props.partyDraft, code: event.target.value })}
                />
              </label>
              <label>
                Taraf adı
                <input
                  placeholder="Örn. Boru Ustası"
                  value={props.partyDraft.name}
                  onChange={(event) => props.onPartyDraft({ ...props.partyDraft, name: event.target.value })}
                />
              </label>
            </div>
            <button disabled={!props.canEdit || props.busy} onClick={props.onCreateParty}>
              Taraf ekle
            </button>
            <div className="mini-form two assignment-form">
              <label>
                Boyut
                <select
                  value={props.assignmentDraft.dimensionId}
                  onChange={(event) =>
                    props.onAssignmentDraft({ ...props.assignmentDraft, dimensionId: event.target.value })
                  }
                >
                  <option value="">Seç</option>
                  {responsibilities?.dimensions.map((dimension) => (
                    <option key={dimension.id} value={dimension.id}>
                      {dimension.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Taraf
                <select
                  value={props.assignmentDraft.partyId}
                  onChange={(event) =>
                    props.onAssignmentDraft({ ...props.assignmentDraft, partyId: event.target.value })
                  }
                >
                  <option value="">Atanmamış</option>
                  {responsibilities?.parties.map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kart
                <select
                  value={props.assignmentDraft.placementId || props.selectedPlacementId || ''}
                  onChange={(event) =>
                    props.onAssignmentDraft({ ...props.assignmentDraft, placementId: event.target.value })
                  }
                >
                  <option value="">Seç</option>
                  {props.placements.map((placement) => (
                    <option key={placement.id} value={placement.id}>
                      {placement.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Durum
                <select
                  value={props.assignmentDraft.state}
                  onChange={(event) => props.onAssignmentDraft({ ...props.assignmentDraft, state: event.target.value })}
                >
                  <option value="Assigned">Sorumlu</option>
                  <option value="Excluded">Hariç</option>
                  <option value="Optional">Opsiyonel</option>
                  <option value="Unassigned">Atanmamış</option>
                </select>
              </label>
            </div>
            <button className="full" disabled={!props.canEdit || props.busy} onClick={props.onAssign}>
              Kart sorumluluğunu kaydet
            </button>
            {responsibilities?.assignments.length ? (
              <small className="count-note">{responsibilities.assignments.length} sorumluluk kaydı var.</small>
            ) : (
              <small className="count-note">Henüz sorumluluk kaydı yok.</small>
            )}
          </section>

          <section className="advanced-card">
            <span className="advanced-icon">05</span>
            <h3>Güvenlik</h3>
            <div className={`integrity ${props.integrity?.isHealthy ? 'healthy' : 'warning'}`}>
              <b>{props.integrity?.isHealthy ? '✓ Veritabanı sağlam' : 'Kontrol bekliyor'}</b>
              <small>{props.integrity?.details ?? 'Kontrol sonucu henüz alınmadı.'}</small>
            </div>
            <div className="inline-actions">
              <button disabled={props.busy} onClick={props.onCheckIntegrity}>
                Kontrol et
              </button>
              <button className="primary" disabled={props.busy} onClick={props.onCreateBackup}>
                Şimdi yedekle
              </button>
            </div>
            <div className="backup-list">
              {props.backups.length ? (
                props.backups.slice(0, 4).map((backup) => (
                  <div key={backup.fullPath}>
                    <span>
                      <b>{backup.fileName}</b>
                      <small>
                        {new Date(backup.createdAtUtc).toLocaleString('tr-TR')} ·{' '}
                        {Math.max(1, Math.round(backup.sizeBytes / 1024))} KB
                      </small>
                    </span>
                    <button className="danger-link" disabled={props.busy} onClick={() => props.onRestoreBackup(backup)}>
                      Geri yükle
                    </button>
                  </div>
                ))
              ) : (
                <small>Henüz yedek yok.</small>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
