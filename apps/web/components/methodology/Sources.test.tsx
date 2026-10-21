import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Citation, Sources } from '@/components/methodology/Sources';

afterEach(cleanup);

// The v2 "Sources" note (index.html), less its last sentence about wells pushed from the 3D Reviewer.
const SOURCES_TEXT =
  'Sources: Table A-1 & Figure A-4, CO2 Underground Storage Legacy Well Review Guideline, GD-40-0B42-524E.1.0.0, Enbridge Inc., 2025-10-03; figure adapted after Arbad, N., Watson, M., Heinze, L. & Emadi, H. (2024), Qualitative risk assessment of legacy wells based on publicly available data for Class VI well permit applications — Illinois Basin case study, International Journal of Greenhouse Gas Control 133:104106, doi:10.1016/j.ijggc.2024.104106. Wells within the AoR are categorized by penetration (seal / reservoir), protection (groundwater-USDWs, seal, reservoir) and accessibility, then entered into the risk matrix (Fig. A-10). "Protection" means verified barriers (casing/cement/plugs) across the named interval.';

// The v2 footer, as written.
const CITATION_TEXT =
  'Built on Enbridge NET Legacy Well Review Guideline GD-40-0B42-524E v1.0.0 (Khan & Christi, 2025) · cross-checked against EPA UIC Class VI 40 CFR §146.84, AER Directive 051/020, CSA Z741, ISO 27914, API RP 65-3 · Arbad et al., IJGGC vol. 133 (2024).';

const squash = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('Sources', () => {
  it('carries the v2 sources note word for word, without the 3D Reviewer sentence', () => {
    const { container } = render(<Sources />);
    expect(squash(container.textContent)).toBe(SOURCES_TEXT);
    expect(container.textContent).not.toMatch(/3D Reviewer/);
    expect(container.textContent).not.toMatch(/Type 1 \(no records\) is the default/);
  });

  it('opens the DOI in a new tab without leaking the opener', () => {
    render(<Sources />);
    const link = screen.getByRole('link', { name: 'doi:10.1016/j.ijggc.2024.104106' });
    expect(link.getAttribute('href')).toBe('https://doi.org/10.1016/j.ijggc.2024.104106');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('Citation', () => {
  it('is the v2 footer citation, exactly as written', () => {
    const { container } = render(<Citation />);
    expect(squash(container.textContent)).toBe(CITATION_TEXT);
  });
});
