'use client';

// The well page's tabs (spec §4.3): Assessment | Construction | History. The chosen tab is owned by
// the page (it lives in the URL, lib/use-well-tab.ts); only the active panel is mounted, so the
// history is read only when it is shown. Styled like the section tabs: an accent underline.
import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WELL_TABS, parseWellTab, type WellTab } from '@/lib/routes';

const LABEL: Record<WellTab, string> = {
  assessment: 'Assessment',
  construction: 'Construction',
  history: 'History',
};

export function WellTabs({
  tab,
  onTabChange,
  panels,
}: {
  tab: WellTab;
  onTabChange: (tab: WellTab) => void;
  panels: Record<WellTab, ReactNode>;
}) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(parseWellTab(v))} className="gap-6">
      <TabsList
        variant="line"
        aria-label="Well sections"
        className="h-auto w-full justify-start gap-6 rounded-none border-b p-0 group-data-horizontal/tabs:h-10"
      >
        {WELL_TABS.map((t) => (
          <TabsTrigger
            key={t}
            value={t}
            className="h-10 flex-none rounded-sm px-0 text-sm font-normal text-muted-foreground after:bg-primary group-data-horizontal/tabs:after:-bottom-px hover:text-ink data-active:font-medium data-active:text-ink"
          >
            {LABEL[t]}
          </TabsTrigger>
        ))}
      </TabsList>
      {WELL_TABS.map((t) => (
        <TabsContent key={t} value={t}>
          {panels[t]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
