import { useState } from 'react';
import {
  User,
  Users,
  Link as LinkIcon,
  Copy,
  Trash2,
  Plus,
} from 'lucide-react';
import {
  useMapPermissions,
  useGrantPermission,
  useRevokePermission,
  useCreateShareLink,
} from '@/api/maps';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { formatDate } from '@/lib/utils';

interface PermissionsModalProps {
  mapId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PermissionsModal({
  mapId,
  open,
  onOpenChange,
}: PermissionsModalProps) {
  const { toast } = useToast();
  const { data: permissions, isLoading } = useMapPermissions(mapId);
  const grantPermission = useGrantPermission();
  const revokePermission = useRevokePermission();
  const createShareLink = useCreateShareLink();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');

  const handleGrantAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await grantPermission.mutateAsync({ mapId, email, role });
      setEmail('');
      toast({
        title: 'Access granted',
        description: `${email} now has ${role} access`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to grant access';
      toast({
        variant: 'destructive',
        title: 'Error',
        description: message,
      });
    }
  };

  const handleRevoke = async (userId: string, userEmail: string) => {
    try {
      await revokePermission.mutateAsync({ mapId, userId });
      toast({
        title: 'Access revoked',
        description: `${userEmail} no longer has access`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to revoke access',
      });
    }
  };

  const handleCreateLink = async () => {
    try {
      const result = await createShareLink.mutateAsync({
        mapId,
        role: 'viewer',
      });
      await navigator.clipboard.writeText(result.url);
      toast({
        title: 'Link created',
        description: 'Share link copied to clipboard',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create share link',
      });
    }
  };

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/shared/${token}`;
    await navigator.clipboard.writeText(url);
    toast({
      title: 'Copied',
      description: 'Share link copied to clipboard',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share Map</DialogTitle>
          <DialogDescription>
            Manage who has access to this map
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Add user form */}
            <form onSubmit={handleGrantAccess} className="flex gap-2">
              <Input
                placeholder="Email address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <select
                className="px-3 py-2 border rounded-md bg-background"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="viewer">Viewer</option>
                <option value="operator">Operator</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
              <Button type="submit" disabled={grantPermission.isPending}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </form>

            {/* Owner */}
            {permissions?.owner && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Owner</h4>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center space-x-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">
                        {permissions.owner.name || permissions.owner.email}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {permissions.owner.email}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                    Owner
                  </span>
                </div>
              </div>
            )}

            {/* Users */}
            {permissions?.users && permissions.users.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Users ({permissions.users.length})
                </h4>
                <div className="space-y-2">
                  {permissions.users.map((perm) => (
                    <div
                      key={perm.user?.id}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                          <User className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-medium">
                            {perm.user?.name || perm.user?.email}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {perm.user?.email}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs bg-muted px-2 py-1 rounded capitalize">
                          {perm.role}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            handleRevoke(perm.user!.id, perm.user!.email)
                          }
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Share Links */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Share Links
                </h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCreateLink}
                  disabled={createShareLink.isPending}
                >
                  <LinkIcon className="h-4 w-4 mr-1" />
                  Create Link
                </Button>
              </div>
              {permissions?.shareLinks && permissions.shareLinks.length > 0 ? (
                <div className="space-y-2">
                  {permissions.shareLinks.map((link) => (
                    <div
                      key={link.id}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div>
                        <p className="font-mono text-sm">{link.token.slice(0, 16)}...</p>
                        <p className="text-xs text-muted-foreground">
                          {link.role} - Used {link.useCount} times
                          {link.expiresAt && ` - Expires ${formatDate(link.expiresAt)}`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyLink(link.token)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No share links yet
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
