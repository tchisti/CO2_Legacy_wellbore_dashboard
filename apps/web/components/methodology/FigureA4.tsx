'use client';

// Figure A-4 (adapted): legacy well Types 2–9 drawn against the strata they cross, from v2's
// index.html, as JSX. The drawing and its labels are v2's.
//
// Colour (spec §7): the figure's own page (background, border, rock body, and every label) takes the
// theme tokens, so it reads in light and dark. The coloured strata, the casing and open hole, and
// the red leak arrows are fixed drawing colours, in both themes, at their v2 hexes. They are domain
// colours, not rank colours, and never come from the --rank-* tokens.
//
// The labels written on the strata are drawn last, on top of the wells (v2 drew them underneath, so
// Types 2 and 3 cut through the words), in the ink token with a halo in the surface token. Their
// contrast is ink on surface (15:1 light, 14:1 dark) wherever they fall, so it does not depend on the
// layer colour: no single text colour reaches 4.5:1 on all four layers in both themes with a halo-free
// label that a well can also cross (v2's light-on-colour labels were 2.8:1 to 3.8:1).
//
// Non-text contrast (WCAG 1.4.11): the leak arrows, the open hole and the cement sheaths sit on a
// thin fixed near-black outline (OUTLINE), drawn beneath each mark. On every backdrop a mark meets
// (the rock body in either theme, each stratum, the plume) either the mark's own colour or its
// outline clears 3:1: the outline on the light rock body and on every stratum (4.0:1 to 15.7:1),
// the mark itself on the dark rock body (5.2:1 to 9.9:1), where a dark outline cannot show.
import { useId } from 'react';
import { ScrollRegion } from '@/components/methodology/Section';

/** The strata, as v2 drew them (fill, opacity). */
const STRATA = {
  usdw: '#3d85c8', // USDW / BGWP, protected groundwater
  seal: '#c94f47', // primary geologic seal (caprock)
  production: '#4f9257', // production formation
  reservoir: '#d9c84a', // storage reservoir
  plume: '#3b6fd4', // CO₂ plume
} as const;
const LEAK = '#ff6b5e'; // leak arrows: unprotected pathways
const OPEN_HOLE = '#d9a066'; // open hole is tan
const CEMENT = '#cfd6e2'; // light cement sheath around a casing
const CASING = '#454e60'; // dark casing
const CASING_EDGE = '#9aa4b5';
const INJECTOR_BORE = '#2f3b52';
const INJECTOR_EDGE = '#7fb2e5';
const INJECTOR_FLOW = '#9fd1ff';
/** The outline under the leak arrows, the open hole and the cement sheaths, in both themes. */
const OUTLINE = '#111418';
/** How far the outline shows beyond a mark, in figure units (px at 960 wide). */
const OUTLINE_W = 1.25;

const ARROW_ID = 'figure-a4-leak';

const FIGURE_A4_LABEL = 'Legacy well classification types, adapted after Arbad et al. 2024';

/** A label drawn over the strata and the wells: ink with a surface halo, so it reads over any of them. */
const HALO = 'fill-ink stroke-surface';
const HALO_PROPS = { strokeWidth: 4, strokeLinejoin: 'round', paintOrder: 'stroke' } as const;

const LEAK_W = 3;
/** The arrow head's size, in arrow stroke widths (the marker's units); its path is drawn in a 10-unit box. */
const HEAD = 7;
/**
 * The head's outline width, in its own units: twice OUTLINE_W at its drawn scale (LEAK_W × HEAD / 10
 * px per unit), painted under the fill, so OUTLINE_W shows outside it as along the shaft.
 */
const HEAD_OUTLINE = (2 * OUTLINE_W) / ((LEAK_W * HEAD) / 10);
const LEAK_PATH = { stroke: LEAK, strokeWidth: LEAK_W, fill: 'none', markerEnd: `url(#${ARROW_ID})` } as const;

/** A leak arrow: the red stroke and head over a near-black underlay (the head has its own outline). */
function Leak({ d }: { d: string }) {
  return (
    <>
      <path
        d={d}
        data-outline
        stroke={OUTLINE}
        strokeWidth={LEAK_W + 2 * OUTLINE_W}
        strokeLinecap="round"
        fill="none"
      />
      <path d={d} {...LEAK_PATH} />
    </>
  );
}

/** A rectangle drawn on its outline: the near-black underlay OUTLINE_W wider on every side. */
function OutlinedRect({ x, y, width, height, fill }: { x: number; y: number; width: number; height: number; fill: string }) {
  return (
    <>
      <rect
        data-outline
        x={x - OUTLINE_W}
        y={y - OUTLINE_W}
        width={width + 2 * OUTLINE_W}
        height={height + 2 * OUTLINE_W}
        fill={OUTLINE}
      />
      <rect x={x} y={y} width={width} height={height} fill={fill} />
    </>
  );
}

/** Open hole: tan, on its outline. */
const OpenHole = ({ x, y, height }: { x: number; y: number; height: number }) => (
  <OutlinedRect x={x} y={y} width={8} height={height} fill={OPEN_HOLE} />
);

/** A well's title above the section. */
function TypeLabel({ x, children }: { x: number; children: string }) {
  return (
    <text x={x} y="18" fontSize="13" fontWeight="700" textAnchor="middle" className="fill-ink">
      {children}
    </text>
  );
}

/** Surface casing or full string: a light cement sheath around dark casing. */
function Casing({ x, height }: { x: number; height: number }) {
  return (
    <>
      <OutlinedRect x={x} y={28} width={20} height={height} fill={CEMENT} />
      <rect x={x + 3} y="28" width="14" height={height} fill={CASING} stroke={CASING_EDGE} />
    </>
  );
}

export function FigureA4() {
  const captionId = useId();
  return (
    <figure className="grid max-w-[1040px] gap-2">
      <ScrollRegion labelledBy={captionId}>
        <svg
          viewBox="0 0 960 470"
          role="img"
          aria-label={FIGURE_A4_LABEL}
          aria-describedby={captionId}
          className="block w-full min-w-[820px] rounded-[10px] border border-line bg-surface"
        >
          <defs>
            <marker
              id={ARROW_ID}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth={HEAD}
              markerHeight={HEAD}
              orient="auto-start-reverse"
              overflow="visible"
            >
              <path
                d="M0,0 L10,5 L0,10 z"
                fill={LEAK}
                stroke={OUTLINE}
                strokeWidth={HEAD_OUTLINE}
                strokeLinejoin="round"
                paintOrder="stroke"
              />
            </marker>
          </defs>

          {/* stratigraphy */}
          <rect x="0" y="28" width="960" height="412" className="fill-(--hover)" />
          <rect x="0" y="70" width="960" height="26" fill={STRATA.usdw} opacity="0.9" />
          <rect x="0" y="230" width="960" height="30" fill={STRATA.seal} />
          <rect x="0" y="285" width="960" height="24" fill={STRATA.production} opacity="0.85" />
          <rect x="0" y="330" width="960" height="56" fill={STRATA.reservoir} opacity="0.8" />
          <ellipse cx="560" cy="358" rx="300" ry="20" fill={STRATA.plume} opacity="0.75" />
          <text x="952" y="434" fontSize="10" textAnchor="end" className="fill-muted-foreground">
            Not to scale · Type 1 (no records) cannot be illustrated
          </text>

          {/* depth arrow */}
          <line x1="26" y1="105" x2="26" y2="420" strokeWidth="1.5" className="stroke-muted-foreground" />
          <path d="M22,420 L26,430 L30,420 z" className="fill-muted-foreground" />

          {/* casing = dark with a light cement sheath; open hole = tan */}
          {/* Type 2: fully open hole to the reservoir, leaks everywhere */}
          <g>
            <TypeLabel x={90}>Type 2</TypeLabel>
            <OpenHole x={86} y={28} height={360} />
            <Leak d="M96,370 C110,320 108,300 100,262" />
            <Leak d="M100,225 C112,180 110,140 100,100" />
            <Leak d="M100,66 C110,52 112,46 116,38" />
          </g>
          {/* Type 3: surface casing through the USDW, open below */}
          <g>
            <TypeLabel x={190}>Type 3</TypeLabel>
            <Casing x={180} height={84} />
            <OpenHole x={186} y={112} height={276} />
            <Leak d="M196,370 C210,330 208,300 200,262" />
            <Leak d="M200,225 C212,190 210,160 202,120" />
          </g>
          {/* Type 4: cased and cemented through the seal, open at the reservoir */}
          <g>
            <TypeLabel x={290}>Type 4</TypeLabel>
            <Casing x={280} height={244} />
            <OpenHole x={286} y={272} height={116} />
            <Leak d="M296,370 C312,352 314,330 306,308" />
          </g>
          {/* Type 5: open hole ends in the seal */}
          <g>
            <TypeLabel x={390}>Type 5</TypeLabel>
            <OpenHole x={386} y={28} height={222} />
            <Leak d="M396,240 C410,190 408,150 400,100" />
            <Leak d="M400,66 C410,52 412,46 416,38" />
          </g>
          {/* Type 6: surface casing, open hole ends in the seal */}
          <g>
            <TypeLabel x={478}>Type 6</TypeLabel>
            <Casing x={468} height={84} />
            <OpenHole x={474} y={112} height={138} />
            <Leak d="M484,240 C496,205 494,170 486,125" />
          </g>
          {/* Injector */}
          <g>
            <text x="588" y="18" fontSize="13" fontWeight="800" textAnchor="middle" className="fill-ink">
              CO₂ Injector (Class VI)
            </text>
            <OutlinedRect x={576} y={28} width={24} height={360} fill={CEMENT} />
            <rect x="580" y="28" width="16" height="360" fill={INJECTOR_BORE} stroke={INJECTOR_EDGE} strokeWidth="2" />
            <line x1="588" y1="30" x2="588" y2="386" stroke={INJECTOR_FLOW} strokeWidth="2" strokeDasharray="6 4" />
          </g>
          {/* Type 7: fully cased and cemented through the reservoir */}
          <g>
            <TypeLabel x={690}>Type 7</TypeLabel>
            <Casing x={680} height={360} />
          </g>
          {/* Type 8: cased and cemented, ends in the seal */}
          <g>
            <TypeLabel x={790}>Type 8</TypeLabel>
            <Casing x={780} height={222} />
          </g>
          {/* Type 9: cased, ends above the seal */}
          <g>
            <TypeLabel x={880}>Type 9</TypeLabel>
            <Casing x={870} height={160} />
          </g>

          {/* labels over the strata and the wells */}
          <g {...HALO_PROPS} className={HALO}>
            <text x="8" y="87" fontSize="12" fontWeight="700">
              USDW / BGWP (protected groundwater)
            </text>
            <text x="8" y="250" fontSize="12" fontWeight="700">
              PRIMARY GEOLOGIC SEAL (caprock)
            </text>
            <text x="8" y="301" fontSize="11">
              Production formation
            </text>
            <text x="8" y="345" fontSize="12" fontWeight="700">
              STORAGE RESERVOIR
            </text>
            <text x="440" y="374" fontSize="11">
              CO₂ plume
            </text>
            {/* Clear of the seal's label: it reads upward from y 200, between the USDW and the seal. */}
            <text x="18" y="200" fontSize="10" transform="rotate(-90 18 200)">
              Depth
            </text>
          </g>
        </svg>
      </ScrollRegion>
      <figcaption id={captionId} className="text-xs text-muted-foreground">
        Figure A-4 (adapted) &mdash; legacy well classification by penetration and protection. Original artwork redrawn for
        this dashboard; leak arrows mark unprotected pathways. Casing/cement shown dark/light; open hole shown tan.
      </figcaption>
    </figure>
  );
}
