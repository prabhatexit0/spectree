import { useRef, useCallback, useEffect, useState, type ReactNode } from 'react';

export type SnapPoint = 'collapsed' | 'half' | 'full';

const COLLAPSED_HEIGHT = 48; // Just the handle bar
const HALF_RATIO = 0.5;
const FULL_RATIO = 0.92;

interface BottomSheetProps {
  children: ReactNode;
  header?: ReactNode;
  snap: SnapPoint;
  onSnapChange: (snap: SnapPoint) => void;
}

function getSnapHeight(snap: SnapPoint, windowHeight: number): number {
  switch (snap) {
    case 'collapsed':
      return COLLAPSED_HEIGHT;
    case 'half':
      return Math.round(windowHeight * HALF_RATIO);
    case 'full':
      return Math.round(windowHeight * FULL_RATIO);
  }
}

function nearestSnap(height: number, windowHeight: number): SnapPoint {
  const collapsed = COLLAPSED_HEIGHT;
  const half = windowHeight * HALF_RATIO;
  const full = windowHeight * FULL_RATIO;

  const distCollapsed = Math.abs(height - collapsed);
  const distHalf = Math.abs(height - half);
  const distFull = Math.abs(height - full);

  if (distCollapsed <= distHalf && distCollapsed <= distFull) return 'collapsed';
  if (distHalf <= distFull) return 'half';
  return 'full';
}

export function BottomSheet({ children, header, snap, onSnapChange }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    startY: number;
    startHeight: number;
    moved: boolean;
  } | null>(null);

  const [currentHeight, setCurrentHeight] = useState(COLLAPSED_HEIGHT);
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
        COLLAPSED_HEIGHT,
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

  // Tapping the handle toggles between collapsed and half
  const handleHandleTap = useCallback(() => {
    if (dragState.current?.moved) return;
    const newSnap = snap === 'collapsed' ? 'half' : 'collapsed';
    onSnapChange(newSnap);
  }, [snap, onSnapChange]);

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
