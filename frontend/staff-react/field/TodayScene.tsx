import { AppointmentLookup } from './AppointmentLookup';
import { WarrantyLookupButton } from './WarrantyLookup';
import type { Appointment, Home } from './types';
import { CountBadge } from '../DataValue';
import { useEffect, useId, useRef, useState } from 'react';
import { Search, ClipboardPlus, ChevronDown } from 'lucide-react';

function Orders({
  title,
  items,
  empty,
  pending = false,
  onSelect
}: {
  title: string;
  items: Appointment[];
  empty: string;
  pending?: boolean;
  onSelect: (id: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState({ above: false, below: 0 });
  useEffect(() => {
    const media = window.matchMedia('(max-width: 600px)');
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const element = viewport.current;
    const list = content.current;
    if (!element || !list) return;
    const measure = () => {
      const rows = [...list.children];
      if (rows.length && element.clientHeight) {
        const heights = rows.slice(0, 5).map((row) => row.getBoundingClientRect().height);
        const limit =
          heights.length >= 5
            ? heights.slice(0, 4).reduce((total, height) => total + height, 0) + heights[4] / 2
            : heights[0] * 4.5;
        element.style.setProperty('--today-order-expanded-height', `${limit + 8}px`);
      }
      const edge = element.getBoundingClientRect().bottom + 3;
      const above = element.scrollTop > 3;
      const below =
        element.scrollHeight - element.clientHeight - element.scrollTop > 3
          ? [...list.children].filter((row) => row.getBoundingClientRect().bottom > edge).length
          : 0;
      setHidden((current) =>
        current.above === above && current.below === below ? current : { above, below }
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(list);
    element.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', measure);
    };
  }, [items, pending, mobile, collapsed]);
  return (
    <section className="field-card today-orders" aria-busy={pending}>
      <h2 className="today-section-title">
        {mobile ? (
          <button
            type="button"
            className="today-order-heading-toggle"
            aria-expanded={!collapsed}
            aria-controls={listId}
            onClick={() => setCollapsed((value) => !value)}
          >
            <span>{title}</span>
            <CountBadge label={`${title}数量`} value={pending ? undefined : items.length} />
            <ChevronDown className="today-order-heading-chevron" size={18} aria-hidden="true" />
          </button>
        ) : (
          <>
            {title}
            <CountBadge label={`${title}数量`} value={pending ? undefined : items.length} />
          </>
        )}
      </h2>
      <div
        id={listId}
        hidden={mobile && collapsed}
        className="today-order-scroll"
        data-above={hidden.above}
        data-below={hidden.below > 0}
      >
        <div
          className="today-order-viewport"
          ref={viewport}
          tabIndex={items.length ? 0 : undefined}
          role="region"
          aria-label={`${title}列表，可滚动查看`}
        >
          <div ref={content} className="today-order-content">
            {items.map((item) => (
              <button className="today-order" key={item.id} onClick={() => onSelect(item.id)}>
                <strong>
                  {item.name} · {item.brand} {item.deviceModel || item.deviceType}
                </strong>
                <span className="today-order-number">{item.id}</span>
                <span>
                  {item.date} · {item.timeSlot}
                </span>
                <span className="today-order-facts">
                  <span>{item.faultType}</span>
                  {item.receivedAt && <span>接收：{item.receivedByName || item.receivedBy}</span>}
                  {item.assignedToName && <span>主修：{item.assignedToName}</span>}
                </span>
                <span className="today-order-action">
                  查看工单 <span aria-hidden="true">→</span>
                </span>
              </button>
            ))}
            {!items.length && (
              <p className="today-order-summary">
                <span
                  className={pending ? 'today-pending-copy' : undefined}
                  aria-hidden={pending || undefined}
                >
                  {empty}
                </span>
              </p>
            )}
          </div>
        </div>
        {hidden.below > 0 && (
          <button
            type="button"
            className="today-order-more"
            aria-label={`向下查看其余 ${hidden.below} 单`}
            onClick={() => viewport.current?.scrollBy({ top: viewport.current.clientHeight * 0.8 })}
          >
            <span>
              还有 {hidden.below} 单
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </button>
        )}
      </div>
    </section>
  );
}

export function TodayScene({
  active,
  data,
  busy,
  pending = false,
  onSelect,
  onRegister
}: {
  active: boolean;
  data: Home;
  busy: boolean;
  pending?: boolean;
  onSelect: (id: string) => void;
  onRegister: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchArea = useRef<HTMLDivElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const searchId = useId();
  useEffect(() => {
    if (!searchOpen || !active) return;
    searchArea.current?.querySelector('input')?.focus();
    function closeOutside(event: PointerEvent) {
      if (!searchArea.current?.contains(event.target as Node)) setSearchOpen(false);
    }
    function closeKeyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSearchOpen(false);
        searchTrigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeKeyboard);
    };
  }, [searchOpen, active]);
  const items = data.appointments || [];
  const waiting = items.filter(
    (item) => item.status === 'booked' && !item.receivedAt && item.date === data.businessDate
  );
  const received = items.filter((item) => item.status === 'booked' && item.receivedAt);
  const otherRepairs = items.filter(
    (item) => item.status === 'in_progress' && item.assignedMemberId !== data.actor.memberId
  );
  return (
    <div className="today-scene">
      <section className="today-tools">
        <h2 className="today-section-title">开始工作</h2>
        <div className="today-toolbar">
          <div className="today-work-shortcuts">
            {data.capability['onsite.create'] && (
              <button disabled={busy} onClick={onRegister}>
                <ClipboardPlus size={18} />
                现场登记
              </button>
            )}
            <WarrantyLookupButton />
            <div
              className="today-search-anchor"
              ref={searchArea}
              onBlur={(event) => {
                if (
                  event.relatedTarget &&
                  !event.currentTarget.contains(event.relatedTarget as Node)
                )
                  setSearchOpen(false);
              }}
            >
              <button
                ref={searchTrigger}
                disabled={busy}
                aria-expanded={searchOpen && active}
                aria-controls={searchId}
                onClick={() => setSearchOpen((open) => !open)}
              >
                <Search size={18} />
                查询工单
              </button>
              {searchOpen && active && (
                <div className="today-search-panel" id={searchId}>
                  <AppointmentLookup
                    active={active}
                    disabled={busy}
                    label="查找工单"
                    hideLabel
                    onSelect={(id) => {
                      setSearchOpen(false);
                      onSelect(id);
                    }}
                    campusId={data.campusId}
                    searchCapabilities={data.searchCapabilities}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
      <div className="field-work-grid today-work">
        <Orders
          title="今日待接收"
          items={waiting}
          empty="今日没有待接收工单"
          pending={pending}
          onSelect={onSelect}
        />
        <Orders
          title="已接收待维修"
          items={received}
          empty="没有已接收待维修工单"
          pending={pending}
          onSelect={onSelect}
        />
        {data.capability['repair.start'] && (
          <Orders
            title="本人正在维修"
            items={data.repairs || []}
            empty="暂无进行中的维修"
            pending={pending}
            onSelect={onSelect}
          />
        )}
        {!!otherRepairs.length && (
          <Orders title="其他人员正在维修" items={otherRepairs} empty="" onSelect={onSelect} />
        )}
      </div>
      {!!data.pendingPhotos?.length && (
        <Orders title="待补传接收照片" items={data.pendingPhotos} empty="" onSelect={onSelect} />
      )}
    </div>
  );
}
