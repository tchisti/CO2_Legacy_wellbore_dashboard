import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RankBadge } from '@/components/domain/RankBadge';

afterEach(cleanup);

describe('RankBadge', () => {
  it.each([
    ['Low', 'var(--rank-low)'],
    ['Moderate', 'var(--rank-mod)'],
    ['High', 'var(--rank-high)'],
    ['Very High', 'var(--rank-crit)'],
  ])('shows the %s label with its rank colour', (label, colour) => {
    const { container } = render(<RankBadge label={label} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.textContent).toBe(label);
    expect(badge.style.getPropertyValue('--rank')).toBe(colour);
  });

  it('shows the matrix cell next to the label when given', () => {
    const { container } = render(<RankBadge label="High" cell={12} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.textContent).toBe('High, cell 12');
    expect(screen.getByText('12').className).toContain('tabular-nums');
  });

  it('shows "Unscored" in a neutral style when there is no rank', () => {
    const { container } = render(<RankBadge label={null} cell={null} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.textContent).toBe('Unscored');
    expect(badge.style.getPropertyValue('--rank')).toBe('');
    expect(badge.dataset.rank).toBe('unscored');
  });

  it('shows an unknown band name as text without a rank colour', () => {
    const { container } = render(<RankBadge label="Extreme" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.textContent).toBe('Extreme');
    expect(badge.style.getPropertyValue('--rank')).toBe('');
  });
});
