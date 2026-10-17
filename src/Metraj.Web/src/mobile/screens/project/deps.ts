import { api } from '../../../api';
import { notifyError } from '../../shell';
import { appStore } from '../../store';
import type { SaveDeps } from './entrySave.ts';

/** Ölçüm kayıtlarının gerçek bağımlılıkları: tekil depo, gerçek API, hata → alt bilgi çubuğu. */
export const saveDeps: SaveDeps = {
  store: appStore,
  api,
  feedback: { error: notifyError },
};
