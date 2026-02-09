import { useRef, useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronUp } from 'lucide-react';

export type SnapPoint = 'collapsed' | 'half' | 'full';

const HALF_RATIO = 0.5;
const FULL_RATIO = 0.92;
// Minimum height when dragging (the sheet handle + header)
const MIN_DRAG_HEIGHT = 60;

interface BottomSheetProps {
  children: ReactNode;
  header?: ReactNode;
  collapsedLabel?: string;
  snap: SnapPoint;
  onSnapChange: (snap: SnapPoint) => void;
}

function getSnapHeight(snap: SnapPoint, windowHeight: number): number {
  switch (snap) {
    case 'collapsed':
      return 0; // Not used for rendering, collapsed uses the pill
    case 'half':
      return Math.round(windowHeight * HALF_RATIO);
    case 'full':
      return Math.round(windowHeight * FULL_RATIO);
  }
}

function nearestSnap(height: number, windowHeight: number): SnapPoint {
  const half = windowHeight * HALF_RATIO;
  const full = windowHeight * FULL_RATIO;

  // If dragged below 15% of screen, collapse
  if (height < windowHeight * 0.15) return 'collapsed';

  const distHalf = Math.abs(height - half);
  const distFull = Math.abs(height - full);

  if (distHalf <= distFull) return 'half';
  return 'full';
}

export function BottomSheet({ children, header, collapsedLabel, snap, onSnapChange }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    startY: number;
    startHeight: number;
    moved: boolean;
  } | null>(null);

  const [currentHeight, setCurrentHeight] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [windowHeight, setWindowHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 800
  );

  // Track window resize
  useEffect(() => {
    const onResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Sync height when snap prop changes (not during drag)
  useEffect(() => {
    if (!isDragging) {
      setCurrentHeight(getSnapHeight(snap, windowHeight));
    }
  }, [snap, windowHeight, isDragging]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      dragState.current = {
        startY: touch.clientY,
        startHeight: currentHeight,
        moved: false,
      };
      setIsDragging(true);
    },
    [currentHeight]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!dragState.current) return;

      const touch = e.touches[0];
      const deltaY = dragState.current.startY - touch.clientY;

      if (Math.abs(deltaY) > 5) {
        dragState.current.moved = true;
      }

      const newHeight = Math.max(
        MIN_DRAG_HEIGHT,
        Math.min(dragState.current.startHeight + deltaY, windowHeight * FULL_RATIO)
      );
      setCurrentHeight(newHeight);
    },
    [windowHeight]
  );

  const handleTouchEnd = useCallback(() => {
    if (!dragState.current) return;

    const newSnap = nearestSnap(currentHeight, windowHeight);
    setCurrentHeight(getSnapHeight(newSnap, windowHeight));
    onSnapChange(newSnap);

    dragState.current = null;
    setIsDragging(false);
  }, [currentHeight, windowHeight, onSnapChange]);

  // Tapping the handle collapses if open
  const handleHandleTap = useCallback(() => {
    if (dragState.current?.moved) return;
    onSnapChange('collapsed');
  }, [onSnapChange]);

  // When collapsed, render a floating pill instead of a bottom bar
  if (snap === 'collapsed' && !isDragging) {
    return (
      <button
        className="bottom-sheet-pill"
        onClick={() => onSnapChange('half')}
        aria-label="Open AST viewer"
      >
        <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-xs font-medium text-gray-300">
          {collapsedLabel || 'AST'}
        </span>
      </button>
    );
  }

  return (
    <div
      ref={sheetRef}
      className="bottom-sheet"
      style={{
        height: `${currentHeight}px`,
        transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
      }}
    >
      {/* Drag handle area */}
      <div
        className="bottom-sheet-handle"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleHandleTap}
      >
        <div className="bottom-sheet-handle-bar" />
        {header}
      </div>

      {/* Content */}
      <div className="bottom-sheet-content">
        {children}
      </div>
    </div>
  );
}
