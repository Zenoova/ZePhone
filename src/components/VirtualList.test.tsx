import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VirtualList } from "./VirtualList";

const row = (i: number) => <span>Ligne {i}</span>;

describe("VirtualList", () => {
  it("renders only the rows in view out of thousands", () => {
    render(<VirtualList id="l" label="Contacts" count={5000} rowHeight={60} activeIndex={null} renderRow={row} />);
    const options = screen.getAllByRole("option");
    expect(options.length).toBeLessThan(30); // ten in view (600 px) and a few around them, not 5 000
    expect(screen.getByText("Ligne 0")).toBeInTheDocument();
    expect(screen.queryByText("Ligne 4000")).toBeNull();
    // the scrollbar is the size of the whole list
    expect(screen.getByRole("listbox").firstElementChild).toHaveStyle({ height: "300000px" });
  });

  it("describes its place to assistive technology", () => {
    render(<VirtualList id="l" label="Contacts" count={5000} rowHeight={60} activeIndex={2} renderRow={row} />);
    expect(screen.getByRole("listbox", { name: "Contacts" })).toHaveAttribute("aria-activedescendant", "l-2");
    const third = screen.getAllByRole("option")[2]!;
    expect(third).toHaveAttribute("aria-selected", "true");
    expect(third).toHaveAttribute("aria-posinset", "3");
    expect(third).toHaveAttribute("aria-setsize", "5000");
  });

  it("shows other rows when scrolled and says which rows are showing", () => {
    const onRange = vi.fn();
    render(
      <VirtualList
        id="l"
        label="Contacts"
        count={5000}
        rowHeight={60}
        activeIndex={null}
        renderRow={row}
        onRange={onRange}
      />,
    );
    expect(onRange).toHaveBeenLastCalledWith(0, expect.any(Number));
    const box = screen.getByRole("listbox");
    box.scrollTop = 60 * 1000;
    fireEvent.scroll(box);
    expect(screen.getByText("Ligne 1005")).toBeInTheDocument();
    expect(screen.queryByText("Ligne 0")).toBeNull();
    const [start, end] = onRange.mock.lastCall as [number, number];
    expect(start).toBeGreaterThan(990);
    expect(end).toBeLessThan(1030);
  });

  it("hands key presses to the page", () => {
    const onKeyDown = vi.fn();
    render(
      <VirtualList
        id="l"
        label="Contacts"
        count={10}
        rowHeight={60}
        activeIndex={0}
        renderRow={row}
        onKeyDown={onKeyDown}
      />,
    );
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for an empty list", () => {
    render(<VirtualList id="l" label="Contacts" count={0} rowHeight={60} activeIndex={null} renderRow={row} />);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});
