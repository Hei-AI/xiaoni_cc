import React from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  NodeProps,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Badge } from '@/components/ui/badge';
import { cn, formatTimestamp } from '@/lib/utils';
import { TraceFlowNode, TraceFlowViewModel } from '@/types';

interface TraceCanvasProps {
  viewModel: TraceFlowViewModel;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

type TraceCanvasNodeData = {
  traceNode: TraceFlowNode;
  [key: string]: unknown;
};

type TraceCanvasReactNode = Node<TraceCanvasNodeData>;

function statusTone(status: string) {
  switch (status) {
    case 'success':
      return 'border-[hsl(var(--success))]/35 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]';
    case 'error':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    default:
      return 'border-[hsl(var(--warning))]/35 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]';
  }
}

function kindTone(kind: TraceFlowNode['kind']) {
  switch (kind) {
    case 'ingress':
    case 'phase':
      return 'border-[hsl(var(--info))]/20 bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]';
    case 'turn':
      return 'border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning))]/12 text-[hsl(var(--warning))]';
    case 'llm':
      return 'border-sky-500/20 bg-sky-500/10 text-sky-700';
    case 'tool':
      return 'border-orange-500/20 bg-orange-500/10 text-orange-700';
    case 'http':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700';
    case 'delivery':
      return 'border-[hsl(var(--success))]/20 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]';
    case 'terminal':
      return 'border-violet-500/20 bg-violet-500/10 text-violet-700';
    default:
      return 'border-border bg-muted/60 text-foreground';
  }
}

function nodeLabel(kind: TraceFlowNode['kind']) {
  switch (kind) {
    case 'ingress':
      return 'Ingress';
    case 'phase':
      return 'Phase';
    case 'turn':
      return 'Agent Turn';
    case 'llm':
      return 'LLM';
    case 'tool':
      return 'Tool';
    case 'http':
      return 'HTTP';
    case 'delivery':
      return 'Delivery';
    case 'terminal':
      return 'Terminal';
    default:
      return 'Node';
  }
}

function TraceCardNode({ data, selected }: NodeProps<TraceCanvasReactNode>) {
  const traceNode = data.traceNode;

  return (
    <div
      className={cn(
        'group min-w-[172px] rounded-[18px] border bg-white/95 px-3.5 py-3 shadow-[0_14px_32px_rgba(15,23,42,0.08)] backdrop-blur',
        selected ? 'border-[hsl(var(--info))] shadow-[0_14px_32px_rgba(33,105,255,0.18)]' : 'border-border'
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-slate-400" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-slate-400" />

      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground shadow-sm"
      >
        点击右侧查看详情
      </NodeToolbar>

      <div className={cn('mb-2 inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]', kindTone(traceNode.kind))}>
        {nodeLabel(traceNode.kind)}
      </div>
      <div className="space-y-1">
        <div className="text-[15px] font-semibold leading-tight text-foreground">{traceNode.title}</div>
        {traceNode.subtitle ? <div className="text-[12px] text-muted-foreground">{traceNode.subtitle}</div> : null}
      </div>
      {traceNode.meta.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {traceNode.meta.slice(0, 3).map((item) => (
            <Badge key={`${traceNode.id}-${item.label}`} variant="outline" className="border-border/90 bg-muted/40 text-[10px] font-normal">
              {item.value}
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="mt-2 text-[12px] leading-5 text-foreground/85">{traceNode.summary}</div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', statusTone(traceNode.status))}>
          {traceNode.status}
        </div>
        {traceNode.startedAt ? (
          <div className="text-[10px] text-muted-foreground">{formatTimestamp(traceNode.startedAt, { fallback: 'n/a' })}</div>
        ) : null}
      </div>
    </div>
  );
}

function TurnGroupNode({ data, selected }: NodeProps<TraceCanvasReactNode>) {
  const traceNode = data.traceNode;

  return (
    <div
      className={cn(
        'h-full w-full rounded-[24px] border-2 border-dashed border-[hsl(var(--warning))]/35 bg-[hsl(var(--warning))]/8 p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]',
        selected && 'border-[hsl(var(--info))]/60'
      )}
    >
      <Handle type="target" position={Position.Left} className="!top-10 !h-2.5 !w-2.5 !border-0 !bg-[hsl(var(--warning))]" />
      <Handle type="source" position={Position.Right} className="!top-10 !h-2.5 !w-2.5 !border-0 !bg-[hsl(var(--warning))]" />
      <div className="inline-flex rounded-full border border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning))]/12 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--warning))]">
        Agent Turn
      </div>
      <div className="mt-2 text-lg font-semibold text-foreground">{traceNode.title}</div>
      <div className="mt-1 max-w-lg text-sm text-muted-foreground">{traceNode.summary}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {traceNode.meta.map((item) => (
          <Badge key={`${traceNode.id}-${item.label}`} variant="outline" className="border-border/80 bg-white/60 text-xs font-normal">
            {item.label}: {item.value}
          </Badge>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = {
  traceNode: TraceCardNode,
  turnGroup: TurnGroupNode,
};

function toReactFlowNodes(viewModel: TraceFlowViewModel, selectedNodeId: string | null): TraceCanvasReactNode[] {
  return viewModel.nodes.map((traceNode) => ({
    id: traceNode.id,
    type: traceNode.kind === 'turn' ? 'turnGroup' : 'traceNode',
    position: { x: traceNode.x, y: traceNode.y },
    parentId: traceNode.parentId,
    extent: traceNode.parentId ? 'parent' : undefined,
    draggable: true,
    selectable: true,
    selected: traceNode.id === selectedNodeId,
    style: traceNode.kind === 'turn'
      ? { width: traceNode.width, height: traceNode.height, zIndex: 0 }
      : { width: traceNode.width, height: traceNode.height, zIndex: 10 },
    data: { traceNode },
  }));
}

function toReactFlowEdges(viewModel: TraceFlowViewModel): Edge[] {
  return viewModel.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: 'smoothstep',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: '#74839a',
      width: 22,
      height: 22,
    },
    style: {
      stroke: '#74839a',
      strokeWidth: 2.4,
    },
    labelStyle: {
      fill: '#617084',
      fontSize: 11,
      fontWeight: 600,
    },
    labelBgStyle: {
      fill: '#f8f6f3',
      fillOpacity: 0.92,
    },
  }));
}

export function TraceCanvas({ viewModel, selectedNodeId, onSelectNode }: TraceCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<TraceCanvasReactNode>(toReactFlowNodes(viewModel, selectedNodeId));
  const edges = React.useMemo(() => toReactFlowEdges(viewModel), [viewModel]);

  React.useEffect(() => {
    setNodes(toReactFlowNodes(viewModel, selectedNodeId));
  }, [selectedNodeId, setNodes, viewModel]);

  return (
    <div className="h-[720px] overflow-hidden rounded-[22px] border border-border bg-[radial-gradient(circle_at_1px_1px,rgba(215,205,193,0.72)_1px,transparent_1px)] shadow-[0_10px_30px_rgba(15,23,42,0.06)] [background-size:22px_22px] sm:h-[780px] xl:h-[860px]">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_event, node) => onSelectNode(node.id)}
          onPaneClick={() => undefined}
          fitView
          minZoom={0.4}
          maxZoom={1.8}
          defaultEdgeOptions={{
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#74839a',
            },
          }}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          className="bg-transparent"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(189,176,162,0.58)" />
          <MiniMap
            pannable
            zoomable
            className="!bottom-4 !right-4 !h-[92px] !w-[152px] overflow-hidden rounded-xl border border-border bg-white/90"
            nodeColor={(node) => {
              if (node.type === 'turnGroup') {
                return '#f0c77a';
              }
              return '#8aa4d8';
            }}
          />
          <Controls className="!bottom-4 !left-4 !border !border-border !bg-background/95 !shadow-sm" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
