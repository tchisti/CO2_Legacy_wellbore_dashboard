// Where the classification and the method come from. Both texts are the v2 wording, kept as
// written (index.html: the "Sources" note under Table A-1, and the page footer), except that the
// v2 note's last sentence, about wells pushed from the 3D Reviewer, is gone: v3 has no 3D bridge.

/** The note under Table A-1 and Figure A-4. */
export function Sources() {
  return (
    <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">
      <strong className="font-semibold text-ink">Sources:</strong> Table A-1 &amp; Figure A-4,{' '}
      <cite>CO2 Underground Storage Legacy Well Review Guideline</cite>, GD-40-0B42-524E.1.0.0, Enbridge Inc.,
      2025-10-03; figure adapted after Arbad, N., Watson, M., Heinze, L. &amp; Emadi, H. (2024),{' '}
      <cite>
        Qualitative risk assessment of legacy wells based on publicly available data for Class VI well permit
        applications &mdash; Illinois Basin case study
      </cite>
      , International Journal of Greenhouse Gas Control 133:104106,{' '}
      <a
        href="https://doi.org/10.1016/j.ijggc.2024.104106"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2"
      >
        doi:10.1016/j.ijggc.2024.104106
      </a>
      . Wells within the AoR are categorized by <strong className="font-semibold text-ink">penetration</strong> (seal /
      reservoir), <strong className="font-semibold text-ink">protection</strong> (groundwater-USDWs, seal, reservoir)
      and <strong className="font-semibold text-ink">accessibility</strong>, then entered into the risk matrix (Fig.
      A-10). &quot;Protection&quot; means verified barriers (casing/cement/plugs) across the named interval.
    </p>
  );
}

/** The v2 footer line. */
export function Citation() {
  return (
    <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">
      Built on Enbridge NET <cite>Legacy Well Review Guideline</cite> GD-40-0B42-524E v1.0.0 (Khan &amp; Christi, 2025)
      · cross-checked against EPA UIC Class VI 40 CFR §146.84, AER Directive 051/020, CSA Z741, ISO 27914, API RP 65-3 ·
      Arbad et al., IJGGC vol. 133 (2024).
    </p>
  );
}
