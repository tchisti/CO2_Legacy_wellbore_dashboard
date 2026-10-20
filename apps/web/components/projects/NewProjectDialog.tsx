'use client';

// "New project…" from the project switcher: the first-run create form in a dialog.
import type { Project } from '@lwa/engine';
import { CreateProjectForm } from '@/components/projects/CreateProjectForm';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: Project) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Start with a name. Injectors, formations and the jurisdiction are set in Project settings.
          </DialogDescription>
        </DialogHeader>
        <CreateProjectForm autoFocus onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  );
}
