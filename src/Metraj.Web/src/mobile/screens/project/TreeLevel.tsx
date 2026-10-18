import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { quantity } from '../../../lib/format';
import type { Placement } from '../../../types';
import { Icon, SearchableList, SwipeRow, haptic, matchesQuery } from '../../components';
import { EmptyState, ErrorState, ScreenHeader, SkeletonList } from '../../shell';
import {
  actions,
  draftKey,
  loadKeys,
  useDraft,
  useIsRevisionLocked,
  useLoad,
  usePlacements,
  useRevisionSummaries,
  useSelection,
} from '../../store';
import { ChipStrip } from './ChipStrip';
import { useProjectController } from './projectController';
import {
  breadcrumb,
  buildChildIndex,
  flattenTree,
  isEnterable,
  levelRows,
  searchEntries,
  type Crumb,
} from './treeModel.ts';
import { totalsByPlacement, type PlacementTotals } from './totals.ts';
import { TypeGlyph } from './TypeGlyph';

interface RowModel {
  placement: Placement;
  childCount: number;
  depth: number;
  /** Arama sonuçlarında üst yol. */
  path?: string;
  /** Arama sonuçlarında sadeleştirilmiş metin (liste bileşeninin süzgeci aynı sonucu versin diye). */
  folded?: string;
}

type ViewMode = 'level' | 'tree';
const isViewMode = (value: unknown): value is ViewMode => value === 'level' || value === 'tree';

/**
 * Proje ağacının bir seviyesi (klasör gezgini). `levelId` null ise kök.
 * Satır dokunuşu: ölçülebilir kart → giriş sayfası, klasör → alt seviye.
 * Ölçülebilir kartın altında kart varsa satırın sağındaki ayrı düğme alt
 * seviyeyi açar (en sık iş olan miktar girişi tek dokunuşta kalsın diye).
 */
export function TreeLevel({ levelId }: { levelId: string | null }) {
  const { revisionId } = useSelection();
  const placements = usePlacements(revisionId);
  const summaries = useRevisionSummaries(revisionId);
  const locked = useIsRevisionLocked();
  const load = useLoad(revisionId ? loadKeys.revision(revisionId) : 'revision:none');
  const controller = useProjectController();
  const index = useMemo(() => buildChildIndex(placements), [placements]);
  const totals = useMemo(() => totalsByPlacement(summaries), [summaries]);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [storedMode, setMode] = useDraft<ViewMode>(draftKey('mobile-project-view', 'mode'), 'level');
  const mode: ViewMode = isViewMode(storedMode) ? storedMode : 'level';
  const level = levelId ? (index.byId.get(levelId) ?? null) : null;
  const crumbs = useMemo(() => breadcrumb(index, levelId), [index, levelId]);

  const searching = deferredQuery.trim().length > 0;
  const rows = useMemo<readonly RowModel[]>(() => {
    if (searching) {
      return searchEntries(placements)
        .filter((entry) => matchesQuery(entry.folded, deferredQuery))
        .map((entry) => ({
          placement: entry.placement,
          childCount: entry.childCount,
          depth: 0,
          path: entry.path,
          folded: entry.folded,
        }));
    }
    if (mode === 'tree' && !levelId)
      return flattenTree(placements).map((row) => ({
        placement: row.placement,
        childCount: row.childCount,
        depth: row.depth,
      }));
    return levelRows(index, levelId).map((row) => ({ ...row, depth: 0 }));
  }, [searching, deferredQuery, mode, levelId, placements, index]);

  const open = useCallback(
    (row: { placement: Placement }) => {
      haptic('tick');
      if (row.placement.isMeasurable) controller.openEntry(row.placement.id);
      else controller.openLevel(row.placement.id);
    },
    [controller],
  );

  if (!revisionId) return <SkeletonList />;
  if (!placements.length && (load.status === 'loading' || load.status === 'idle')) return <SkeletonList />;
  if (!placements.length && load.status === 'error')
    return <ErrorState message={load.error} onRetry={() => void actions.refreshRevision()} />;

  const emptyHere = searching ? (
    <EmptyState icon="search" title="Eşleşen kart yok" message="Başka bir sözcükle deneyin; bütün ağaçta aranır." />
  ) : levelId ? (
    <EmptyState
      icon="project"
      title="Bu kartın altında henüz kart yok"
      message={locked ? 'Revizyon onaylı olduğu için kart eklenemez.' : '“Kart ekle” ile ilk alt kartı ekleyin.'}
    />
  ) : (
    <EmptyState
      icon="project"
      title="Bu revizyonda henüz kart yok"
      message={
        locked
          ? 'Revizyon onaylı olduğu için kart eklenemez.'
          : 'Önce bir sistem kartı, altına malzeme kartları ekleyin.'
      }
      action={
        locked ? undefined : (
          <button type="button" className="m-btn m-btn--primary m-btn--large" onClick={() => controller.addCard(null)}>
            <Icon name="plus" />
            İlk kartı ekle
          </button>
        )
      }
    />
  );

  return (
    <>
      {level && (
        <ScreenHeader
          title={level.displayName}
          subtitle={`${level.cardCode}${rows.length ? ` · ${rows.length} alt kart` : ''}`}
          actions={
            <>
              {isEnterable(level) && (
                <button
                  type="button"
                  className="m-icon-button"
                  aria-label={`${level.displayName} giriş sayfası`}
                  onClick={() => controller.openEntry(level.id)}
                >
                  <Icon name="edit" />
                </button>
              )}
              <button
                type="button"
                className="m-icon-button"
                aria-label="Kart eylemleri"
                onClick={() => controller.openMenu(level.id)}
              >
                <Icon name="more" />
              </button>
            </>
          }
        />
      )}
      <div className="m-proj-toolbar">
        <Crumbs crumbs={crumbs} onJump={(id) => controller.jumpToLevel(id)} />
        {!levelId && placements.length > 0 && (
          <ChipStrip<ViewMode>
            label="Görünüm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'level', label: 'Klasör' },
              { value: 'tree', label: 'Tam ağaç' },
            ]}
          />
        )}
      </div>
      <SearchableList<RowModel>
        items={rows}
        getKey={(row) => (row.path !== undefined ? `s:${row.placement.id}` : row.placement.id)}
        ariaLabel={level ? `${level.displayName} alt kartları` : 'Proje ağacı'}
        estimateSize={84}
        query={query}
        onQueryChange={setQuery}
        searchText={(row) => row.folded ?? ''}
        searchPlaceholder="Kartlarda ara (bütün ağaç)"
        emptyState={emptyHere}
        bottomPadding={8}
        renderItem={(row) => (
          <TreeRow
            row={row}
            total={totals.get(row.placement.id)}
            locked={locked}
            onOpen={open}
            onChildren={controller.openLevel}
            onMenu={controller.openMenu}
          />
        )}
      />
      {!locked && (
        <div className="m-bottom-actions">
          <button
            type="button"
            className="m-btn m-btn--primary m-btn--large m-btn--block"
            onClick={() => controller.addCard(levelId)}
          >
            <Icon name="plus" />
            Kart ekle
          </button>
        </div>
      )}
    </>
  );
}

/** Yol göstergesi: Proje › Sistem › Boru. Son parça mevcut seviyedir. */
function Crumbs({ crumbs, onJump }: { crumbs: readonly Crumb[]; onJump: (id: string | null) => void }) {
  if (crumbs.length < 2) return null;
  return (
    <nav className="m-proj-crumbs" aria-label="Konum">
      {crumbs.map((crumb, position) => {
        const last = position === crumbs.length - 1;
        return (
          <span key={`${crumb.id ?? 'root'}:${position}`} className="m-proj-crumbs__item">
            {position > 0 && <Icon name="chevronRight" size={16} className="m-proj-crumbs__sep" />}
            <button
              type="button"
              className="m-proj-crumbs__button"
              aria-current={last ? 'page' : undefined}
              disabled={last}
              onClick={() => onJump(crumb.id)}
            >
              {crumb.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

const TreeRow = memo(function TreeRow({
  row,
  total,
  locked,
  onOpen,
  onChildren,
  onMenu,
}: {
  row: RowModel;
  total: PlacementTotals | undefined;
  locked: boolean;
  onOpen: (row: RowModel) => void;
  onChildren: (placementId: string) => void;
  onMenu: (placementId: string, mode?: 'menu' | 'move') => void;
}) {
  const { placement, childCount, depth, path } = row;
  // Uzun basmanın ardından gelen tıklama satırı bir de açmasın.
  const menuOpened = useRef(false);
  const showMenu = () => {
    menuOpened.current = true;
    onMenu(placement.id);
  };
  const press = () => {
    if (menuOpened.current) {
      menuOpened.current = false;
      return;
    }
    onOpen(row);
  };
  const subOpensLevel = placement.isMeasurable && childCount > 0;
  const details = [
    placement.cardCode,
    childCount ? `${childCount} alt kart` : '',
    total ? `${total.entries} giriş` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <SwipeRow
      actions={
        locked
          ? []
          : [
              {
                id: 'move',
                label: 'Taşı',
                icon: 'upload',
                tone: 'neutral',
                onAction: () => onMenu(placement.id, 'move'),
              },
              { id: 'menu', label: 'Eylemler', icon: 'more', tone: 'primary', onAction: () => onMenu(placement.id) },
            ]
      }
      onLongPress={showMenu}
    >
      <div
        className={`m-proj-row m-proj-row--${placement.cardType.toLowerCase()}`}
        style={{ ['--m-depth' as string]: Math.min(depth, 8) }}
        onPointerDownCapture={() => {
          menuOpened.current = false;
        }}
      >
        <span className="m-proj-row__stripe" aria-hidden="true" />
        <button type="button" className="m-proj-row__main" onClick={press}>
          <TypeGlyph type={placement.cardType} />
          <span className="m-proj-row__text">
            <strong>{placement.displayName}</strong>
            <small>{details}</small>
            {path && <small className="m-proj-row__path">{path}</small>}
            {total && (
              <span className="m-proj-pills m-num">
                <span className="m-proj-pill">
                  Net {quantity(total.net)} {total.unit}
                </span>
                <span className="m-proj-pill">Fireli {quantity(total.withWaste)}</span>
                <span className="m-proj-pill m-proj-pill--buy">
                  Alım {quantity(total.purchase)} {total.purchaseUnit}
                </span>
              </span>
            )}
          </span>
        </button>
        {subOpensLevel ? (
          <button
            type="button"
            className="m-proj-row__sub"
            aria-label={`${placement.displayName} alt kartları (${childCount})`}
            onClick={() => onChildren(placement.id)}
          >
            <span className="m-num">{childCount}</span>
            <Icon name="chevronRight" size={20} />
          </button>
        ) : (
          <Icon name="chevronRight" size={20} className="m-proj-row__chevron" />
        )}
      </div>
    </SwipeRow>
  );
});
