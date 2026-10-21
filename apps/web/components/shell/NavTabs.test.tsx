import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavTabs } from '@/components/shell/NavTabs';

const nav = vi.hoisted(() => ({ pathname: '/portfolio' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

afterEach(cleanup);

function links() {
  return within(screen.getByRole('navigation')).getAllByRole('link');
}

describe('NavTabs', () => {
  it('links the four sections in order', () => {
    render(<NavTabs />);
    expect(links().map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Portfolio', '/portfolio'],
      ['Wells', '/wells'],
      ['Methodology', '/methodology'],
      ['Project settings', '/settings'],
    ]);
  });

  it.each([
    ['/portfolio', 'Portfolio'],
    ['/wells', 'Wells'],
    ['/wells/view', 'Wells'],
    ['/methodology', 'Methodology'],
    ['/settings', 'Project settings'],
  ])('marks the current section on %s', (pathname, current) => {
    nav.pathname = pathname;
    render(<NavTabs />);
    const marked = links().filter((a) => a.getAttribute('aria-current') === 'page');
    expect(marked.map((a) => a.textContent)).toEqual([current]);
  });

  it('marks nothing on a page outside the four sections', () => {
    nav.pathname = '/wellsfargo';
    render(<NavTabs />);
    expect(links().filter((a) => a.hasAttribute('aria-current'))).toEqual([]);
  });
});
