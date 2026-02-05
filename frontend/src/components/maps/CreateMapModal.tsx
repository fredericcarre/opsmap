import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateMap } from '@/api/maps';
import { useToast } from '@/hooks/use-toast';

interface CreateMapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId?: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export function CreateMapModal({ open, onOpenChange, workspaceId }: CreateMapModalProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const createMap = useCreateMap();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [autoSlug, setAutoSlug] = useState(true);

  const handleNameChange = (value: string) => {
    setName(value);
    if (autoSlug) {
      setSlug(slugify(value));
    }
  };

  const handleSlugChange = (value: string) => {
    setSlug(value);
    setAutoSlug(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({
        title: 'Error',
        description: 'Map name is required',
        variant: 'destructive',
      });
      return;
    }

    try {
      const map = await createMap.mutateAsync({
        workspaceId: workspaceId || 'default',
        name: name.trim(),
        slug: slug || slugify(name),
        description: description.trim() || undefined,
      });

      toast({
        title: 'Map created',
        description: `"${map.name}" has been created successfully`,
      });

      // Reset form
      setName('');
      setSlug('');
      setDescription('');
      setAutoSlug(true);

      onOpenChange(false);

      // Navigate to the new map
      navigate(`/maps/${map.id}`);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create map',
        variant: 'destructive',
      });
    }
  };

  const handleClose = () => {
    setName('');
    setSlug('');
    setDescription('');
    setAutoSlug(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Map</DialogTitle>
            <DialogDescription>
              Create a new application map to visualize and manage your infrastructure.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="name" className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                id="name"
                placeholder="My Application"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <label htmlFor="slug" className="text-sm font-medium">
                Slug
              </label>
              <Input
                id="slug"
                placeholder="my-application"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                URL-friendly identifier. Auto-generated from name if left empty.
              </p>
            </div>

            <div className="grid gap-2">
              <label htmlFor="description" className="text-sm font-medium">
                Description
              </label>
              <textarea
                id="description"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="A brief description of this map..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMap.isPending}>
              {createMap.isPending ? 'Creating...' : 'Create Map'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
