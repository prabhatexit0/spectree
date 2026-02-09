import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { StateField, StateEffect, Extension } from '@codemirror/state';

// ============================================
// Cursor Position Tracker Extension
// ============================================

export interface CursorPosition {
    line: number;   // 0-indexed line number
    column: number; // 0-indexed column number
    offset: number; // Absolute offset in document
}

/**
 * Creates an extension that tracks cursor position changes and calls
 * the provided callback whenever the cursor moves.
 */
export function cursorPositionTracker(
    onCursorChange: (position: CursorPosition) => void
): Extension {
    return EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);

            onCursorChange({
                line: line.number - 1, // Convert to 0-indexed
                column: pos - line.from,
                offset: pos,
            });
        }
    });
}

// ============================================
// Highlight Decoration Extension
// ============================================

export interface HighlightRange {
    from: number;
    to: number;
}

// State effect for updating the highlighted range
const setHighlightEffect = StateEffect.define<HighlightRange | null>();

// Decoration mark style
const highlightMark = Decoration.mark({
    class: 'cm-highlight-ast',
});

// State field to manage highlight decorations
const highlightField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(decorations, tr) {
        // Check for highlight effects
        for (const effect of tr.effects) {
            if (effect.is(setHighlightEffect)) {
                if (effect.value === null) {
                    return Decoration.none;
                }
                const { from, to } = effect.value;
                // Ensure valid range within document bounds
                const docLength = tr.state.doc.length;
                const safeFrom = Math.max(0, Math.min(from, docLength));
                const safeTo = Math.max(safeFrom, Math.min(to, docLength));

                if (safeFrom === safeTo) {
                    return Decoration.none;
                }

                return Decoration.set([highlightMark.range(safeFrom, safeTo)]);
            }
        }
        // Map existing decorations through document changes
        return decorations.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
});

/**
 * Extension that provides highlighting capability.
 * Use setHighlight() to update the highlighted range.
 */
export function highlightExtension(): Extension {
    return highlightField;
}

/**
 * Dispatch a highlight effect to the editor view.
 * Pass null to clear the highlight.
 */
export function setHighlight(view: EditorView, range: HighlightRange | null): void {
    view.dispatch({
        effects: setHighlightEffect.of(range),
    });
}

// ============================================
// Explorer Mode Click Handler Extension
// ============================================

/**
 * Creates an extension that handles click/tap events in explorer mode.
 * When the editor is non-editable (explorer mode), this converts clicks
 * into cursor position callbacks so AST nodes can be highlighted.
 */
export function explorerClickHandler(
    onCursorChange: (position: CursorPosition) => void
): Extension {
    return EditorView.domEventHandlers({
        mousedown(event, view) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos !== null) {
                const line = view.state.doc.lineAt(pos);
                onCursorChange({
                    line: line.number - 1,
                    column: pos - line.from,
                    offset: pos,
                });
            }
        },
        touchend(event, view) {
            const touch = event.changedTouches[0];
            if (!touch) return;
            const pos = view.posAtCoords({ x: touch.clientX, y: touch.clientY });
            if (pos !== null) {
                const line = view.state.doc.lineAt(pos);
                onCursorChange({
                    line: line.number - 1,
                    column: pos - line.from,
                    offset: pos,
                });
            }
        },
    });
}

// ============================================
// Combined Extension Factory
// ============================================

export interface AstInteractionOptions {
    onCursorChange?: (position: CursorPosition) => void;
}

/**
 * Creates all AST interaction extensions in one call.
 */
export function createAstInteractionExtensions(
    options: AstInteractionOptions = {}
): Extension[] {
    const extensions: Extension[] = [highlightExtension()];

    if (options.onCursorChange) {
        extensions.push(cursorPositionTracker(options.onCursorChange));
    }

    return extensions;
}
