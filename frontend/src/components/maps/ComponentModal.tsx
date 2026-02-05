import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useCreateComponent, useUpdateComponent, useDeleteComponent } from '@/api/maps';
import type { Component } from '@/types';

const COMPONENT_TYPES = [
  { value: 'service', label: 'Service' },
  { value: 'database', label: 'Database' },
  { value: 'queue', label: 'Message Queue' },
  { value: 'cache', label: 'Cache' },
  { value: 'api', label: 'API Gateway' },
  { value: 'loadbalancer', label: 'Load Balancer' },
  { value: 'storage', label: 'Storage' },
  { value: 'container', label: 'Container' },
  { value: 'vm', label: 'Virtual Machine' },
  { value: 'other', label: 'Other' },
];

interface ComponentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapId: string;
  component?: Component | null; // If provided, edit mode
  existingComponents?: Component[]; // For dependency selection
}

export function ComponentModal({
  open,
  onOpenChange,
  mapId,
  component,
  existingComponents = [],
}: ComponentModalProps) {
  const { toast } = useToast();
  const createComponent = useCreateComponent();
  const updateComponent = useUpdateComponent();
  const deleteComponent = useDeleteComponent();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isEditing = !!component;

  // Form state
  const [externalId, setExternalId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('service');
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [configJson, setConfigJson] = useState('{}');
  const [configError, setConfigError] = useState<string | null>(null);

  // Reset form when modal opens/closes or component changes
  useEffect(() => {
    if (open) {
      if (component) {
        setExternalId(component.externalId);
        setName(component.name);
        setType(component.type);
        setDependencies(component.config.dependencies || []);
        // Convert config to JSON, excluding dependencies (we handle separately)
        const { dependencies: _, ...restConfig } = component.config;
        setConfigJson(JSON.stringify(restConfig, null, 2));
      } else {
        setExternalId('');
        setName('');
        setType('service');
        setDependencies([]);
        setConfigJson('{}');
      }
      setConfigError(null);
    }
  }, [open, component]);

  // Auto-generate externalId from name
  const handleNameChange = (value: string) => {
    setName(value);
    if (!isEditing && !externalId) {
      setExternalId(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    }
  };

  // Validate JSON config
  const validateConfig = (json: string): boolean => {
    try {
      JSON.parse(json);
      setConfigError(null);
      return true;
    } catch {
      setConfigError('Invalid JSON configuration');
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!externalId.trim() || !name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'External ID and Name are required',
        variant: 'destructive',
      });
      return;
    }

    if (!validateConfig(configJson)) {
      return;
    }

    try {
      const parsedConfig = JSON.parse(configJson);
      const fullConfig = {
        ...parsedConfig,
        dependencies: dependencies.length > 0 ? dependencies : undefined,
      };

      if (isEditing && component) {
        await updateComponent.mutateAsync({
          mapId,
          componentId: component.id,
          data: {
            name,
            type,
            config: fullConfig,
          },
        });
        toast({
          title: 'Component Updated',
          description: `${name} has been updated successfully`,
        });
      } else {
        await createComponent.mutateAsync({
          mapId,
          data: {
            externalId,
            name,
            type,
            config: Object.keys(fullConfig).length > 0 ? fullConfig : undefined,
          },
        });
        toast({
          title: 'Component Created',
          description: `${name} has been created successfully`,
        });
      }
      onOpenChange(false);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: isEditing ? 'Update Failed' : 'Create Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!component) return;

    try {
      await deleteComponent.mutateAsync({
        mapId,
        componentId: component.id,
      });
      toast({
        title: 'Component Deleted',
        description: `${component.name} has been deleted`,
      });
      setShowDeleteConfirm(false);
      onOpenChange(false);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: 'Delete Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const toggleDependency = (depId: string) => {
    setDependencies((prev) =>
      prev.includes(depId)
        ? prev.filter((d) => d !== depId)
        : [...prev, depId]
    );
  };

  const isLoading = createComponent.isPending || updateComponent.isPending;
  const availableDependencies = existingComponents.filter(
    (c) => c.externalId !== externalId
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isEditing ? (
                <>
                  <Pencil className="h-5 w-5" />
                  Edit Component
                </>
              ) : (
                <>
                  <Plus className="h-5 w-5" />
                  Create Component
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the component configuration'
                : 'Add a new component to the map'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* External ID */}
            <div className="space-y-2">
              <Label htmlFor="externalId">External ID *</Label>
              <Input
                id="externalId"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="my-service"
                disabled={isEditing}
                className={isEditing ? 'bg-muted' : ''}
              />
              {isEditing && (
                <p className="text-xs text-muted-foreground">
                  External ID cannot be changed after creation
                </p>
              )}
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="My Service"
              />
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {COMPONENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Dependencies */}
            {availableDependencies.length > 0 && (
              <div className="space-y-2">
                <Label>Dependencies</Label>
                <div className="flex flex-wrap gap-2 p-2 border rounded-md min-h-[40px]">
                  {availableDependencies.map((c) => (
                    <button
                      key={c.externalId}
                      type="button"
                      onClick={() => toggleDependency(c.externalId)}
                      className={`px-2 py-1 text-xs rounded-full transition-colors ${
                        dependencies.includes(c.externalId)
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted hover:bg-muted/80'
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Click to select components that this component depends on
                </p>
              </div>
            )}

            {/* Advanced Config */}
            <div className="space-y-2">
              <Label htmlFor="config">Advanced Configuration (JSON)</Label>
              <Textarea
                id="config"
                value={configJson}
                onChange={(e) => {
                  setConfigJson(e.target.value);
                  validateConfig(e.target.value);
                }}
                placeholder="{}"
                rows={6}
                className="font-mono text-sm"
              />
              {configError && (
                <p className="text-xs text-destructive">{configError}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Optional: Configure checks, actions, agent selector, etc.
              </p>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {isEditing && (
              <Button
                variant="destructive"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isLoading}
                className="sm:mr-auto"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Create Component'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Component</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{component?.name}&quot;? This action cannot be undone.
              {component?.config.dependencies && component.config.dependencies.length > 0 && (
                <span className="block mt-2 text-yellow-600">
                  Warning: This component has dependencies that may be affected.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteComponent.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
