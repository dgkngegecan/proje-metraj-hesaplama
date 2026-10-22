import { useEffect } from 'react';
import { actions, appStore, loadKeys } from '../../store';
import { useShell, type NestedRoute } from '../../shell';
import { CardDetail } from './CardDetail';
import { CardForm } from './CardForm';
import { CardList } from './CardList';
import { CardTypesScreen, TypeForm } from './CardTypes';
import './library.css';

/**
 * Kütüphane sekmesi: kart listesi (kök) ve iç içe ekranlar.
 *
 *   card      {id}     kart ayrıntısı (sürüm, varyantlar, nitelikler)
 *   card-form {id?}    yeni kart / yeni sürüm (tam ekran form)
 *   types              özel kart türleri
 *   type-form          yeni kart türü
 *
 * Kök liste ve alttaki katmanlar bağlı kalır (gizli): geri dönünce kaydırma konumu ve
 * yarım yazılmış arama korunur.
 */
export default function LibraryScreen() {
  const stack = useShell((state) => state.stacks.library);

  useEffect(() => {
    // Katalog açılışta yüklenmez (açılış bütçesi); kütüphane ilk açıldığında gelir.
    const status = appStore.getState().loads[loadKeys.catalog]?.status;
    if (!status || status === 'idle') void actions.loadCatalog();
  }, []);

  return (
    <div className="m-screen m-stack">
      <div className="m-stack__layer" hidden={stack.length > 0}>
        <CardList />
      </div>
      {stack.map((route, index) => (
        <div
          key={`${index}:${route.screen}:${route.params?.id ?? ''}`}
          className="m-stack__layer"
          hidden={index !== stack.length - 1}
        >
          <RouteView route={route} />
        </div>
      ))}
    </div>
  );
}

function RouteView({ route }: { route: NestedRoute }) {
  switch (route.screen) {
    case 'card':
      return <CardDetail cardId={route.params?.id ?? ''} />;
    case 'card-form':
      return <CardForm cardId={route.params?.id ?? null} />;
    case 'types':
      return <CardTypesScreen />;
    case 'type-form':
      return <TypeForm />;
    default:
      return null;
  }
}
