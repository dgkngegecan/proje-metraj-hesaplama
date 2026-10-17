import { notifyError, notifySuccess } from '../../../shell';
import { actions } from '../../../store';

export type PerformResult<T> = { ok: true; value: T } | { ok: false };

/**
 * Bir kullanıcı işlemini çalıştırır: üst çubukta meşgul çizgisi yanar, hata
 * sunucunun Türkçe metniyle bildirilir (`notifyError`), başarı titreşimli
 * bildirilir. Çağıran yalnız `ok` bilgisine bakar; hata ayrıca fırlatılmaz.
 *
 * Neden: masaüstünde her işlem kendi `withBusy` + `try/catch` bloğunu
 * yazıyordu; birinde bildirim unutulunca kullanıcı işlemin olup olmadığını
 * anlayamıyordu.
 */
export async function perform<T>(
  work: () => Promise<T>,
  options: { success?: string | ((value: T) => string | null); error?: string } = {},
): Promise<PerformResult<T>> {
  try {
    const value = await actions.withBusy(work);
    const message = typeof options.success === 'function' ? options.success(value) : options.success;
    if (message) notifySuccess(message);
    return { ok: true, value };
  } catch (error) {
    notifyError(error, options.error);
    return { ok: false };
  }
}
