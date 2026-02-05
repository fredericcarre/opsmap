import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import mermaid from 'mermaid';
import {
  ArrowLeft,
  Share2,
  RefreshCw,
} from 'lucide-react';
import { useMap, useComponents, useComponentAction } from '@/api/maps';
import { useWebSocket } from '@/hooks/use-websocket';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, getStatusColor, getStatusText } from '@/lib/utils';
import { PermissionsModal } from '@/components/maps/PermissionsModal';
import { ComponentPanel } from '@/components/maps/ComponentPanel';
import type { Component } from '@/types';

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'basis',
  },
});

function generateMermaidDiagram(components: Component[]): string {
  const lines = ['graph TD'];

  // Add nodes
  components.forEach((comp) => {
    const statusClass =
      comp.status === 'ok'
        ? ':::ok'
        : comp.status === 'error'
        ? ':::error'
        : comp.status === 'warning'
        ? ':::warning'
        : '';
    lines.push(`    ${comp.externalId}["${comp.name}"]${statusClass}`);
  });

  // Add edges based on dependencies
  components.forEach((comp) => {
    const deps = comp.config.dependencies || [];
    deps.forEach((dep) => {
      lines.push(`    ${dep} --> ${comp.externalId}`);
    });
  });

  // Add styles
  lines.push('    classDef ok fill:#22c55e,stroke:#16a34a,color:#fff');
  lines.push('    classDef warning fill:#f59e0b,stroke:#d97706,color:#fff');
  lines.push('    classDef error fill:#ef4444,stroke:#dc2626,color:#fff');

  return lines.join('\n');
}

export function MapViewPage() {
  const { mapId } = useParams<{ mapId: string }>();
  const diagramRef = useRef<HTMLDivElement>(null);
  const [selectedComponent, setSelectedComponent] = useState<Component | null>(null);
  const [showPermissions, setShowPermissions] = useState(false);

  const { data: map, isLoading: mapLoading } = useMap(mapId!);
  const { data: components, isLoading: componentsLoading, refetch } = useComponents(mapId!);
  const componentAction = useComponentAction();

  // WebSocket for real-time updates
  const { componentStatuses } = useWebSocket(mapId!);

  // Merge WebSocket statuses with components
  const componentsWithStatus = components?.map((comp) => ({
    ...comp,
    status: componentStatuses[comp.id] || comp.status || 'unknown',
  }));

  // Render mermaid diagram
  useEffect(() => {
    if (!componentsWithStatus || !diagramRef.current) return;

    const renderDiagram = async () => {
      const diagram = generateMermaidDiagram(componentsWithStatus);
      try {
        const { svg } = await mermaid.render('mermaid-diagram', diagram);
        if (diagramRef.current) {
          diagramRef.current.innerHTML = svg;

          // Add click handlers to nodes
          const nodes = diagramRef.current.querySelectorAll<HTMLElement>('.node');
          nodes.forEach((node) => {
            const id = node.id?.replace('flowchart-', '').replace(/-\d+$/, '');
            const component = componentsWithStatus.find((c) => c.externalId === id);
            if (component) {
              node.style.cursor = 'pointer';
              node.addEventListener('click', () => setSelectedComponent(component));
            }
          });
        }
      } catch (e) {
        console.error('Mermaid render error:', e);
      }
    };

    renderDiagram();
  }, [componentsWithStatus]);

  const handleAction = async (
    componentId: string,
    action: 'start' | 'stop' | 'restart'
  ) => {
    if (!mapId) return;
    await componentAction.mutateAsync({ mapId, componentId, action });
  };

  if (mapLoading || componentsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!map) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Map not found</p>
        <Button asChild className="mt-4">
          <Link to="/">Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{map.name}</h1>
            {map.description && (
              <p className="text-muted-foreground">{map.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowPermissions(true)}>
            <Share2 className="h-4 w-4 mr-2" />
            Share
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Diagram */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Architecture</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              ref={diagramRef}
              className="min-h-[400px] flex items-center justify-center"
            />
          </CardContent>
        </Card>

        {/* Component List / Details */}
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedComponent ? selectedComponent.name : 'Components'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedComponent ? (
              <ComponentPanel
                component={selectedComponent}
                onAction={handleAction}
                onClose={() => setSelectedComponent(null)}
                isLoading={componentAction.isPending}
              />
            ) : (
              <div className="space-y-2">
                {componentsWithStatus?.map((comp) => (
                  <button
                    key={comp.id}
                    className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-accent transition-colors text-left"
                    onClick={() => setSelectedComponent(comp)}
                  >
                    <div className="flex items-center space-x-3">
                      <div
                        className={cn(
                          'h-3 w-3 rounded-full',
                          getStatusColor(comp.status || 'unknown')
                        )}
                      />
                      <div>
                        <p className="font-medium">{comp.name}</p>
                        <p className="text-xs text-muted-foreground">{comp.type}</p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {getStatusText(comp.status || 'unknown')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Permissions Modal */}
      <PermissionsModal
        mapId={mapId!}
        open={showPermissions}
        onOpenChange={setShowPermissions}
      />
    </div>
  );
}
