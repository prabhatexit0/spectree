import {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from 'react';
import type { AstNode } from '../lib/parser';

// ============================================
// Types
// ============================================

interface LayoutNode {
  id: string;
  node: AstNode;
  x: number;
  y: number;
  width: number;
  height: number;
  children: LayoutNode[];
  parent: LayoutNode | null;
  expanded: boolean;
  depth: number;
  // For layout algorithm
  mod: number;
  prelim: number;
  thread: LayoutNode | null;
  ancestor: LayoutNode;
  change: number;
  shift: number;
  number: number; // position among siblings
}

interface TreeViewProps {
  ast: AstNode;
  expandedNodes: Set<string>;
  cursorNodePath: string | null;
  hoveredNodePath: string | null;
  onToggleNode: (path: string) => void;
  onNodeHover: (path: string) => void;
  onNodeLeave: () => void;
}

// ============================================
// Constants
// ============================================

const NODE_H = 32;
const NODE_PADDING_X = 14;
const NODE_FONT = '12px "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace';
const NODE_GAP_X = 24; // horizontal gap between nodes
const NODE_GAP_Y = 52; // vertical gap between levels
const EDGE_RADIUS = 12; // rounded edge corners
const CONNECTOR_COLOR = 'rgba(255,255,255,0.08)';
const CONNECTOR_WIDTH = 1.5;

// Colors matching existing scheme
const COLORS = {
  namedBg: 'rgba(59, 130, 246, 0.12)',       // blue-400/12
  namedBorder: 'rgba(59, 130, 246, 0.35)',    // blue-400/35
  namedText: '#60a5fa',                        // blue-400
  anonBg: 'rgba(156, 163, 175, 0.08)',        // gray-400/8
  anonBorder: 'rgba(156, 163, 175, 0.2)',     // gray-400/20
  anonText: '#6b7280',                         // gray-500
  leafText: '#4ade80',                         // green-400
  cursorBg: 'rgba(59, 130, 246, 0.22)',        // blue/22
  cursorBorder: 'rgba(59, 130, 246, 0.7)',
  hoverBg: 'rgba(250, 204, 21, 0.12)',        // yellow/12
  hoverBorder: 'rgba(250, 204, 21, 0.4)',
  collapsedBadge: 'rgba(255,255,255,0.15)',
  collapsedBadgeText: 'rgba(255,255,255,0.6)',
};

// ============================================
// Text measurement helper (cached)
// ============================================

let measureCtx: CanvasRenderingContext2D | null = null;

function measureText(text: string): number {
  if (!measureCtx) {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d')!;
    measureCtx.font = NODE_FONT;
  }
  return measureCtx.measureText(text).width;
}

function getNodeLabel(node: AstNode): string {
  if (node.text && node.children.length === 0) {
    const truncated = node.text.length > 20 ? node.text.slice(0, 18) + '..' : node.text;
    return `${node.kind}  "${truncated}"`;
  }
  return node.kind;
}

function getNodeWidth(node: AstNode, hasCollapsedChildren: boolean): number {
  const label = getNodeLabel(node);
  const textWidth = measureText(label);
  const badgeExtra = hasCollapsedChildren ? measureText(` +99`) + 8 : 0;
  return Math.max(60, textWidth + NODE_PADDING_X * 2 + badgeExtra);
}

// ============================================
// Build layout tree from AST + expanded state
// ============================================

function buildLayoutTree(
  node: AstNode,
  path: string,
  expandedNodes: Set<string>,
  depth: number,
  parent: LayoutNode | null,
): LayoutNode {
  const expanded = expandedNodes.has(path);
  const visibleChildren = expanded ? node.children : [];
  const hasCollapsedChildren = !expanded && node.children.length > 0;

  const layoutNode: LayoutNode = {
    id: path,
    node,
    x: 0,
    y: 0,
    width: getNodeWidth(node, hasCollapsedChildren),
    height: NODE_H,
    children: [],
    parent,
    expanded,
    depth,
    mod: 0,
    prelim: 0,
    thread: null,
    ancestor: null as unknown as LayoutNode,
    change: 0,
    shift: 0,
    number: 0,
  };
  layoutNode.ancestor = layoutNode;

  layoutNode.children = visibleChildren.map((child, i) => {
    const childNode = buildLayoutTree(child, `${path}-${i}`, expandedNodes, depth + 1, layoutNode);
    childNode.number = i + 1;
    return childNode;
  });

  return layoutNode;
}

// ============================================
// Reingold-Tilford tree layout algorithm
// ============================================

function firstWalk(v: LayoutNode, siblings: LayoutNode[]) {
  if (v.children.length === 0) {
    // Leaf node
    const idx = siblings.indexOf(v);
    if (idx > 0) {
      const leftSibling = siblings[idx - 1];
      v.prelim = leftSibling.prelim + leftSibling.width + NODE_GAP_X;
    } else {
      v.prelim = 0;
    }
  } else {
    let defaultAncestor = v.children[0];
    for (const child of v.children) {
      firstWalk(child, v.children);
      defaultAncestor = apportion(child, defaultAncestor, v.children);
    }
    executeShifts(v);

    const firstChild = v.children[0];
    const lastChild = v.children[v.children.length - 1];
    const midpoint = (firstChild.prelim + lastChild.prelim + lastChild.width - v.width) / 2;

    const idx = siblings.indexOf(v);
    if (idx > 0) {
      const leftSibling = siblings[idx - 1];
      v.prelim = leftSibling.prelim + leftSibling.width + NODE_GAP_X;
      v.mod = v.prelim - midpoint;
    } else {
      v.prelim = midpoint;
    }
  }
}

function apportion(v: LayoutNode, defaultAncestor: LayoutNode, siblings: LayoutNode[]): LayoutNode {
  const idx = siblings.indexOf(v);
  if (idx <= 0) return defaultAncestor;

  const w = siblings[idx - 1]; // left sibling
  let vInnerRight: LayoutNode | null = v;
  let vOuterRight: LayoutNode | null = v;
  let vInnerLeft: LayoutNode | null = w;
  let vOuterLeft: LayoutNode | null = siblings[0];

  let sInnerRight = v.mod;
  let sOuterRight = v.mod;
  let sInnerLeft = w.mod;
  let sOuterLeft = siblings[0].mod;

  while (nextRight(vInnerLeft) !== null && nextLeft(vInnerRight) !== null) {
    vInnerLeft = nextRight(vInnerLeft)!;
    vInnerRight = nextLeft(vInnerRight)!;
    vOuterLeft = nextLeft(vOuterLeft)!;
    vOuterRight = nextRight(vOuterRight)!;

    if (vOuterRight) vOuterRight.ancestor = v;

    const shift =
      (vInnerLeft!.prelim + sInnerLeft) -
      (vInnerRight!.prelim + sInnerRight) +
      vInnerLeft!.width +
      NODE_GAP_X;

    if (shift > 0) {
      const ancestor = findAncestor(vInnerLeft!, v, defaultAncestor, siblings);
      moveSubtree(ancestor, v, shift);
      sInnerRight += shift;
      sOuterRight += shift;
    }

    sInnerLeft += vInnerLeft?.mod ?? 0;
    sInnerRight += vInnerRight?.mod ?? 0;
    sOuterLeft += vOuterLeft?.mod ?? 0;
    sOuterRight += vOuterRight?.mod ?? 0;
  }

  if (nextRight(vInnerLeft) !== null && nextRight(vOuterRight) === null) {
    if (vOuterRight) {
      vOuterRight.thread = nextRight(vInnerLeft);
      vOuterRight.mod += sInnerLeft - sOuterRight;
    }
  }

  if (nextLeft(vInnerRight) !== null && nextLeft(vOuterLeft) === null) {
    if (vOuterLeft) {
      vOuterLeft.thread = nextLeft(vInnerRight);
      vOuterLeft.mod += sInnerRight - sOuterLeft;
    }
    defaultAncestor = v;
  }

  return defaultAncestor;
}

function nextLeft(v: LayoutNode | null): LayoutNode | null {
  if (!v) return null;
  return v.children.length > 0 ? v.children[0] : v.thread;
}

function nextRight(v: LayoutNode | null): LayoutNode | null {
  if (!v) return null;
  return v.children.length > 0 ? v.children[v.children.length - 1] : v.thread;
}

function findAncestor(
  vil: LayoutNode,
  _v: LayoutNode,
  defaultAncestor: LayoutNode,
  siblings: LayoutNode[],
): LayoutNode {
  if (siblings.includes(vil.ancestor)) {
    return vil.ancestor;
  }
  return defaultAncestor;
}

function moveSubtree(wl: LayoutNode, wr: LayoutNode, shift: number) {
  const subtrees = wr.number - wl.number;
  if (subtrees > 0) {
    wr.change -= shift / subtrees;
    wr.shift += shift;
    wr.prelim += shift;
    wr.mod += shift;
  }
}

function executeShifts(v: LayoutNode) {
  let shift = 0;
  let change = 0;
  for (let i = v.children.length - 1; i >= 0; i--) {
    const child = v.children[i];
    child.prelim += shift;
    child.mod += shift;
    change += child.change;
    shift += child.shift + change;
  }
}

function secondWalk(v: LayoutNode, m: number, depth: number) {
  v.x = v.prelim + m;
  v.y = depth * (NODE_H + NODE_GAP_Y);
  for (const child of v.children) {
    secondWalk(child, m + v.mod, depth + 1);
  }
}

function layoutTree(root: LayoutNode) {
  firstWalk(root, [root]);
  secondWalk(root, 0, 0);

  // Normalize so no negative x
  let minX = Infinity;
  const walk = (n: LayoutNode) => {
    if (n.x < minX) minX = n.x;
    for (const c of n.children) walk(c);
  };
  walk(root);

  if (minX < 0) {
    const offset = -minX;
    const shift = (n: LayoutNode) => {
      n.x += offset;
      for (const c of n.children) shift(c);
    };
    shift(root);
  }
}

// ============================================
// Collect all visible nodes for rendering
// ============================================

function collectNodes(root: LayoutNode): LayoutNode[] {
  const nodes: LayoutNode[] = [];
  const walk = (n: LayoutNode) => {
    nodes.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return nodes;
}

// ============================================
// Canvas drawing
// ============================================

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
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

function drawEdge(
  ctx: CanvasRenderingContext2D,
  parent: LayoutNode,
  child: LayoutNode,
) {
  const x1 = parent.x + parent.width / 2;
  const y1 = parent.y + parent.height;
  const x2 = child.x + child.width / 2;
  const y2 = child.y;
  const midY = (y1 + y2) / 2;

  ctx.beginPath();
  ctx.moveTo(x1, y1);

  // Smooth S-curve connector
  if (Math.abs(x2 - x1) < 1) {
    // Straight vertical line
    ctx.lineTo(x2, y2);
  } else {
    const radius = Math.min(EDGE_RADIUS, Math.abs(x2 - x1) / 2, (y2 - y1) / 4);
    // Go down from parent
    ctx.lineTo(x1, midY - radius);
    // Curve toward child
    ctx.quadraticCurveTo(x1, midY, x1 + Math.sign(x2 - x1) * radius, midY);
    // Horizontal segment
    ctx.lineTo(x2 - Math.sign(x2 - x1) * radius, midY);
    // Curve down to child
    ctx.quadraticCurveTo(x2, midY, x2, midY + radius);
    // Finish to child
    ctx.lineTo(x2, y2);
  }

  ctx.strokeStyle = CONNECTOR_COLOR;
  ctx.lineWidth = CONNECTOR_WIDTH;
  ctx.stroke();
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  layoutNode: LayoutNode,
  cursorNodePath: string | null,
  hoveredNodePath: string | null,
) {
  const { node, x, y, width, height, id, expanded } = layoutNode;
  const isAtCursor = id === cursorNodePath;
  const isHovered = id === hoveredNodePath;
  const isNamed = node.isNamed;
  const hasChildren = node.children.length > 0;
  const hasCollapsedChildren = !expanded && hasChildren;
  const r = 8;

  // Background
  let bgColor: string;
  let borderColor: string;

  if (isAtCursor) {
    bgColor = COLORS.cursorBg;
    borderColor = COLORS.cursorBorder;
  } else if (isHovered) {
    bgColor = COLORS.hoverBg;
    borderColor = COLORS.hoverBorder;
  } else if (isNamed) {
    bgColor = COLORS.namedBg;
    borderColor = COLORS.namedBorder;
  } else {
    bgColor = COLORS.anonBg;
    borderColor = COLORS.anonBorder;
  }

  // Draw shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  drawRoundedRect(ctx, x, y, width, height, r);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.restore();

  // Border
  drawRoundedRect(ctx, x, y, width, height, r);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = isAtCursor || isHovered ? 1.5 : 1;
  ctx.stroke();

  // Text
  ctx.font = NODE_FONT;
  ctx.textBaseline = 'middle';

  const textY = y + height / 2;
  let textX = x + NODE_PADDING_X;

  // Node kind
  ctx.fillStyle = isNamed ? COLORS.namedText : COLORS.anonText;
  const kindText = node.kind;
  ctx.fillText(kindText, textX, textY);
  textX += measureText(kindText);

  // Leaf text
  if (node.text && node.children.length === 0) {
    const truncated = node.text.length > 20 ? node.text.slice(0, 18) + '..' : node.text;
    const display = `  "${truncated}"`;
    ctx.fillStyle = COLORS.leafText;
    ctx.fillText(display, textX, textY);
    textX += measureText(display);
  }

  // Collapsed children badge
  if (hasCollapsedChildren) {
    const badgeText = `+${node.children.length}`;
    const badgeW = measureText(badgeText) + 8;
    const badgeH = 18;
    const badgeX = x + width - NODE_PADDING_X - badgeW;
    const badgeY = y + (height - badgeH) / 2;

    drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
    ctx.fillStyle = COLORS.collapsedBadge;
    ctx.fill();

    ctx.fillStyle = COLORS.collapsedBadgeText;
    ctx.font = '10px "SF Mono", Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, badgeX + 4, badgeY + badgeH / 2);
    ctx.font = NODE_FONT; // restore
  }
}

// ============================================
// Hit testing
// ============================================

function hitTest(
  nodes: LayoutNode[],
  worldX: number,
  worldY: number,
): LayoutNode | null {
  // Check in reverse order so topmost nodes are tested first
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (
      worldX >= n.x &&
      worldX <= n.x + n.width &&
      worldY >= n.y &&
      worldY <= n.y + n.height
    ) {
      return n;
    }
  }
  return null;
}

// ============================================
// TreeView Component
// ============================================

export function TreeView({
  ast,
  expandedNodes,
  cursorNodePath,
  hoveredNodePath,
  onToggleNode,
  onNodeHover,
  onNodeLeave,
}: TreeViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Camera state
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  // Drag state
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startCamX: number;
    startCamY: number;
    moved: boolean;
  } | null>(null);

  // Pinch state for mobile
  const pinchRef = useRef<{
    active: boolean;
    initialDist: number;
    initialZoom: number;
    midX: number;
    midY: number;
  } | null>(null);

  // Track canvas size
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Hover tracking
  const hoveredRef = useRef<string | null>(null);

  // Build and layout the tree
  const { allNodes, treeBounds } = useMemo(() => {
    const root = buildLayoutTree(ast, 'root', expandedNodes, 0, null);
    layoutTree(root);
    const nodes = collectNodes(root);

    let maxX = 0;
    let maxY = 0;
    for (const n of nodes) {
      const right = n.x + n.width;
      const bottom = n.y + n.height;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }

    return {
      allNodes: nodes,
      treeBounds: { width: maxX, height: maxY },
    };
  }, [ast, expandedNodes]);

  // Auto-fit on first render, when the AST root changes (language switch),
  // or when the container size changes significantly (e.g. bottom sheet animation)
  // but NOT on every expand/collapse, which would be disorienting
  const prevAstRootRef = useRef<string | null>(null);
  const prevSizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;

    const astRootKind = ast.kind + '|' + ast.children.length;
    const isNewAst = prevAstRootRef.current !== null && prevAstRootRef.current !== astRootKind;
    const isFirstRender = prevSizeRef.current.width === 0 && prevSizeRef.current.height === 0;
    const sizeChangedSignificantly =
      Math.abs(size.width - prevSizeRef.current.width) > 50 ||
      Math.abs(size.height - prevSizeRef.current.height) > 50;

    prevAstRootRef.current = astRootKind;
    prevSizeRef.current = { ...size };

    if (isFirstRender || isNewAst || sizeChangedSignificantly) {
      const pad = 60;
      const scaleX = (size.width - pad * 2) / Math.max(1, treeBounds.width);
      const scaleY = (size.height - pad * 2) / Math.max(1, treeBounds.height);
      const zoom = Math.min(1, Math.min(scaleX, scaleY));
      const x = (size.width - treeBounds.width * zoom) / 2;
      const y = pad;

      setCamera({ x, y, zoom });
    }
  }, [ast, treeBounds, size]);

  // Scroll to cursor node
  useEffect(() => {
    if (!cursorNodePath || size.width === 0) return;
    const target = allNodes.find((n) => n.id === cursorNodePath);
    if (!target) return;

    const cam = cameraRef.current;
    const screenX = target.x * cam.zoom + cam.x;
    const screenY = target.y * cam.zoom + cam.y;
    const screenRight = (target.x + target.width) * cam.zoom + cam.x;
    const screenBottom = (target.y + target.height) * cam.zoom + cam.y;

    const margin = 80;
    let dx = 0;
    let dy = 0;

    if (screenX < margin) dx = margin - screenX;
    else if (screenRight > size.width - margin) dx = size.width - margin - screenRight;
    if (screenY < margin) dy = margin - screenY;
    else if (screenBottom > size.height - margin) dy = size.height - margin - screenBottom;

    if (dx !== 0 || dy !== 0) {
      setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
    }
  }, [cursorNodePath, allNodes, size]);

  // Handle resize
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

    // Apply camera
    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    // Draw edges first (behind nodes)
    for (const node of allNodes) {
      for (const child of node.children) {
        drawEdge(ctx, node, child);
      }
    }

    // Draw nodes
    for (const node of allNodes) {
      drawNode(ctx, node, cursorNodePath, hoveredNodePath);
    }

    ctx.restore();
  }, [allNodes, camera, size, cursorNodePath, hoveredNodePath]);

  // ============================================
  // Interaction: screen -> world coords
  // ============================================

  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const cam = cameraRef.current;
      return {
        x: (sx - cam.x) / cam.zoom,
        y: (sy - cam.y) / cam.zoom,
      };
    },
    []
  );

  const getCanvasCoords = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    []
  );

  // ============================================
  // Mouse interactions
  // ============================================

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return; // handled by touch events
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
    [getCanvasCoords]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const { x: sx, y: sy } = getCanvasCoords(e.clientX, e.clientY);

      if (dragRef.current?.active) {
        const drag = dragRef.current;
        const dx = sx - drag.startX;
        const dy = sy - drag.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          drag.moved = true;
        }
        setCamera({
          ...cameraRef.current,
          x: drag.startCamX + dx,
          y: drag.startCamY + dy,
        });
        return;
      }

      // Hover detection
      const world = screenToWorld(sx, sy);
      const hit = hitTest(allNodes, world.x, world.y);
      if (hit) {
        if (hoveredRef.current !== hit.id) {
          hoveredRef.current = hit.id;
          onNodeHover(hit.id);
        }
        if (canvasRef.current) canvasRef.current.style.cursor = 'pointer';
      } else {
        if (hoveredRef.current) {
          hoveredRef.current = null;
          onNodeLeave();
        }
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
      }
    },
    [getCanvasCoords, screenToWorld, allNodes, onNodeHover, onNodeLeave]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;

      if (!dragRef.current.moved) {
        // Click - check for node hit
        const { x: sx, y: sy } = getCanvasCoords(e.clientX, e.clientY);
        const world = screenToWorld(sx, sy);
        const hit = hitTest(allNodes, world.x, world.y);
        if (hit && hit.node.children.length > 0) {
          onToggleNode(hit.id);
        }
      }

      dragRef.current = null;
    },
    [getCanvasCoords, screenToWorld, allNodes, onToggleNode]
  );

  // ============================================
  // Touch + wheel via native listeners (passive: false to allow preventDefault)
  // ============================================

  // Stable refs for callbacks that need access to latest values
  const allNodesRef = useRef(allNodes);
  allNodesRef.current = allNodes;
  const onToggleNodeRef = useRef(onToggleNode);
  onToggleNodeRef.current = onToggleNode;
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
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          drag.moved = true;
        }
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
          const hit = hitTest(allNodesRef.current, world.x, world.y);
          if (hit && hit.node.children.length > 0) {
            onToggleNodeRef.current(hit.id);
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

  // ============================================
  // Fit to view helper
  // ============================================

  const fitToView = useCallback(() => {
    if (size.width === 0 || size.height === 0) return;
    const pad = 60;
    const scaleX = (size.width - pad * 2) / Math.max(1, treeBounds.width);
    const scaleY = (size.height - pad * 2) / Math.max(1, treeBounds.height);
    const zoom = Math.min(1, Math.min(scaleX, scaleY));
    const x = (size.width - treeBounds.width * zoom) / 2;
    const y = pad;
    setCamera({ x, y, zoom });
  }, [size, treeBounds]);

  return (
    <div
      ref={containerRef}
      className="tree-view-container"
    >
      <canvas
        ref={canvasRef}
        className="tree-view-canvas"
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
            setCamera({
              zoom: newZoom,
              x: cx - worldX * newZoom,
              y: cy - worldY * newZoom,
            });
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
            setCamera({
              zoom: newZoom,
              x: cx - worldX * newZoom,
              y: cy - worldY * newZoom,
            });
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
      {/* Zoom level indicator */}
      <div className="tree-view-zoom-label">
        {Math.round(camera.zoom * 100)}%
      </div>
    </div>
  );
}
