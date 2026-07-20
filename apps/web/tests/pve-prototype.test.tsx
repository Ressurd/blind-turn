import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PvePrototype } from "../src/features/pve-prototype/PvePrototype";

describe("PvE prototype initial UI", () => {
  it("renders the 6x4 board, four fixed characters, and all boss intents", () => {
    const html = renderToStaticMarkup(createElement(PvePrototype));
    expect(html.match(/aria-label="타일 /g)).toHaveLength(24);
    expect(html).toContain("전사");
    expect(html).toContain("궁수");
    expect(html).toContain("마법사");
    expect(html).toContain("사제");
    expect(html).toContain("열 내려치기");
    expect(html).toContain("추적 마력탄");
    expect(html).toContain("대지 진동");
    expect(html).toContain("② 추적 예고 대상");
    expect(html).not.toContain("<img");
  });

  it("starts with twelve empty slots and a disabled simulation button", () => {
    const html = renderToStaticMarkup(createElement(PvePrototype));
    expect(html.match(/비어 있음/g)).toHaveLength(12);
    expect(html).toContain("0 / 12");
    expect(html).toContain("시뮬레이션 시작");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>시뮬레이션 시작/);
  });
});
