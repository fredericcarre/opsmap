import { Link } from 'react-router-dom';
import {
  Plus,
  Map as MapIcon,
  Clock,
  Users,
  MoreVertical,
  CheckCircle,
  AlertCircle,
  XCircle,
} from 'lucide-react';
import { useMaps } from '@/api/maps';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/utils';
import type { Map } from '@/types';

function getMapStatusIcon(status: string) {
  switch (status) {
    case 'ok':
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case 'warning':
      return <AlertCircle className="h-5 w-5 text-yellow-500" />;
    case 'error':
      return <XCircle className="h-5 w-5 text-red-500" />;
    default:
      return <div className="h-5 w-5 rounded-full bg-gray-300" />;
  }
}

function MapCard({ map }: { map: Map }) {
  // Mock status for now - will come from WebSocket in real implementation
  const status = 'ok';

  return (
    <Link to={`/maps/${map.id}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              {getMapStatusIcon(status)}
              <div>
                <CardTitle className="text-lg">{map.name}</CardTitle>
                <CardDescription>{map.slug}</CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={(e) => e.preventDefault()}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {map.description && (
            <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
              {map.description}
            </p>
          )}
          <div className="flex items-center space-x-4 text-xs text-muted-foreground">
            <div className="flex items-center space-x-1">
              <Clock className="h-3 w-3" />
              <span>Updated {formatDate(map.updatedAt)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function DashboardPage() {
  const { data: maps, isLoading, error } = useMaps();

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            View and manage your application maps
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Map
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 bg-muted rounded w-1/2" />
                <div className="h-4 bg-muted rounded w-1/3 mt-2" />
              </CardHeader>
              <CardContent>
                <div className="h-4 bg-muted rounded w-full" />
                <div className="h-4 bg-muted rounded w-2/3 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to load maps. Please try again.</p>
          </CardContent>
        </Card>
      ) : maps && maps.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {maps.map((map) => (
            <MapCard key={map.id} map={map} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MapIcon className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No maps yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first application map to get started
            </p>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Map
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
