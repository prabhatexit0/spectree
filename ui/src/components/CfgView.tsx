import {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from 'react';
import type { Cfg, CfgBlock, CfgEdge, CfgBlockKind } from '../lib/cfg';

// ============================================
// Types
// ============================================

interface LayoutBlock {
  block: CfgBlock;
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
  row: number;
}

interface CfgViewProps {
  cfg: Cfg;
  hoveredBlockId: string | null;
  onBlockHover: (blockId: string) => void;
  onBlockLeave: () => void;
}

// ============================================
// Constants
// ============================================

const BLOCK_FONT = '12px "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace';
const BLOCK_FONT_SMALL = '10px "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace';
const BLOCK_PADDING_X = 16;
const BLOCK_PADDING_Y = 10;
const BLOCK_MIN_W = 100;
const BLOCK_MAX_W = 280;
const BLOCK_GAP_X = 60;
const BLOCK_GAP_Y = 56;
const BLOCK_RADIUS = 8;
const EDGE_ARROW_SIZE = 6;

const BLOCK_COLORS: Record<CfgBlockKind, { bg: string; border: string; text: string }> = {
  entry:     { bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.5)',  text: '#4ade80' },
  exit:      { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.4)',  text: '#f87171' },
  statement: { bg: 'rgba(148,163,184,0.10)',border: 'rgba(148,163,184,0.25)',text: '#94a3b8' },
  branch:    { bg: 'rgba(250,204,21,0.12)', border: 'rgba(250,204,21,0.4)', text: '#facc15' },
  loop:      { bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.4)', text: '#c084fc' },
  return:    { bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.3)',  text: '#f87171' },
  match:     { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.4)', text: '#60a5fa' },
};

const EDGE_COLOR = 'rgba(255,255,255,0.12)';
const EDGE_LABEL_COLOR = 'rgba(255,255,255,0.5)';
const HOVER_BORDER = 'rgba(250,204,21,0.7)';
const HOVER_BG = 'rgba(250,204,21,0.08)';

// ============================================
// Text measurement
// ============================================

let measureCtx: CanvasRenderingContext2D | null = null;

function measureText(text: string, font: string = BLOCK_FONT): number {
  if (!measureCtx) {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d')!;
  }
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function getBlockDimensions(block: CfgBlock): { width: number; height: number } {
  const labelW = measureText(block.label);
  const stmtWidths = block.statements.map(s => measureText(s, BLOCK_FONT_SMALL));
  const maxTextW = Math.max(labelW, ...stmtWidths);
  const width = Math.min(BLOCK_MAX_W, Math.max(BLOCK_MIN_W, maxTextW + BLOCK_PADDING_X * 2));
  const lineH = 16;
  const stmtH = block.statements.length > 0 ? block.statements.length * lineH + 4 : 0;
  const height = BLOCK_PADDING_Y * 2 + 14 + stmtH;
  return { width, height };
}

// ============================================
// Layered graph layout (simplified Sugiyama)
// ============================================

function layoutCfg(cfg: Cfg): LayoutBlock[] {
  if (cfg.blocks.length === 0) return [];

  // Build adjacency
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  for (const b of cfg.blocks) {
    successors.set(b.id, []);
    predecessors.set(b.id, []);
  }
  for (const e of cfg.edges) {
    if (successors.has(e.from) && predecessors.has(e.to)) {
      successors.get(e.from)!.push(e.to);
      predecessors.get(e.to)!.push(e.from);
    }
  }

  // Assign layers via longest-path layering (topological order)
  const layer = new Map<string, number>();
  const visited = new Set<string>();

  function assignLayer(id: string): number {
    if (layer.has(id)) return layer.get(id)!;
    if (visited.has(id)) return 0; // cycle
    visited.add(id);

    const preds = predecessors.get(id) || [];
    let maxPredLayer = -1;
    for (const p of preds) {
      maxPredLayer = Math.max(maxPredLayer, assignLayer(p));
    }
    const l = maxPredLayer + 1;
    layer.set(id, l);
    return l;
  }

  for (const b of cfg.blocks) {
    assignLayer(b.id);
  }

  // Group blocks by layer
  const layers = new Map<number, CfgBlock[]>();
  for (const b of cfg.blocks) {
    const l = layer.get(b.id) || 0;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(b);
  }

  // Sort layers by index
  const sortedLayerKeys = Array.from(layers.keys()).sort((a, b) => a - b);

  // For each layer, order blocks to minimize edge crossings (simple heuristic:
  // order by average position of predecessors)
  for (let li = 1; li < sortedLayerKeys.length; li++) {
    const layerKey = sortedLayerKeys[li];
    const blocks = layers.get(layerKey)!;
    const prevBlocks = layers.get(sortedLayerKeys[li - 1])!;
    const prevPos = new Map<string, number>();
    prevBlocks.forEach((b, i) => prevPos.set(b.id, i));

    blocks.sort((a, b) => {
      const aPreds = predecessors.get(a.id) || [];
      const bPreds = predecessors.get(b.id) || [];
      const aAvg = aPreds.length > 0
        ? aPreds.reduce((s, p) => s + (prevPos.get(p) ?? 0), 0) / aPreds.length
        : 0;
      const bAvg = bPreds.length > 0
        ? bPreds.reduce((s, p) => s + (prevPos.get(p) ?? 0), 0) / bPreds.length
        : 0;
      return aAvg - bAvg;
    });
  }

  // Position blocks
  const layoutBlocks: LayoutBlock[] = [];
  let currentY = 0;

  for (const layerKey of sortedLayerKeys) {
    const blocks = layers.get(layerKey)!;

    // Calculate dimensions for all blocks in this layer
    const dims = blocks.map(b => getBlockDimensions(b));
    const maxH = Math.max(...dims.map(d => d.height));

    // Total width of this layer
    const totalW = dims.reduce((s, d) => s + d.width, 0) + (blocks.length - 1) * BLOCK_GAP_X;

    let currentX = -totalW / 2; // center around 0

    for (let i = 0; i < blocks.length; i++) {
      layoutBlocks.push({
        block: blocks[i],
        x: currentX,
        y: currentY,
        width: dims[i].width,
        height: dims[i].height,
        column: i,
        row: layerKey,
      });
      currentX += dims[i].width + BLOCK_GAP_X;
    }

    currentY += maxH + BLOCK_GAP_Y;
  }

  // Normalize so minimum x is 0
  const minX = Math.min(...layoutBlocks.map(b => b.x));
  if (minX < 0) {
    for (const b of layoutBlocks) {
      b.x -= minX;
    }
  }

  return layoutBlocks;
}

// ============================================
// Drawing helpers
// ============================================

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBlock(
  ctx: CanvasRenderingContext2D,
  lb: LayoutBlock,
  isHovered: boolean,
) {
  const { block, x, y, width, height } = lb;
  const colors = BLOCK_COLORS[block.kind];

  // Shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  drawRoundedRect(ctx, x, y, width, height, BLOCK_RADIUS);
  ctx.fillStyle = isHovered ? HOVER_BG : colors.bg;
  ctx.fill();
  ctx.restore();

  // Border
  drawRoundedRect(ctx, x, y, width, height, BLOCK_RADIUS);
  ctx.strokeStyle = isHovered ? HOVER_BORDER : colors.border;
  ctx.lineWidth = isHovered ? 2 : 1;
  ctx.stroke();

  // Kind indicator (small colored dot)
  ctx.beginPath();
  ctx.arc(x + 10, y + BLOCK_PADDING_Y + 6, 3, 0, Math.PI * 2);
  ctx.fillStyle = colors.text;
  ctx.fill();

  // Label
  ctx.font = BLOCK_FONT;
  ctx.textBaseline = 'top';
  ctx.fillStyle = colors.text;
  const labelX = x + 20;
  const labelMaxW = width - 28;
  ctx.save();
  ctx.beginPath();
  ctx.rect(labelX, y, labelMaxW, height);
  ctx.clip();
  ctx.fillText(block.label, labelX, y + BLOCK_PADDING_Y);
  ctx.restore();

  // Statements (smaller font, dimmer)
  if (block.statements.length > 0) {
    ctx.font = BLOCK_FONT_SMALL;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    let stmtY = y + BLOCK_PADDING_Y + 18;
    for (const stmt of block.statements) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + BLOCK_PADDING_X, stmtY - 2, width - BLOCK_PADDING_X * 2, 16);
      ctx.clip();
      ctx.fillText(stmt, x + BLOCK_PADDING_X, stmtY);
      ctx.restore();
      stmtY += 16;
    }
  }
}

function drawEdge(
  ctx: CanvasRenderingContext2D,
  fromBlock: LayoutBlock,
  toBlock: LayoutBlock,
  edge: CfgEdge,
  isBackEdge: boolean,
) {
  const x1 = fromBlock.x + fromBlock.width / 2;
  const y1 = fromBlock.y + fromBlock.height;
  const x2 = toBlock.x + toBlock.width / 2;
  const y2 = toBlock.y;

  ctx.beginPath();
  ctx.strokeStyle = isBackEdge ? 'rgba(168,85,247,0.25)' : EDGE_COLOR;
  ctx.lineWidth = 1.5;

  if (isBackEdge) {
    // Back-edge: draw curved line on the side
    ctx.setLineDash([4, 4]);
    const offsetX = Math.max(fromBlock.width, toBlock.width) / 2 + 30;
    const side = x1 <= x2 ? -1 : 1;
    const cpX = Math.min(fromBlock.x, toBlock.x) + side * offsetX;
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(cpX, y1, cpX, y2, x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (Math.abs(x2 - x1) < 2) {
    // Straight vertical
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  } else {
    // S-curve
    const midY = (y1 + y2) / 2;
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1, midY, x2, midY, x2, y2);
    ctx.stroke();
  }

  // Arrowhead
  drawArrowhead(ctx, x2, y2, isBackEdge ? 'rgba(168,85,247,0.4)' : EDGE_COLOR);

  // Edge label
  if (edge.label) {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    ctx.font = BLOCK_FONT_SMALL;
    ctx.fillStyle = EDGE_LABEL_COLOR;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // Background for readability
    const tw = measureText(edge.label, BLOCK_FONT_SMALL);
    ctx.save();
    ctx.fillStyle = 'rgba(26,26,26,0.85)';
    drawRoundedRect(ctx, midX - tw / 2 - 4, midY - 8, tw + 8, 16, 3);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = EDGE_LABEL_COLOR;
    ctx.textAlign = 'center';
    ctx.fillText(edge.label, midX, midY);
    ctx.textAlign = 'start'; // reset
  }
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  color: string,
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - EDGE_ARROW_SIZE, y - EDGE_ARROW_SIZE * 1.5);
  ctx.lineTo(x + EDGE_ARROW_SIZE, y - EDGE_ARROW_SIZE * 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ============================================
// Hit testing
// ============================================

function hitTest(
  blocks: LayoutBlock[],
  worldX: number,
  worldY: number,
): LayoutBlock | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (
      worldX >= b.x && worldX <= b.x + b.width &&
      worldY >= b.y && worldY <= b.y + b.height
    ) {
      return b;
    }
  }
  return null;
}

// ============================================
// CfgView Component
// ============================================

export function CfgView({
  cfg,
  hoveredBlockId,
  onBlockHover,
  onBlockLeave,
}: CfgViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startCamX: number;
    startCamY: number;
    moved: boolean;
  } | null>(null);

  const pinchRef = useRef<{
    active: boolean;
    initialDist: number;
    initialZoom: number;
    midX: number;
    midY: number;
  } | null>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const hoveredRef = useRef<string | null>(null);

  // Layout
  const { layoutBlocks, bounds } = useMemo(() => {
    const blocks = layoutCfg(cfg);
    let maxX = 0;
    let maxY = 0;
    for (const b of blocks) {
      const r = b.x + b.width;
      const bot = b.y + b.height;
      if (r > maxX) maxX = r;
      if (bot > maxY) maxY = bot;
    }
    return { layoutBlocks: blocks, bounds: { width: maxX, height: maxY } };
  }, [cfg]);

  // Build a lookup map for layout blocks by ID
  const blockMap = useMemo(() => {
    const m = new Map<string, LayoutBlock>();
    for (const lb of layoutBlocks) {
      m.set(lb.block.id, lb);
    }
    return m;
  }, [layoutBlocks]);

  // Detect back-edges (to → from where to.row <= from.row)
  const backEdges = useMemo(() => {
    const set = new Set<string>();
    for (const e of cfg.edges) {
      const fromLb = blockMap.get(e.from);
      const toLb = blockMap.get(e.to);
      if (fromLb && toLb && toLb.row <= fromLb.row) {
        set.add(`${e.from}->${e.to}`);
      }
    }
    return set;
  }, [cfg.edges, blockMap]);

  // Auto-fit on mount or when CFG changes
  const prevCfgRef = useRef<number>(0);

  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;

    const cfgHash = cfg.blocks.length * 1000 + cfg.edges.length;
    const isNew = prevCfgRef.current !== cfgHash;
    prevCfgRef.current = cfgHash;

    if (isNew || camera.x === 0) {
      const pad = 60;
      const scaleX = (size.width - pad * 2) / Math.max(1, bounds.width);
      const scaleY = (size.height - pad * 2) / Math.max(1, bounds.height);
      const zoom = Math.min(1, Math.min(scaleX, scaleY));
      const x = (size.width - bounds.width * zoom) / 2;
      const y = pad;
      setCamera({ x, y, zoom });
    }
  }, [cfg, bounds, size]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width: Math.floor(width), height: Math.floor(height) });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ============================================
  // Rendering
  // ============================================

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    // Draw edges first
    for (const edge of cfg.edges) {
      const fromLb = blockMap.get(edge.from);
      const toLb = blockMap.get(edge.to);
      if (fromLb && toLb) {
        const isBack = backEdges.has(`${edge.from}->${edge.to}`);
        drawEdge(ctx, fromLb, toLb, edge, isBack);
      }
    }

    // Draw blocks
    for (const lb of layoutBlocks) {
      const isHovered = lb.block.id === hoveredBlockId;
      drawBlock(ctx, lb, isHovered);
    }

    ctx.restore();
  }, [layoutBlocks, blockMap, backEdges, camera, size, hoveredBlockId, cfg.edges]);

  // ============================================
  // Interaction
  // ============================================

  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const cam = cameraRef.current;
      return {
        x: (sx - cam.x) / cam.zoom,
        y: (sy - cam.y) / cam.zoom,
      };
    },
    [],
  );

  const getCanvasCoords = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [],
  );

  // Mouse interactions
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const { x, y } = getCanvasCoords(e.clientX, e.clientY);
      dragRef.current = {
        active: true,
        startX: x,
        startY: y,
        startCamX: cameraRef.current.x,
        startCamY: cameraRef.current.y,
        moved: false,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [getCanvasCoords],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const { x: sx, y: sy } = getCanvasCoords(e.clientX, e.clientY);

      if (dragRef.current?.active) {
        const drag = dragRef.current;
        const dx = sx - drag.startX;
        const dy = sy - drag.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
        setCamera({
          ...cameraRef.current,
          x: drag.startCamX + dx,
          y: drag.startCamY + dy,
        });
        return;
      }

      // Hover
      const world = screenToWorld(sx, sy);
      const hit = hitTest(layoutBlocks, world.x, world.y);
      if (hit) {
        if (hoveredRef.current !== hit.block.id) {
          hoveredRef.current = hit.block.id;
          onBlockHover(hit.block.id);
        }
        if (canvasRef.current) canvasRef.current.style.cursor = 'pointer';
      } else {
        if (hoveredRef.current) {
          hoveredRef.current = null;
          onBlockLeave();
        }
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
      }
    },
    [getCanvasCoords, screenToWorld, layoutBlocks, onBlockHover, onBlockLeave],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (!dragRef.current) return;

      if (!dragRef.current.moved) {
        const { x: sx, y: sy } = getCanvasCoords(e.clientX, e.clientY);
        const world = screenToWorld(sx, sy);
        const hit = hitTest(layoutBlocks, world.x, world.y);
        if (hit) {
          onBlockHover(hit.block.id);
        }
      }
      dragRef.current = null;
    },
    [getCanvasCoords, screenToWorld, layoutBlocks, onBlockHover],
  );

  // Touch + wheel (native listeners for passive: false)
  const layoutBlocksRef = useRef(layoutBlocks);
  layoutBlocksRef.current = layoutBlocks;
  const onBlockHoverRef = useRef(onBlockHover);
  onBlockHoverRef.current = onBlockHover;
  const screenToWorldRef = useRef(screenToWorld);
  screenToWorldRef.current = screenToWorld;
  const getCanvasCoordsRef = useRef(getCanvasCoords);
  getCanvasCoordsRef.current = getCanvasCoords;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const mid = getCanvasCoordsRef.current(
          (t0.clientX + t1.clientX) / 2,
          (t0.clientY + t1.clientY) / 2,
        );
        pinchRef.current = {
          active: true,
          initialDist: dist,
          initialZoom: cameraRef.current.zoom,
          midX: mid.x,
          midY: mid.y,
        };
        dragRef.current = null;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        const { x, y } = getCanvasCoordsRef.current(t.clientX, t.clientY);
        dragRef.current = {
          active: true,
          startX: x,
          startY: y,
          startCamX: cameraRef.current.x,
          startCamY: cameraRef.current.y,
          moved: false,
        };
        pinchRef.current = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2 && pinchRef.current?.active) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const scale = dist / pinchRef.current.initialDist;
        const newZoom = Math.min(3, Math.max(0.1, pinchRef.current.initialZoom * scale));
        const mid = pinchRef.current;
        const worldX = (mid.midX - cameraRef.current.x) / cameraRef.current.zoom;
        const worldY = (mid.midY - cameraRef.current.y) / cameraRef.current.zoom;
        setCamera({
          zoom: newZoom,
          x: mid.midX - worldX * newZoom,
          y: mid.midY - worldY * newZoom,
        });
      } else if (e.touches.length === 1 && dragRef.current?.active) {
        const drag = dragRef.current;
        const t = e.touches[0];
        const { x: sx, y: sy } = getCanvasCoordsRef.current(t.clientX, t.clientY);
        const dx = sx - drag.startX;
        const dy = sy - drag.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
        setCamera({
          ...cameraRef.current,
          x: drag.startCamX + dx,
          y: drag.startCamY + dy,
        });
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (pinchRef.current?.active && e.touches.length < 2) {
        pinchRef.current = null;
      }
      if (dragRef.current && e.touches.length === 0) {
        if (!dragRef.current.moved) {
          const world = screenToWorldRef.current(dragRef.current.startX, dragRef.current.startY);
          const hit = hitTest(layoutBlocksRef.current, world.x, world.y);
          if (hit) {
            onBlockHoverRef.current(hit.block.id);
          }
        }
        dragRef.current = null;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x: sx, y: sy } = getCanvasCoordsRef.current(e.clientX, e.clientY);
      const cam = cameraRef.current;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(3, Math.max(0.1, cam.zoom * factor));
      const worldX = (sx - cam.x) / cam.zoom;
      const worldY = (sy - cam.y) / cam.zoom;
      setCamera({
        zoom: newZoom,
        x: sx - worldX * newZoom,
        y: sy - worldY * newZoom,
      });
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Fit to view
  const fitToView = useCallback(() => {
    if (size.width === 0 || size.height === 0) return;
    const pad = 60;
    const scaleX = (size.width - pad * 2) / Math.max(1, bounds.width);
    const scaleY = (size.height - pad * 2) / Math.max(1, bounds.height);
    const zoom = Math.min(1, Math.min(scaleX, scaleY));
    const x = (size.width - bounds.width * zoom) / 2;
    const y = pad;
    setCamera({ x, y, zoom });
  }, [size, bounds]);

  return (
    <div ref={containerRef} className="cfg-view-container">
      <canvas
        ref={canvasRef}
        className="cfg-view-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {/* Zoom controls overlay */}
      <div className="tree-view-controls">
        <button
          onClick={() => {
            const cam = cameraRef.current;
            const cx = size.width / 2;
            const cy = size.height / 2;
            const worldX = (cx - cam.x) / cam.zoom;
            const worldY = (cy - cam.y) / cam.zoom;
            const newZoom = Math.min(3, cam.zoom * 1.3);
            setCamera({ zoom: newZoom, x: cx - worldX * newZoom, y: cy - worldY * newZoom });
          }}
          className="tree-view-btn"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => {
            const cam = cameraRef.current;
            const cx = size.width / 2;
            const cy = size.height / 2;
            const worldX = (cx - cam.x) / cam.zoom;
            const worldY = (cy - cam.y) / cam.zoom;
            const newZoom = Math.max(0.1, cam.zoom / 1.3);
            setCamera({ zoom: newZoom, x: cx - worldX * newZoom, y: cy - worldY * newZoom });
          }}
          className="tree-view-btn"
          aria-label="Zoom out"
        >
          &minus;
        </button>
        <button
          onClick={fitToView}
          className="tree-view-btn tree-view-btn-fit"
          aria-label="Fit to view"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      </div>
      {/* Zoom label */}
      <div className="tree-view-zoom-label">
        {Math.round(camera.zoom * 100)}%
      </div>
      {/* Block count */}
      <div className="cfg-block-count">
        {cfg.blocks.length} blocks &middot; {cfg.edges.length} edges
      </div>
    </div>
  );
}
