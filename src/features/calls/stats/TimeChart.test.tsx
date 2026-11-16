import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TimeChart } from "./TimeChart";

const xs = [0, 1, 2, 3, 4];
const rx = { key: "rx", label: "Reçu", slot: 1 as const, values: [10, 12, 11, 40, 12] };
const tx = { key: "tx", label: "Envoyé", slot: 2 as const, values: [5, 6, null, 7, 8] };

describe("TimeChart", () => {
  it("says it is waiting when there is nothing to draw", () => {
    render(<TimeChart title="Gigue" xs={[]} series={[rx]} unit="ms" minTop={20} />);
    expect(screen.getByText("En attente des premières mesures…")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("draws a line per series, with a legend only when there are several", () => {
    const { container, rerender } = render(<TimeChart title="Gigue" xs={xs} series={[rx]} unit="ms" minTop={20} />);
    expect(container.querySelectorAll("path")).toHaveLength(1);
    expect(screen.queryByRole("list", { name: "Légende" })).toBeNull();
    rerender(<TimeChart title="Gigue" xs={xs} series={[rx, tx]} unit="ms" minTop={20} />);
    expect(container.querySelectorAll("path")).toHaveLength(2);
    expect(screen.getByRole("list", { name: "Légende" })).toHaveTextContent("Envoyé");
  });

  it("breaks the line where a value is missing", () => {
    const { container } = render(<TimeChart title="t" xs={xs} series={[tx]} unit="ms" minTop={20} />);
    const d = container.querySelector("path")?.getAttribute("d") ?? "";
    expect(d.match(/M/g)).toHaveLength(2);
  });

  it("describes itself to screen readers with the last and the highest value", () => {
    render(<TimeChart title="Gigue" xs={xs} series={[rx]} unit="ms" minTop={20} />);
    const label = screen.getByRole("img").getAttribute("aria-label");
    expect(label).toContain("Gigue");
    expect(label).toContain("Reçu : 12 ms (maximum 40)");
  });

  it("shows every series at the second under the cursor, moved with the arrow keys", () => {
    render(<TimeChart title="Gigue" xs={xs} series={[rx, tx]} unit="ms" minTop={20} testId="c" />);
    const svg = screen.getByRole("img");
    expect(screen.queryByTestId("c-tip")).toBeNull();
    fireEvent.keyDown(svg, { key: "ArrowLeft" }); // starts from the latest second
    expect(screen.getByTestId("c-tip")).toHaveTextContent("0:04");
    expect(screen.getByTestId("c-tip")).toHaveTextContent("12 ms");
    expect(screen.getByTestId("c-tip")).toHaveTextContent("8 ms");
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(screen.getByTestId("c-tip")).toHaveTextContent("0:03");
    expect(screen.getByTestId("c-tip")).toHaveTextContent("40 ms");
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(screen.getByTestId("c-tip")).toHaveTextContent("0:02");
    expect(screen.getByTestId("c-tip")).toHaveTextContent("—Envoyé"); // no value that second
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(screen.queryByTestId("c-tip")).toBeNull();
  });

  it("stacks bars and leaves out the zeros", () => {
    const late = { key: "late", label: "En retard", slot: 1 as const, values: [0, 2, 0, 1, 0] };
    const lost = { key: "lost", label: "Perdus", slot: 2 as const, values: [0, 1, 0, 0, 0] };
    const { container } = render(
      <TimeChart title="Incidents" xs={xs} series={[late, lost]} kind="bars" unit="paquets" minTop={4} />,
    );
    // second 1: two segments, second 3: one
    expect(container.querySelectorAll("rect")).toHaveLength(3);
  });

  it("marks the thresholds it is given", () => {
    render(
      <TimeChart
        title="Blocs"
        xs={xs}
        series={[rx]}
        unit="ms"
        minTop={20}
        thresholds={[{ value: 35, label: "coupure audible" }]}
      />,
    );
    expect(screen.getByText("coupure audible")).toBeInTheDocument();
  });
});
