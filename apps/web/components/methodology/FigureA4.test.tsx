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

  it('draws every leak arrow, open hole and cement sheath on a near-black outline (non-text contrast in both themes)', () => {
    const { container } = render(<FigureA4 />);
    const svg = container.querySelector('svg')!;
    const OUTLINE = '#111418';
    // Each arrow has an outline path with the same course right before it, wider by the outline on both sides.
    const arrows = Array.from(svg.querySelectorAll('path[marker-end]'));
    expect(arrows).toHaveLength(9);
    for (const a of arrows) {
      const under = a.previousElementSibling!;
      expect(under.hasAttribute('data-outline')).toBe(true);
      expect(under.getAttribute('d')).toBe(a.getAttribute('d'));
      expect(under.getAttribute('stroke')).toBe(OUTLINE);
      expect(Number(under.getAttribute('stroke-width'))).toBeGreaterThan(Number(a.getAttribute('stroke-width')));
      expect(under.hasAttribute('marker-end')).toBe(false);
    }
    // The head is outlined too, under its fill.
    const head = svg.querySelector('marker path')!;
    expect(head.getAttribute('stroke')).toBe(OUTLINE);
    expect(head.getAttribute('paint-order')).toBe('stroke');
    // Open hole (tan) and cement sheath (light) rects each sit right on an outline rect that encloses them.
    for (const hex of ['#d9a066', '#cfd6e2']) {
      const marks = Array.from(svg.querySelectorAll(`rect[fill="${hex}"]`));
      expect(marks.length).toBeGreaterThan(0);
      for (const m of marks) {
        const under = m.previousElementSibling!;
        expect(under.hasAttribute('data-outline')).toBe(true);
        expect(under.getAttribute('fill')).toBe(OUTLINE);
        const n = (el: Element, attr: string) => Number(el.getAttribute(attr));
        expect(n(under, 'x')).toBeLessThan(n(m, 'x'));
        expect(n(under, 'y')).toBeLessThan(n(m, 'y'));
        expect(n(under, 'x') + n(under, 'width')).toBeGreaterThan(n(m, 'x') + n(m, 'width'));
        expect(n(under, 'y') + n(under, 'height')).toBeGreaterThan(n(m, 'y') + n(m, 'height'));
      }
    }
    expect(svg.querySelectorAll('rect[fill="#d9a066"]')).toHaveLength(5); // Types 2–6
    expect(svg.querySelectorAll('rect[fill="#cfd6e2"]')).toHaveLength(7); // Types 3, 4, 6, 7, 8, 9 and the injector
  });

  it('sets the Depth label clear of the seal label, reading upward from y 200', () => {
    const { container } = render(<FigureA4 />);
    const depth = Array.from(container.querySelectorAll('svg text')).find((t) => t.textContent === 'Depth')!;
    expect(depth.getAttribute('y')).toBe('200');
    expect(depth.getAttribute('transform')).toBe('rotate(-90 18 200)');
  });

  it('is described by its caption', () => {
    render(<FigureA4 />);
    const img = screen.getByRole('img', { name: ARIA_LABEL });
    const caption = document.getElementById(img.getAttribute('aria-describedby')!)!;
    expect(caption.tagName.toLowerCase()).toBe('figcaption');
    expect(caption.textContent).toMatch(/^Figure A-4 \(adapted\)/);
  });
});
