import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import NotFound from '@/app/not-found';

afterEach(cleanup);

describe('not-found page (app/not-found.tsx)', () => {
  it('says "Page not found" and links to Portfolio and Wells', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Portfolio' }).getAttribute('href')).toBe('/portfolio');
    expect(screen.getByRole('link', { name: 'Wells' }).getAttribute('href')).toBe('/wells');
  });
});
