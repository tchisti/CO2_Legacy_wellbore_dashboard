import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HistoryIcon } from 'lucide-react';
import { AssessmentStateBadge, StateBadge } from '@/components/domain/StateBadge';
import type { AssessmentState } from '@/lib/derived';

afterEach(cleanup);

const badge = (text: string) => {
  const el = screen.getByText(text).closest<HTMLElement>('[data-tone]');
  if (!el) throw new Error(`no badge around "${text}"`);
  return el;
};

function state(overrides: Partial<AssessmentState>): AssessmentState {
  return {
    kind: 'final',
    stale: { stale: false, delta: 'none' },
    recordChanged: false,
    label: 'Final',
    ...overrides,
  };
}

describe('StateBadge', () => {
  it('is neutral by default and amber (the warn tokens) with tone="warn"', () => {
    render(
      <>
        <StateBadge icon={HistoryIcon}>Quiet</StateBadge>
        <StateBadge icon={HistoryIcon} tone="warn">
          Loud
        </StateBadge>
      </>,
    );
    expect(badge('Quiet').dataset.tone).toBe('neutral');
    expect(badge('Quiet').className).not.toContain('bg-warn-bg');
    expect(badge('Loud').dataset.tone).toBe('warn');
    expect(badge('Loud').className).toContain('bg-warn-bg');
    expect(badge('Loud').className).toContain('text-warn');
    expect(badge('Loud').className).toContain('border-warn-line');
    // The icon stays, so colour is never the only cue.
    expect(badge('Loud').querySelector('svg')).not.toBeNull();
  });
});

describe('AssessmentStateBadge (the Wells table Assessment column)', () => {
  it('a stale current final is amber', () => {
    render(<AssessmentStateBadge state={state({ stale: { stale: true, delta: 'major' }, label: 'Stale revision' })} />);
    expect(badge('Stale revision').dataset.tone).toBe('warn');
    expect(badge('Stale revision').dataset.stateKind).toBe('final');
  });

  it('a current final, a wording-only revision, a draft beside a stale final and an unscored well are not', () => {
    render(
      <>
        <AssessmentStateBadge state={state({})} />
        <AssessmentStateBadge state={state({ label: 'Final (patch)', stale: { stale: false, delta: 'patch' } })} />
        <AssessmentStateBadge
          state={state({ kind: 'draft', stale: { stale: true, delta: 'major' }, label: 'Draft by T. Chisti' })}
        />
        <AssessmentStateBadge state={state({ kind: 'unscored', label: 'Unscored' })} />
      </>,
    );
    expect(badge('Final').dataset.tone).toBe('neutral');
    expect(badge('Final (patch)').dataset.tone).toBe('neutral');
    expect(badge('Draft by T. Chisti').dataset.tone).toBe('neutral');
    expect(badge('Unscored').dataset.tone).toBe('empty');
    for (const text of ['Final', 'Final (patch)', 'Draft by T. Chisti', 'Unscored']) {
      expect(badge(text).className).not.toContain('bg-warn-bg');
    }
  });
});
