import { describe, it, expect, vi } from 'vitest';
import { buildHumanCursorPath, createHumanCursor } from '../src/human-cursor.js';
import type { Locator, Mouse, Page } from '@playwright/test';

interface FakeHarness {
  page: Page;
  target: Locator;
  clickMock: ReturnType<typeof vi.fn<() => Promise<void>>>;
  moves: Array<{ x: number; y: number }>;
  downMock: ReturnType<typeof vi.fn<() => Promise<void>>>;
  upMock: ReturnType<typeof vi.fn<() => Promise<void>>>;
  setMoveImpl(impl: (x: number, y: number) => Promise<void>): void;
}

const DEFAULT_BOX = { x: 400, y: 240, width: 240, height: 120 };

/** A Page stub covering exactly what createHumanCursor touches, without a browser. */
function createFakePage(options: { box?: typeof DEFAULT_BOX } = {}): FakeHarness {
  const box = options.box ?? DEFAULT_BOX;
  const moves: Array<{ x: number; y: number }> = [];
  const downMock = vi.fn(async () => {});
  const upMock = vi.fn(async () => {});
  const clickMock = vi.fn(async () => {});
  let moveImpl: (x: number, y: number) => Promise<void> = async (x, y) => {
    moves.push({ x, y });
  };
  const page = {
    viewportSize: () => ({ width: 1280, height: 720 }),
    evaluate: async () => undefined,
    waitForTimeout: async () => {},
    isClosed: () => false,
    on: () => {},
    off: () => {},
    mouse: {
      move: (x: number, y: number, options?: { steps?: number }) => moveImpl(x, y),
      down: downMock,
      up: upMock,
      click: async () => {},
    } as unknown as Mouse,
  } as unknown as Page;
  const target = {
    scrollIntoViewIfNeeded: async () => {},
    boundingBox: async () => ({ ...box }),
    click: clickMock,
  } as unknown as Locator;
  return {
    page,
    target,
    clickMock,
    moves,
    downMock,
    upMock,
    setMoveImpl(impl) {
      moveImpl = impl;
    },
  };
}

describe('human cursor paths', () => {
  const from = { x: 100, y: 80 };
  const to = { x: 800, y: 400 };

  it('reproduces the curve for the same seed, with exact endpoints', () => {
    const path = buildHumanCursorPath(from, to, 'demo:1', 40);
    expect(path).toEqual(buildHumanCursorPath(from, to, 'demo:1', 40));
    expect(path).not.toEqual(buildHumanCursorPath(from, to, 'demo:2', 40));
    expect(path[0]).toEqual(from);
    expect(path.at(-1)).toEqual(to);
    expect(path).toHaveLength(40);
    // At least one intermediate point must be off the straight-line path.
    expect(path.some(p => Math.abs((p.x - from.x) * (to.y - from.y) - (p.y - from.y) * (to.x - from.x)) > 100)).toBe(true);
  });

  it('does not wander when clicking the same point twice', () => {
    expect(buildHumanCursorPath(from, from, 'stationary', 18)).toEqual(Array(18).fill(from));
  });
});

describe('createHumanCursor', () => {
  it('clicks through the locator so Playwright actionability checks still apply', async () => {
    const { page, target, clickMock, downMock, upMock } = createFakePage();
    const cursor = await createHumanCursor(page);
    await cursor.click(target, { durationMs: 0, dwellMs: 0, holdMs: 120, afterMs: 0 });
    // Element-relative position: if the layout shifted during the glide,
    // Playwright retargets instead of clicking the stale absolute point.
    expect(clickMock).toHaveBeenCalledTimes(1);
    expect(clickMock).toHaveBeenCalledWith({ position: { x: 240 * 0.08, y: 120 * 0.78 }, delay: 120 });
    expect(downMock).not.toHaveBeenCalled();
    expect(upMock).not.toHaveBeenCalled();
  });

  it('honors custom target fractions for the press point', async () => {
    const { page, target, clickMock } = createFakePage();
    const cursor = await createHumanCursor(page);
    await cursor.click(target, { durationMs: 0, dwellMs: 0, holdMs: 40, afterMs: 0, target: { x: 0.5, y: 0.5 } });
    expect(clickMock).toHaveBeenCalledWith({ position: { x: 120, y: 60 }, delay: 40 });
  });

  it('still glides without pressing anything on moveTo', async () => {
    const { page, target, clickMock, downMock, upMock } = createFakePage();
    const cursor = await createHumanCursor(page);
    await cursor.moveTo(target, { durationMs: 0 });
    expect(clickMock).not.toHaveBeenCalled();
    expect(downMock).not.toHaveBeenCalled();
    expect(upMock).not.toHaveBeenCalled();
  });

  it('glides from wherever the mouse really is after an external move', async () => {
    const { page, target, moves } = createFakePage();
    const cursor = await createHumanCursor(page);
    await page.mouse.move(10, 20); // some other code moved the pointer
    moves.length = 0;
    await cursor.moveTo(target, { durationMs: 0 });
    expect(Math.hypot(moves[0].x - 10, moves[0].y - 20)).toBeLessThan(30);
  });

  it('resumes from the last reached point when a glide fails midway', async () => {
    const { page, target, moves, setMoveImpl } = createFakePage();
    const cursor = await createHumanCursor(page);
    let calls = 0;
    setMoveImpl(async (x, y) => {
      if (++calls === 10) throw new Error('page closed');
      moves.push({ x, y });
    });
    await expect(cursor.moveTo(target, { durationMs: 0 })).rejects.toThrow('page closed');
    const lastReached = { ...moves.at(-1)! };
    setMoveImpl(async (x, y) => {
      moves.push({ x, y });
    });
    moves.length = 0;
    await cursor.moveTo(target, { durationMs: 0 });
    expect(Math.hypot(moves[0].x - lastReached.x, moves[0].y - lastReached.y)).toBeLessThan(30);
  });

  it('stops tracking the mouse after dispose', async () => {
    const { page } = createFakePage();
    const original = page.mouse.move;
    const cursor = await createHumanCursor(page);
    const wrapped = page.mouse.move;
    expect(wrapped).not.toBe(original);
    await cursor.dispose();
    expect(page.mouse.move).not.toBe(wrapped);
    await page.mouse.move(5, 6);
  });
});
