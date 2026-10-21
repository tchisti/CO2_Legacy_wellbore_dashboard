// Pure, DOM-free SVG renderer for the wellbore schematic (spec 2026-08-07 §5):
// string concatenation only. Ported from v2 so the markup is byte-identical:
// same geometry, colours, data-kind / data-id / aria-label / <title> output,
// and labels escaped exactly once.
import { asList } from './list';
import { depthScale } from './scale';
import { mToFt } from './units';
import type { DepthUnit, WellboreInput } from './types';

/** Colours inlined in place of the CSS variables (used for standalone export). */
export type WellboreSvgColors = {
  line?: string;
  muted?: string;
  ink?: string;
  /** Accepted for callers' convenience; the renderer draws no background. */
  bg?: string;
};

export type WellboreSvgOptions = {
  unit: DepthUnit;
  width?: number;
  height?: number;
  /** A `data-id` such as "plug:0"; that element gets the accent stroke. */
  highlightId?: string | null;
  resolvedColors?: WellboreSvgColors;
};

// XML/HTML text escaping for anything interpolated into markup or attributes.
const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s: string | number | null | undefined): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

// Format a metres depth for on-screen labels in the caller's display unit.
function fmtDepth(m: number | null | undefined, unit: DepthUnit): string {
  if (typeof m !== 'number' || !Number.isFinite(m)) return '—';
  const v = unit === 'ft' ? mToFt(m) : m;
  return (+v.toFixed(1)).toString() + (unit === 'ft' ? ' ft' : ' m');
}

type LooseCasing = NonNullable<NonNullable<WellboreInput['casings']>[number]>;

/** Render the schematic as an SVG string; '' when there is no positive, finite td. */
export function renderWellboreSVG(wb: WellboreInput | null | undefined, opts: WellboreSvgOptions = { unit: 'm' }): string {
  // Number.isFinite: an infinite td would make the depth ticks endless (see depthScale).
  if (!wb || typeof wb.td !== 'number' || !Number.isFinite(wb.td) || !(wb.td > 0)) return '';

  const unit: DepthUnit = opts.unit === 'ft' ? 'ft' : 'm';
  const W = opts.width || 760;
  const H = opts.height || 920;
  const highlightId = opts.highlightId || null;
  const rc = opts.resolvedColors || {};
  const cLine = rc.line || 'var(--line)';
  const cMuted = rc.muted || 'var(--muted)';
  const cInk = rc.ink || 'var(--ink, currentColor)';

  const GUTTER_L = 64; // left depth-axis gutter
  const GUTTER_R = 140; // right gutter for formation names / notes
  const TOP = 56; // top margin (ground surface + KB marker room)
  const BOTTOM = 24;
  const plotH = Math.max(1, H - TOP - BOTTOM);
  const plotW = Math.max(1, W - GUTTER_L - GUTTER_R);
  const cx = GUTTER_L + plotW / 2; // bore centerline x

  const td = wb.td;
  const scale = depthScale(td, plotH);
  const y = (m: number | null | undefined): number => TOP + scale.yOf(typeof m === 'number' ? m : 0);

  const casings = asList(wb.casings);
  const plugs = asList(wb.plugs);
  const perforations = asList(wb.perforations);
  const formations = asList(wb.formations);
  const zones = asList(wb.zones);
  const packers = asList(wb.packers);
  const notes = asList(wb.notes);

  const parts: string[] = [];

  // Highlight helper — applied to any component element sharing data-id.
  const hl = (id: string): string => (highlightId && id === highlightId ? ' stroke="#3aa0ff" stroke-width="2.5"' : '');

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="11">`);

  // Diagonal-hatch pattern for open hole.
  parts.push(`<defs><pattern id="wb-openhole-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="none"/><line x1="0" y1="0" x2="0" y2="6" stroke="#8a6b4f" stroke-width="2"/></pattern></defs>`);

  // ---- depth axis (left gutter) ----
  const ticks = scale.ticks(unit);
  parts.push(`<g data-kind="axis">`);
  parts.push(`<line x1="${GUTTER_L}" y1="${TOP}" x2="${GUTTER_L}" y2="${TOP + plotH}" stroke="${cLine}" stroke-width="1"/>`);
  for (const t of ticks) {
    const ty = y(t.m);
    parts.push(`<line x1="${GUTTER_L - 6}" y1="${ty}" x2="${GUTTER_L}" y2="${ty}" stroke="${cLine}" stroke-width="1"/>`);
    parts.push(`<text x="${GUTTER_L - 9}" y="${ty + 3}" text-anchor="end" fill="${cMuted}">${esc(t.label)}</text>`);
  }
  const axisTitle = unit === 'ft' ? 'Depth (ft)' : 'Depth (m)';
  parts.push(`<text x="${GUTTER_L}" y="${TOP - 34}" text-anchor="start" fill="${cMuted}" font-size="11">${esc(axisTitle)}</text>`);
  parts.push(`</g>`);

  // ---- ground surface + KB marker ----
  const surfY = y(0);
  parts.push(`<g data-kind="surface"><line x1="${GUTTER_L}" y1="${surfY}" x2="${W - GUTTER_R}" y2="${surfY}" stroke="${cLine}" stroke-width="1.5"/>`);
  parts.push(`<text x="${GUTTER_L + 4}" y="${surfY - 6}" fill="${cInk}">Ground Surface</text>`);
  if (typeof wb.kbElev === 'number') {
    const kbY = surfY - 16;
    parts.push(`<polygon points="${cx - 6},${surfY} ${cx + 6},${surfY} ${cx},${kbY}" fill="${cInk}"/>`);
    parts.push(`<text x="${cx + 9}" y="${kbY + 10}" fill="${cInk}">KB ${esc(fmtDepth(wb.kbElev, unit))}</text>`);
  }
  parts.push(`</g>`);

  // ---- casings (sorted by shoe_m ascending; outermost = widest) ----
  // Null entries and casings without a shoe are skipped; `i` keeps the
  // original array index for data-id.
  const sortedCasings: { c: LooseCasing; i: number; shoe_m: number }[] = [];
  casings.forEach((c, i) => {
    if (c && typeof c.shoe_m === 'number') sortedCasings.push({ c, i, shoe_m: c.shoe_m });
  });
  sortedCasings.sort((a, b) => a.shoe_m - b.shoe_m);
  // Rank by shoe_m: the shallowest shoe (surface casing) gets the widest
  // wall, the deepest (typically production) string the narrowest.
  const nCasings = sortedCasings.length;
  const baseHalf = Math.min(plotW / 2 - 8, 90);
  const stepHalf = nCasings > 1 ? (baseHalf * 0.5) / nCasings : 0;

  sortedCasings.forEach((entry, rank) => {
    const c = entry.c;
    const origIdx = entry.i;
    const id = `casing:${origIdx}`;
    // rank 0 = shallowest shoe_m = outermost/widest.
    const half = baseHalf - rank * stepHalf;
    const wallW = 4;
    const top_m = typeof c.top_m === 'number' ? c.top_m : 0;
    const shoe_m = entry.shoe_m;
    const yTop = y(top_m);
    const yShoe = y(shoe_m);
    const odStr = typeof c.od_mm === 'number' ? `${(+c.od_mm).toFixed(1)}mm` : '—';
    const label = `${c.name || c.type || 'Casing'} — top ${fmtDepth(top_m, unit)}, shoe ${fmtDepth(shoe_m, unit)}, OD ${odStr}, grade ${c.grade || '—'}`;

    // cement (drawn first, so casing walls sit on top)
    const cemTop_m = typeof c.toc_m === 'number' ? c.toc_m : Math.max(top_m, shoe_m - 0.05 * td);
    const cemYTop = y(cemTop_m);
    const cemYShoe = y(shoe_m);
    const cemLabel = `Cement (${c.name || c.type || 'casing'}) — ${fmtDepth(cemTop_m, unit)} to ${fmtDepth(shoe_m, unit)}${typeof c.toc_m !== 'number' ? ' (TOC unknown, shoe patch)' : ''}`;
    const cemId = `cement:${origIdx}`;
    parts.push(`<g data-kind="cement" data-id="${cemId}" aria-label="${esc(cemLabel)}"${hl(cemId)}>`);
    parts.push(`<title>${esc(cemLabel)}</title>`);
    // left side
    parts.push(`<rect x="${cx - half - wallW}" y="${cemYTop}" width="${wallW}" height="${Math.max(0, cemYShoe - cemYTop)}" fill="#a8cdea" fill-opacity="0.55"/>`);
    // right side
    parts.push(`<rect x="${cx + half}" y="${cemYTop}" width="${wallW}" height="${Math.max(0, cemYShoe - cemYTop)}" fill="#a8cdea" fill-opacity="0.55"/>`);
    parts.push(`</g>`);

    // casing walls
    parts.push(`<g data-kind="casing" data-id="${id}" aria-label="${esc(label)}"${hl(id)}>`);
    parts.push(`<title>${esc(label)}</title>`);
    parts.push(`<rect x="${cx - half}" y="${yTop}" width="${wallW}" height="${Math.max(0, yShoe - yTop)}" fill="#8a93a1"/>`);
    parts.push(`<rect x="${cx + half - wallW}" y="${yTop}" width="${wallW}" height="${Math.max(0, yShoe - yTop)}" fill="#8a93a1"/>`);
    // shoe triangles (both walls)
    parts.push(`<polygon points="${cx - half - 3},${yShoe} ${cx - half + wallW + 3},${yShoe} ${cx - half + wallW / 2},${yShoe + 8}" fill="#8a93a1"/>`);
    parts.push(`<polygon points="${cx + half - wallW - 3},${yShoe} ${cx + half + 3},${yShoe} ${cx + half - wallW / 2},${yShoe + 8}" fill="#8a93a1"/>`);
    parts.push(`</g>`);
  });

  // innermost bore half-width, used by plugs/perforations/packers/open hole
  const innerHalf = nCasings ? baseHalf - (nCasings - 1) * stepHalf - 4 : baseHalf;
  const boreHalf = Math.max(6, innerHalf);

  // ---- open hole ----
  const deepestShoe = sortedCasings.length ? Math.max(...sortedCasings.map((x) => x.shoe_m)) : null;
  const ohIn = wb.openHole;
  const oh =
    ohIn && typeof ohIn.top_m === 'number' && typeof ohIn.bottom_m === 'number'
      ? { top_m: ohIn.top_m, bottom_m: ohIn.bottom_m }
      : deepestShoe !== null && td > deepestShoe
        ? { top_m: deepestShoe, bottom_m: td }
        : null;
  if (oh) {
    const id = 'openhole:0';
    const yTop = y(oh.top_m);
    const yBot = y(oh.bottom_m);
    const label = `Open hole — ${fmtDepth(oh.top_m, unit)} to ${fmtDepth(oh.bottom_m, unit)}`;
    parts.push(`<g data-kind="openhole" data-id="${id}" aria-label="${esc(label)}"${hl(id)}>`);
    parts.push(`<title>${esc(label)}</title>`);
    parts.push(`<rect x="${cx - boreHalf}" y="${yTop}" width="${boreHalf * 2}" height="${Math.max(0, yBot - yTop)}" fill="url(#wb-openhole-hatch)"/>`);
    parts.push(`</g>`);
  }

  // ---- zones (full-width translucent bands) ----
  zones.forEach((z, i) => {
    if (!z) return;
    const id = `zone:${i}`;
    const yTop = y(z.top_m);
    const yBot = y(z.bottom_m);
    const color = z.kind === 'hydrocarbon' ? '#e6c78a' : '#b9a7e6';
    const label = `Zone (${z.kind || '—'}) — ${fmtDepth(z.top_m, unit)} to ${fmtDepth(z.bottom_m, unit)}`;
    parts.push(`<g data-kind="zone" data-id="${id}" aria-label="${esc(label)}"${hl(id)}>`);
    parts.push(`<title>${esc(label)}</title>`);
    parts.push(`<rect x="${GUTTER_L}" y="${yTop}" width="${plotW}" height="${Math.max(0, yBot - yTop)}" fill="${color}" fill-opacity="0.18"/>`);
    parts.push(`</g>`);
  });

  // ---- formations (dashed line + name to the right of the bore) ----
  formations.forEach((f, i) => {
    if (!f) return;
    const id = `formation:${i}`;
    const fy = y(f.top_m);
    const label = `Formation top: ${f.name || '—'} at ${fmtDepth(f.top_m, unit)}`;
    parts.push(`<g data-kind="formation" data-id="${id}" aria-label="${esc(label)}"${hl(id)}>`);
    parts.push(`<title>${esc(label)}</title>`);
    parts.push(`<line x1="${GUTTER_L}" y1="${fy}" x2="${cx + boreHalf}" y2="${fy}" stroke="#e08a2e" stroke-width="1.5" stroke-dasharray="4,3"/>`);
    parts.push(`<text x="${cx + boreHalf + 6}" y="${fy + 3}" fill="${cInk}">${esc(f.name || '—')}</text>`);
    parts.push(`</g>`);
  });

  // ---- plugs ----
  plugs.forEach((p, i) => {
    if (!p) return;
    const id = `plug:${i}`;
    const yTop = y(p.top_m);
    const yBot = y(p.bottom_m);
    const label = `Plug ${p.n != null ? 'P' + p.n : '—'} (${p.kind || 'cement'}) — ${fmtDepth(p.top_m, unit)} to ${fmtDepth(p.bottom_m, unit)}, sacks: ${p.sacks != null ? p.sacks : '—'}`;
    parts.push(`<g data-kind="plug" data-id="${id}" aria-label="${esc(label)}"${hl(id)}>`);
    parts.push(`<title>${esc(label)}</title>`);
    if (p.kind === 'bridge' || p.kind === 'cibp') {
      const midY = y(p.top_m);
      const halfH = 8;
      parts.push(`<polygon points="${cx - boreHalf},${midY - halfH} ${cx},${midY} ${cx - boreHalf},${midY + halfH}" fill="#1d6b47"/>`);
      parts.push(`<polygon points="${cx + boreHalf},${midY - halfH} ${cx},${midY} ${cx + boreHalf},${midY + halfH}" fill="#1d6b47"/>`);
    } else {
      parts.push(`<rect x="${cx - boreHalf}" y="${yTop}" width="${boreHalf * 2}" height="${Math.max(2, yBot - yTop)}" fill="#1d6b47"/>`);
      if (p.n != null) {
        parts.push(`<text x="${cx}" y="${(yTop + Math.max(yTop + 2, yBot)) / 2 + 3}" text-anchor="middle" fill="#ffffff" font-size="10">P${esc(p.n)}</text>`);
      }
    }
    parts.push(`</g>`);
  });

  // ---- perforations (rows of small outward triangles on both walls) ----
  perforations.forEach((pf, i) => {
    if (!pf) return;
    const id = `perf:${i}`;
    const yTop = y(pf.top_m);
    const yBot = y(pf.bottom_m);
    const opacity = pf.status === 'squeezed' ? 0.45 : 1;
    const label = `Perforations — ${fmtDepth(pf.top_m, unit)} to ${fmtDepth(pf.bottom_m, unit)}, status: ${pf.status || '—'}`;
    parts.push(`<g data-kind="perf" data-id="${id}" aria-label="${esc(label)}"${hl(id)} fill-opacity="${opacity}">`);
    parts.push(`<title>${esc(label)}</title>`);
    const rowH = 6;
    const span = Math.max(rowH, yBot - yTop);
    const rows = Math.max(1, Math.floor(span / (rowH * 2)));
    for (let r = 0; r < rows; r++) {
      const ry = yTop + (r + 0.5) * (span / rows);
      parts.push(`<polygon points="${cx - boreHalf - 7},${ry} ${cx - boreHalf},${ry - 3} ${cx - boreHalf},${ry + 3}" fill="#d4453a"/>`);
      parts.push(`<polygon points="${cx + boreHalf + 7},${ry} ${cx + boreHalf},${ry - 3} ${cx + boreHalf},${ry + 3}" fill="#d4453a"/>`);
    }
    parts.push(`</g>`);
  });

  // ---- packers (opposed solid black triangles inside bore) ----
  packers.forEach((pk, i) => {
    if (!pk) return;
    const id = `packer:${i}`;
    const py = y(pk.depth_m);
    const label = `Packer at ${fmtDepth(pk.depth_m, unit)}`;
    parts.push(`<g data-kind="packer" data-id="${id}" aria-label="${esc(label)}"${hl(id)}>`);
    parts.push(`<title>${esc(label)}</title>`);
    parts.push(`<polygon points="${cx - boreHalf},${py - 6} ${cx},${py} ${cx - boreHalf},${py + 6}" fill="#000000"/>`);
    parts.push(`<polygon points="${cx + boreHalf},${py - 6} ${cx},${py} ${cx + boreHalf},${py + 6}" fill="#000000"/>`);
    parts.push(`</g>`);
  });

  // ---- notes (ⓘ glyph in right gutter) ----
  notes.forEach((n, i) => {
    if (!n) return;
    const id = `note:${i}`;
    const ny = typeof n.depth_m === 'number' ? y(n.depth_m) : y(0);
    const label = `Note at ${fmtDepth(n.depth_m, unit)}: ${n.text || '—'}`;
    parts.push(`<g data-kind="note" data-id="${id}" aria-label="${esc(label)}"${hl(id)}>`);
    parts.push(`<title>${esc(label)}</title>`);
    parts.push(`<text x="${W - GUTTER_R + 6}" y="${ny + 3}" fill="${cInk}">ⓘ</text>`);
    parts.push(`</g>`);
  });

  parts.push(`</svg>`);
  return parts.join('');
}
