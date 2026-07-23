import { describe, expect, it } from "vitest";
import { pveConfirmationLabel } from "../src/features/pve-coop/PveCoop";

describe("online PvE party labels", () => {
  it.each([
    [1, 2, "확정 1 / 2"],
    [2, 3, "확정 2 / 3"],
    [3, 4, "확정 3 / 4"],
  ])("uses the actual player count for %i/%i", (confirmed, players, expected) => {
    expect(pveConfirmationLabel(confirmed, players)).toBe(expected);
  });
});
