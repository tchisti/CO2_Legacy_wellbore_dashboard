'use client';

// The active project in the top bar; the menu switches between projects or starts a new one.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronsUpDownIcon, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@lwa/engine';
import { NewProjectDialog } from '@/components/projects/NewProjectDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProjectId, useProjects } from '@/lib/project-context';
import { ROUTES } from '@/lib/routes';

export function ProjectSwitcher() {
  const router = useRouter();
  const { projects, activeProject } = useProjects();
  const [, setProjectId] = useProjectId();
  const [creating, setCreating] = useState(false);

  function created(project: Project) {
    setProjectId(project.id);
    setCreating(false);
    toast.success(`Project “${project.name}” created`);
    router.push(ROUTES.portfolio);
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          {/* shrink + min-w-0 let the button give way to the profile menu; the name truncates. */}
          <Button variant="ghost" className="h-8 min-w-0 max-w-[min(28rem,60vw)] shrink gap-2 px-2">
            <span className="sr-only text-xs font-normal text-muted-foreground sm:not-sr-only">Project</span>
            <span className="min-w-0 truncate">{activeProject?.name ?? 'None'}</span>
            <ChevronsUpDownIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Projects</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={activeProject?.id ?? ''} onValueChange={setProjectId}>
            {projects?.map((p) => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                <span className="truncate">{p.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <PlusIcon aria-hidden="true" />
            New project…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewProjectDialog open={creating} onOpenChange={setCreating} onCreated={created} />
    </>
  );
}
