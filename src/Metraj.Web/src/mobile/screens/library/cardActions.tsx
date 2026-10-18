import { api } from '../../../api';
import type { CatalogCard } from '../../../types';
import { notify } from '../../shell';
import { actions, appStore, patch, removeWithUndo } from '../../store';
import { ConfirmSheet } from './shared/ConfirmSheet';
import { perform } from './shared/perform';

/**
 * Pasife alma geri alınabilir bir işlem gibi sunulur: kart hemen pasif görünür, alt
 * çubukta "Geri al" çıkar ve istek ancak süre dolunca gider. (Sunucuda pasifi yeniden
 * etkinleştiren bir uç nokta yok; bu yüzden 5 saniyelik pencere tek geri dönüş yoludur.)
 */
export function deactivateCard(card: CatalogCard, onCommitted?: () => void) {
  removeWithUndo(appStore, {
    ops: [patch.upsert('cards', [{ ...card, isActive: false }])],
    commit: () => api.post(`/catalog/cards/${card.id}/deactivate`),
    message: `“${card.name}” pasife alındı.`,
    errorMessage: 'Kart pasife alınamadı.',
    onCommitted: () => {
      void actions.loadCatalog();
      onCommitted?.();
    },
  });
}

/**
 * Kalıcı silme onay paneli. Sunucu, projelerde kullanılan kartı silmez, pasife alır;
 * panel bunu önceden söyler ve sonuçta hangisinin olduğunu bildirir.
 */
export function DeleteCardSheet({
  card,
  onClose,
  onDeleted,
}: {
  card: CatalogCard | null;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  return (
    <ConfirmSheet
      open={card !== null}
      onClose={onClose}
      title={card ? `“${card.name}” silinsin mi?` : 'Kart silinsin mi?'}
      description="Bu işlem geri alınamaz."
      confirmLabel="Kalıcı olarak sil"
      onConfirm={async () => {
        if (!card) return;
        const result = await perform(() => api.delete(`/catalog/cards/${card.id}`), { error: 'Kart silinemedi.' });
        if (!result.ok) return false;
        await actions.loadCatalog();
        const remains = appStore.getState().entities.cards.byId.has(card.id);
        notify(
          remains ? `“${card.name}” projelerde kullanıldığı için silinmedi, pasife alındı.` : `“${card.name}” silindi.`,
        );
        onDeleted?.();
      }}
    >
      <ul>
        <li>Kart kütüphaneden kalıcı olarak silinir.</li>
        <li>Projelerde kullanılıyorsa silinmez, pasife alınır; projeler etkilenmez.</li>
        <li>Kartı yalnızca gizlemek için “Pasife al”ı kullanın.</li>
      </ul>
    </ConfirmSheet>
  );
}
