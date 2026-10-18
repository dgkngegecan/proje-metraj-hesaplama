import { api } from '../../../api';
import { isBridgeAvailable } from '../../../lib/transport.ts';
import { version as interfaceVersion } from '../../../../package.json';
import { Icon } from '../../components';
import { ScreenHeader } from '../../shell';
import { useResource } from '../../store';
import { Notice, Section } from '../library/shared/FormParts';
import { resourceKeys } from './settingsData';
import { dataLocationLabel } from './settingsModel';

interface Health {
  status: string;
  version?: string;
  dataLocation?: string | null;
}

/**
 * Uygulama hakkında: sürüm, verinin yeri ve "tamamen yerel çalışır" güvencesi.
 * Sürüm ve veri klasörü `/api/health`'ten gelir; eski bir çekirdek bildirmezse genel metin
 * gösterilir. Masaüstünde yolun yalnız klasör adı görünür (bkz. `dataLocationLabel`).
 */
export function AboutPanel() {
  const health = useResource(resourceKeys.health, () => api.get<Health>('/health'));
  const native = isBridgeAvailable();
  return (
    <div className="m-detail">
      <ScreenHeader title="Uygulama hakkında" />
      <div className="m-detail__scroll">
        <Section title="Proje Metraj">
          <dl className="m-facts">
            <div className="m-facts__row">
              <dt>Arayüz sürümü</dt>
              <dd>{interfaceVersion}</dd>
            </div>
            <div className="m-facts__row">
              <dt>Uygulama sürümü</dt>
              <dd>{health.data?.version ?? (native ? 'Android uygulaması' : 'Geliştirme / masaüstü')}</dd>
            </div>
            <div className="m-facts__row">
              <dt>Yerel servis</dt>
              <dd>
                {health.status === 'error'
                  ? 'Yanıt vermiyor'
                  : health.data?.status === 'ok'
                    ? 'Çalışıyor'
                    : 'Denetleniyor…'}
              </dd>
            </div>
            <div className="m-facts__row">
              <dt>Veri konumu</dt>
              <dd>{dataLocationLabel(health.data?.dataLocation, native)}</dd>
            </div>
          </dl>
        </Section>
        <Section title="Gizlilik">
          <Notice tone="success">
            <strong>Tamamen yerel çalışır.</strong> Uygulamanın internet izni yoktur; projeleriniz, kütüphaneniz ve
            raporlarınız cihazınızdan dışarı çıkmaz.
          </Notice>
          <ul className="m-set-list">
            <li>
              <strong>
                <Icon name="lock" size={16} /> Veriler yalnız bu cihazdadır
              </strong>
              <small>Başka uygulamalar veritabanınızı okuyamaz; sistem yedeğine de dahil edilmez.</small>
            </li>
            <li>
              <strong>Dışarı çıkan tek şey sizin paylaştığınız dosyadır</strong>
              <small>
                Raporlar ve .metraj dosyaları yalnız “Paylaş” ya da “Cihaza kaydet” dediğinizde, seçtiğiniz yere gider.
              </small>
            </li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
