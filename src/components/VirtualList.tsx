import {
  type KeyboardEventHandler,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

/**
 * A list of equal-height rows that renders only the ones in view (plus a few around them): a directory of several
 * thousand people stays as light as one of ten. It is a listbox: the row at `activeIndex` is the one the keyboard is
 * on (`aria-activedescendant`), and the list scrolls to keep it in view.
 */
export function VirtualList({
  ref,
  count,
  rowHeight,
  activeIndex,
  renderRow,
  onRange,
  onKeyDown,
  label,
  id,
  overscan = 6,
  className,
}: {
  /** The scrolling element, for focusing the list. */
  ref?: Ref<HTMLDivElement>;
  count: number;
  rowHeight: number;
  activeIndex: number | null;
  renderRow: (index: number) => ReactNode;
  /** Told which rows are showing, to load more of them. */
  onRange?: (start: number, end: number) => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  label: string;
  id: string;
  overscan?: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => box.current as HTMLDivElement);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h && h > 0) setViewport(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the keyboard's row in view: only moves the scroll position, never any state.
  useEffect(() => {
    const el = box.current;
    if (!el || activeIndex === null) return;
    const top = activeIndex * rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight > el.scrollTop + el.clientHeight && el.clientHeight > 0) {
      el.scrollTop = top + rowHeight - el.clientHeight;
    }
  }, [activeIndex, rowHeight]);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);

  useEffect(() => {
    onRange?.(start, end);
  }, [start, end, onRange]);

  const rows: ReactNode[] = [];
  for (let i = start; i < end; i++) {
    rows.push(
      <div
        key={i}
        id={`${id}-${i}`}
        role="option"
        aria-selected={i === activeIndex}
        aria-posinset={i + 1}
        aria-setsize={count}
        className="absolute inset-x-0"
        style={{ top: i * rowHeight, height: rowHeight }}
      >
        {renderRow(i)}
      </div>,
    );
  }

  return (
    <div
      ref={box}
      id={id}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={activeIndex === null ? undefined : `${id}-${activeIndex}`}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
      className={cn(
        "focus-visible:ring-ring/50 relative overflow-y-auto rounded-xl outline-none focus-visible:ring-[3px]",
        className,
      )}
    >
      <div className="relative" style={{ height: count * rowHeight }}>
        {rows}
      </div>
    </div>
  );
}
