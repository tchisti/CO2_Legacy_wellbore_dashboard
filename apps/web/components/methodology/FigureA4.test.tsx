import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FigureA4 } from '@/components/methodology/FigureA4';

afterEach(cleanup);

const ARIA_LABEL = 'Legacy well classification types, adapted after Arbad et al. 2024';

describe('FigureA4', () => {
  it('is one image with the v2 accessible name', () => {
    render(<FigureA4 />);
    const img = screen.getByRole('img', { name: ARIA_LABEL });
    expect(img.tagName.toLowerCase()).toBe('svg');
    expect(img.getAttribute('viewBox')).toBe('0 0 960 470');
  });

  it('draws the injector and Types 2 to 9 (Type 1 has no records to draw)', () => {
    const { container } = render(<FigureA4 />);
    const labels = Array.from(container.querySelectorAll('svg text')).map((t) => t.textContent);
    for (let n = 2; n <= 9; n += 1) expect(labels).toContain(`Type ${n}`);
    expect(labels).not.toContain('Type 1');
    expect(labels).toContain('CO₂ Injector (Class VI)');
    expect(labels).toContain('USDW / BGWP (protected groundwater)');
    expect(labels).toContain('PRIMARY GEOLOGIC SEAL (caprock)');
    expect(labels).toContain('Production formation');
    expect(labels).toContain('STORAGE RESERVOIR');
    expect(labels).toContain('CO₂ plume');
    expect(labels).toContain('Not to scale · Type 1 (no records) cannot be illustrated');
  });

  it('keeps the v2 hexes for the stratigraphy and the leak arrows (domain colours, not rank colours)', () => {
    const { container } = render(<FigureA4 />);
    const svg = container.querySelector('svg')!;
    const fills = Array.from(svg.querySelectorAll('rect, ellipse')).map((e) => e.getAttribute('fill'));
    for (const hex of ['#3d85c8', '#c94f47', '#4f9257', '#d9c84a', '#3b6fd4']) expect(fills).toContain(hex);
    const arrows = Array.from(svg.querySelectorAll('path[marker-end]'));
    expect(arrows.length).toBeGreaterThan(0);
    expect(arrows.every((a) => a.getAttribute('stroke') === '#ff6b5e')).toBe(true);
    // The marker head is the same red, and every arrow points at a marker that exists.
    const marker = svg.querySelector('marker')!;
    expect(marker.querySelector('path')!.getAttribute('fill')).toBe('#ff6b5e');
    for (const a of arrows) expect(a.getAttribute('marker-end')).toBe(`url(#${marker.id})`);
  });

  it('takes the page background, border and text from the theme tokens, not v2 hexes', () => {
    const { container } = render(<FigureA4 />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('class')).toContain('bg-surface');
    expect(svg.getAttribute('class')).toContain('border-line');
    expect(container.innerHTML).not.toMatch(/#10192e/i);
    // Labels outside the coloured layers use the ink / muted tokens.
    const typeLabel = Array.from(svg.querySelectorAll('text')).find((t) => t.textContent === 'Type 2')!;
    expect(typeLabel.getAttribute('class')).toContain('fill-ink');
  });

  it('draws the strata labels last, over the wells, in ink with a surface halo so a well never hides a word', () => {
    const { container } = render(<FigureA4 />);
    const svg = container.querySelector('svg')!;
    const texts = Array.from(svg.querySelectorAll('text'));
    const lastWell = texts.find((t) => t.textContent === 'Type 9')!.parentElement!;
    for (const words of [
      'USDW / BGWP (protected groundwater)',
      'PRIMARY GEOLOGIC SEAL (caprock)',
      'Production formation',
      'STORAGE RESERVOIR',
      'CO₂ plume',
    ]) {
      const label = texts.find((t) => t.textContent === words)!;
      // Later in the document is later in the paint order: on top of Type 9 and every well before it.
      expect(lastWell.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const halo = label.parentElement!;
      expect(halo.getAttribute('class')).toContain('fill-ink');
      expect(halo.getAttribute('class')).toContain('stroke-surface');
      expect(halo.getAttribute('paint-order')).toBe('stroke');
    }
  });

  it('scrolls horizontally on narrow screens rather than shrinking below its v2 width', () => {
    const { container } = render(<FigureA4 />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('class')).toContain('min-w-[820px]');
    const scroller = svg.parentElement!;
    expect(scroller.className).toContain('overflow-x-auto');
    expect(scroller.tabIndex).toBe(0);
  });

  it('carries the v2 caption', () => {
    render(<FigureA4 />);
    expect(
      screen.getByText(
        'Figure A-4 (adapted) — legacy well classification by penetration and protection. Original artwork redrawn for this dashboard; leak arrows mark unprotected pathways. Casing/cement shown dark/light; open hole shown tan.',
      ),
    ).toBeTruthy();
  });
});
