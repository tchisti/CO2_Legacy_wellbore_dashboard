import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_METHODOLOGY } from '@lwa/engine';
import { Matrix5x5, cellLabel } from '@/components/portfolio/Matrix5x5';
import { wellsFilterHref } from '@/lib/portfolio';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/portfolio',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

/** counts[Lr - 1][Cr - 1]: 4 wells at L2 × C2, 1 at L2 × C3, 2 at L5 × C1. */
function counts(): number[][] {
  const m = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
  m[1]![1] = 4;
  m[1]![2] = 1;
  m[4]![0] = 2;
  return m;
}

const hrefFor = (Lr: number, Cr: number) => wellsFilterHref({ cell: { Lr, Cr } });
const cellRect = (container: HTMLElement, key: string) => container.querySelector(`[data-cell="${key}"] rect`)!;

describe('Matrix5x5', () => {
  it('names each populated cell by L, C, cell value, band and count, and links it to the filtered register', () => {
    render(<Matrix5x5 counts={counts()} methodology={DEFAULT_METHODOLOGY} hrefFor={hrefFor} />);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'L 2 × C 2, cell 4, Low: 4 wells',
      'L 2 × C 3, cell 6, Moderate: 1 well',
      'L 5 × C 1, cell 5, Moderate: 2 wells',
    ]);
    expect(screen.getByRole('link', { name: 'L 2 × C 3, cell 6, Moderate: 1 well' }).getAttribute('href')).toBe(
      '/wells?Cr=3&Lr=2',
    );
  });

  it('empty cells are not links, and without hrefFor no cell is', () => {
    const { container, rerender } = render(<Matrix5x5 counts={counts()} methodology={DEFAULT_METHODOLOGY} hrefFor={hrefFor} />);
    expect(container.querySelectorAll('[data-cell]')).toHaveLength(25);
    expect(container.querySelector('[data-cell="1-1"]')!.tagName.toLowerCase()).toBe('g');
    rerender(<Matrix5x5 counts={counts()} methodology={DEFAULT_METHODOLOGY} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('draws likelihood up the side (5 at the top) and consequence along the bottom (1 at the left)', () => {
    const { container } = render(<Matrix5x5 counts={counts()} methodology={DEFAULT_METHODOLOGY} />);
    const y = (key: string) => Number(cellRect(container, key).getAttribute('y'));
    const x = (key: string) => Number(cellRect(container, key).getAttribute('x'));
    expect(y('5-1')).toBeLessThan(y('4-1'));
    expect(y('2-1')).toBeLessThan(y('1-1'));
    expect(x('1-1')).toBeLessThan(x('1-2'));
    expect(x('1-4')).toBeLessThan(x('1-5'));
    expect(screen.getByText('Likelihood (L)')).toBeTruthy();
    expect(screen.getByText('Consequence (C)')).toBeTruthy();
  });

  it('a plain click navigates in the app; a modified click is left to the browser', () => {
    render(<Matrix5x5 counts={counts()} methodology={DEFAULT_METHODOLOGY} hrefFor={hrefFor} />);
    const link = screen.getByRole('link', { name: 'L 2 × C 3, cell 6, Moderate: 1 well' });
    fireEvent.click(link, { metaKey: true });
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(router.push).toHaveBeenCalledWith('/wells?Cr=3&Lr=2');
  });

  it('lists every band of the methodology with its cell range', () => {
    render(<Matrix5x5 counts={counts()} methodology={DEFAULT_METHODOLOGY} />);
    const legend = screen.getByRole('list', { name: 'Bands' });
    expect(legend.textContent).toBe('Low1–4Moderate5–9High10–16Very High17–25');
  });

  it('cellLabel says "no wells" for an empty cell', () => {
    expect(cellLabel(1, 1, 'Low', 0)).toBe('L 1 × C 1, cell 1, Low: no wells');
  });
});
