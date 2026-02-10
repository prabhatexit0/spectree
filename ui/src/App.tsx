import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { json } from '@codemirror/lang-json';
import { rust } from '@codemirror/lang-rust';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { StreamLanguage } from '@codemirror/language';
import {
  ChevronRight,
  ChevronDown,
  UnfoldVertical,
  FoldVertical,
  Minus,
  Search,
  Pencil,
  GitBranch,
  List,
} from 'lucide-react';
import { parser, type AstNode, type ParseResult } from './lib/parser';
import { LanguageSelector } from './components/LanguageSelector';
import { BottomSheet, type SnapPoint } from './components/BottomSheet';
import { TreeView } from './components/TreeView';
import { EditorView } from '@codemirror/view';
import {
  cursorPositionTracker,
  highlightExtension,
  setHighlight,
  explorerClickHandler,
  type CursorPosition,
} from './lib/codemirror-extensions';

type EditorMode = 'explorer' | 'edit';

// Sample code for each language
const SAMPLE_CODE: Record<string, string> = {
  json: `{
  "name": "SpecTree",
  "version": "1.0.0",
  "features": ["parsing", "visualization"],
  "config": {
    "theme": "dark",
    "fontSize": 14
  }
}`,
  rust: `fn main() {
    let message = "Hello, AST (Welcome to SpecTree)!";
    println!("{}", message);

    for i in 0..5 {
        println!("Count: {}", i);
    }
}`,
  javascript: `function greet(name) {
  const message = \`Hello, \${name}!\`;
  console.log(message);
  return message;
}

const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);`,
  typescript: `interface User {
  name: string;
  age: number;
}

function greet(user: User): string {
  const message = \`Hello, \${user.name}!\`;
  console.log(message);
  return message;
}

const user: User = { name: "Alice", age: 30 };`,
  python: `def fibonacci(n: int) -> int:
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

for i in range(10):
    print(f"fib({i}) = {fibonacci(i)}")`,
  go: `package main

import "fmt"

func main() {
    message := "Hello, AST!"
    fmt.Println(message)

    for i := 0; i < 5; i++ {
        fmt.Printf("Count: %d\\n", i)
    }
}`,
  ocaml: `let rec factorial n =
  if n <= 1 then 1
  else n * factorial (n - 1)

let () =
  let result = factorial 5 in
  Printf.printf "5! = %d\\n" result`,
  tsx: `function Welcome({ name }: { name: string }) {
  return (
    <div className="container">
      <h1>Hello, {name}!</h1>
      <p>This is a React component</p>
    </div>
  );
}

export default Welcome;`,
};

// Simple OCaml mode for basic syntax highlighting
const ocamlLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.match(/\(\*/)) {
      while (!stream.match(/\*\)/) && !stream.eol()) {
        stream.next();
      }
      return 'comment';
    }
    if (stream.match(/"(?:[^"\\]|\\.)*"/)) {
      return 'string';
    }
    if (stream.match(/\b(let|rec|in|if|then|else|match|with|fun|function|type|module|struct|sig|end|open|include|val|and|or|not|true|false|begin|end|for|to|do|done|while|try|exception|raise|ref)\b/)) {
      return 'keyword';
    }
    if (stream.match(/\b\d+(\.\d+)?\b/)) {
      return 'number';
    }
    if (stream.match(/[+\-*/=<>@^|&!?~.:]+/)) {
      return 'operator';
    }
    if (stream.match(/[a-z_][a-zA-Z0-9_']*/)) {
      return 'variable';
    }
    if (stream.match(/[A-Z][a-zA-Z0-9_']*/)) {
      return 'typeName';
    }
    stream.next();
    return null;
  },
});

// Get CodeMirror language extension for each language
function getLanguageExtension(lang: string) {
  switch (lang) {
    case 'json':
      return json();
    case 'rust':
      return rust();
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'python':
      return python();
    case 'go':
      return go();
    case 'ocaml':
      return ocamlLanguage;
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    default:
      return [];
  }
}

// Hook to detect mobile viewport
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
}

function App() {
  const [code, setCode] = useState(SAMPLE_CODE.rust);
  const [language, setLanguage] = useState('rust');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [isAllExpanded, setIsAllExpanded] = useState(false);
  const [cursorNodePath, setCursorNodePath] = useState<string | null>(null);
  const [hoveredNodePath, setHoveredNodePath] = useState<string | null>(null);
  const [astSnap, setAstSnap] = useState<SnapPoint>('collapsed');
  const [editorMode, setEditorMode] = useState<EditorMode>('explorer');
  const [treeViewEnabled, setTreeViewEnabled] = useState(false);

  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const cursorDebounceRef = useRef<number | null>(null);
  const isMobile = useIsMobile();

  // Memoize language extension to prevent unnecessary re-renders
  const languageExtension = useMemo(
    () => getLanguageExtension(language),
    [language]
  );

  // Initialize parser
  useEffect(() => {
    parser
      .init()
      .then(() => {
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('Failed to initialize parser:', err);
        setInitError(err.message || 'Failed to initialize parser');
        setIsLoading(false);
      });
  }, []);

  // Parse code when it changes
  const parseCode = useCallback(async () => {
    if (isLoading) return;

    try {
      const result = await parser.parse(code, language);
      setParseResult(result);

      // Auto-expand root and first level
      if (result.ast) {
        const initialExpanded = new Set<string>();
        initialExpanded.add('root');
        result.ast.children.forEach((_, i) => {
          initialExpanded.add(`root-${i}`);
        });
        setExpandedNodes(initialExpanded);
      }
    } catch (err) {
      console.error('Parse error:', err);
      setParseResult({
        success: false,
        error: String(err),
        language,
      });
    }
  }, [code, language, isLoading]);

  // Parse on code or language change
  useEffect(() => {
    parseCode();
  }, [parseCode]);

  // Handle language change
  const handleLanguageChange = (newLanguage: string) => {
    setLanguage(newLanguage);
    setCode(SAMPLE_CODE[newLanguage] || '');
  };

  // Handle code change from editor
  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
  }, []);

  // Toggle node expansion
  const toggleNode = (path: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // ============================================
  // Expand-to-Cursor: Utility Functions
  // ============================================

  // Find the deepest node at a given position (0-indexed row/column)
  const findNodeAtPosition = useCallback(
    (node: AstNode, row: number, col: number, path: string): string | null => {
      // Check if position is within this node's range
      const { startPosition, endPosition } = node;
      const inRange =
        (row > startPosition.row ||
          (row === startPosition.row && col >= startPosition.column)) &&
        (row < endPosition.row ||
          (row === endPosition.row && col <= endPosition.column));

      if (!inRange) return null;

      // Check children for a more specific match
      for (let i = 0; i < node.children.length; i++) {
        const childPath = `${path}-${i}`;
        const childResult = findNodeAtPosition(
          node.children[i],
          row,
          col,
          childPath
        );
        if (childResult) return childResult;
      }

      // If no child matches, this node is the deepest match
      return path;
    },
    []
  );

  // Expand only the path to target node (collapse all other branches)
  const expandPathToNode = useCallback((targetPath: string) => {
    const parts = targetPath.split('-');
    const pathsToExpand = new Set<string>();

    // Build all ancestor paths: root, root-0, root-0-1, etc.
    for (let i = 1; i <= parts.length; i++) {
      pathsToExpand.add(parts.slice(0, i).join('-'));
    }

    // Replace expanded nodes entirely (collapses other branches)
    setExpandedNodes(pathsToExpand);
  }, []);

  // Get an AST node by its path
  const getNodeByPath = useCallback(
    (ast: AstNode, path: string): AstNode | null => {
      const parts = path.split('-').slice(1); // Remove 'root' prefix
      let current = ast;

      for (const part of parts) {
        const index = parseInt(part, 10);
        if (isNaN(index) || index >= current.children.length) {
          return null;
        }
        current = current.children[index];
      }

      return current;
    },
    []
  );

  // Handle cursor position change with debouncing
  const handleCursorChange = useCallback(
    (position: CursorPosition) => {
      // Debounce cursor changes to avoid excessive updates
      if (cursorDebounceRef.current) {
        window.clearTimeout(cursorDebounceRef.current);
      }

      cursorDebounceRef.current = window.setTimeout(() => {
        if (!parseResult?.ast) return;

        const nodePath = findNodeAtPosition(
          parseResult.ast,
          position.line,
          position.column,
          'root'
        );

        if (nodePath && nodePath !== cursorNodePath) {
          setCursorNodePath(nodePath);
          expandPathToNode(nodePath);

          // In explorer mode, highlight the matched node's range in the editor
          if (editorMode === 'explorer') {
            if (editorRef.current?.view) {
              const node = getNodeByPath(parseResult.ast, nodePath);
              if (node) {
                setHighlight(editorRef.current.view, {
                  from: node.start,
                  to: node.end,
                });
              }
            }
            // On mobile, auto-open the bottom sheet so the AST node is visible
            if (isMobile && astSnap === 'collapsed') {
              setAstSnap('half');
            }
          }
        }
      }, 50);
    },
    [parseResult?.ast, cursorNodePath, findNodeAtPosition, expandPathToNode, editorMode, getNodeByPath, isMobile, astSnap]
  );

  // ============================================
  // Hover Highlighting: Event Handlers
  // ============================================

  const handleNodeHover = useCallback(
    (path: string) => {
      if (!parseResult?.ast || !editorRef.current?.view) return;

      setHoveredNodePath(path);

      const node = getNodeByPath(parseResult.ast, path);
      if (node) {
        setHighlight(editorRef.current.view, {
          from: node.start,
          to: node.end,
        });
      }
    },
    [parseResult?.ast, getNodeByPath]
  );

  const handleNodeLeave = useCallback(() => {
    setHoveredNodePath(null);
    if (editorRef.current?.view) {
      setHighlight(editorRef.current.view, null);
    }
  }, []);

  // Auto-scroll AST tree to the node at cursor
  useEffect(() => {
    if (!cursorNodePath) return;

    // Small delay to let the DOM update after expandPathToNode
    const timer = window.setTimeout(() => {
      const el = document.querySelector(`[data-ast-path="${cursorNodePath}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 60);

    return () => window.clearTimeout(timer);
  }, [cursorNodePath]);

  // Create cursor tracker extension
  const cursorTrackerExtension = useMemo(
    () => cursorPositionTracker(handleCursorChange),
    [handleCursorChange]
  );

  // Explorer mode: click handler for AST node finding when editor is non-editable
  const explorerClickExtension = useMemo(
    () => explorerClickHandler(handleCursorChange),
    [handleCursorChange]
  );

  // Build editor extensions based on current mode
  const editorExtensions = useMemo(() => {
    const exts = [languageExtension, highlightExtension()];
    if (editorMode === 'explorer') {
      exts.push(EditorView.editable.of(false));
      exts.push(explorerClickExtension);
    } else {
      exts.push(cursorTrackerExtension);
    }
    return exts;
  }, [editorMode, languageExtension, cursorTrackerExtension, explorerClickExtension]);

  // Toggle expand/collapse all nodes
  const toggleExpandCollapseAll = () => {
    if (isAllExpanded) {
      setExpandedNodes(new Set(['root']));
      setIsAllExpanded(false);
    } else {
      if (!parseResult?.ast) return;
      const allPaths = new Set<string>();

      const collectPaths = (node: AstNode, path: string) => {
        allPaths.add(path);
        node.children.forEach((child, i) => {
          collectPaths(child, `${path}-${i}`);
        });
      };

      collectPaths(parseResult.ast, 'root');
      setExpandedNodes(allPaths);
      setIsAllExpanded(true);
    }
  };

  // Render AST node recursively
  const renderAstNode = (node: AstNode, path: string, depth: number = 0) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedNodes.has(path);
    const isNamed = node.isNamed;
    const isAtCursor = path === cursorNodePath;
    const isHovered = path === hoveredNodePath;

    // Build class names for the node row
    const rowClasses = [
      'ast-node-row flex items-center gap-1 md:gap-1.5 py-1.5 md:py-0.5 px-1 cursor-pointer transition-colors touch-active',
      isAtCursor ? 'ast-node-at-cursor' : '',
      isHovered ? 'ast-node-hovered' : '',
      !isAtCursor && !isHovered ? 'hover:bg-white/[0.06]' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div key={path} className="select-none">
        <div
          className={rowClasses}
          data-ast-path={path}
          style={{ paddingLeft: `${depth * (isMobile ? 12 : 16) + 8}px` }}
          onClick={() => {
            if (hasChildren) toggleNode(path);
            // On mobile, also trigger highlight on click
            if (isMobile) handleNodeHover(path);
          }}
          onMouseEnter={() => handleNodeHover(path)}
          onMouseLeave={handleNodeLeave}
          onTouchEnd={() => {
            // Clear highlight after delay on mobile
            if (isMobile) setTimeout(handleNodeLeave, 2000);
          }}
        >
          {/* Expand/collapse indicator */}
          <span className="ast-node-toggle w-5 md:w-4 text-gray-500 flex-shrink-0 flex items-center justify-center">
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 md:w-3 md:h-3" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 md:w-3 md:h-3" />
              )
            ) : (
              <Minus className="w-2.5 h-2.5 md:w-2 md:h-2 opacity-30" />
            )}
          </span>

          {/* Node kind with styling based on named/anonymous */}
          <span
            className={`font-mono text-xs md:text-sm ${isNamed ? 'text-blue-400 font-semibold' : 'text-gray-500'}`}
          >
            {node.kind}
          </span>

          {/* Position info - hidden on mobile for space */}
          <span className="hidden md:inline text-xs text-gray-600 font-mono">
            [{node.startPosition.row}:{node.startPosition.column} -{' '}
            {node.endPosition.row}:{node.endPosition.column}]
          </span>

          {/* Text content for leaf nodes */}
          {node.text && (
            <span className="text-green-400 text-xs md:text-sm font-mono truncate max-w-[120px] md:max-w-xs">
              "{node.text}"
            </span>
          )}
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div>
            {node.children.map((child, i) =>
              renderAstNode(child, `${path}-${i}`, depth + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  // Render AST content
  const renderAstContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-gray-400">Loading Tree-sitter...</div>
        </div>
      );
    }

    if (initError) {
      return (
        <div className="bg-red-500/20 border border-red-500/50 rounded p-4 text-red-300">
          <p className="font-semibold mb-2">Initialization Error</p>
          <p className="text-sm">{initError}</p>
        </div>
      );
    }

    if (parseResult) {
      if (parseResult.success && parseResult.ast) {
        if (treeViewEnabled) {
          return (
            <TreeView
              ast={parseResult.ast}
              expandedNodes={expandedNodes}
              cursorNodePath={cursorNodePath}
              hoveredNodePath={hoveredNodePath}
              onToggleNode={toggleNode}
              onNodeHover={handleNodeHover}
              onNodeLeave={handleNodeLeave}
            />
          );
        }
        return (
          <div className="font-mono text-sm">
            {renderAstNode(parseResult.ast, 'root')}
          </div>
        );
      } else {
        return (
          <div className="bg-red-500/20 border border-red-500/50 rounded p-4 text-red-300">
            <p className="font-semibold">Parse Error</p>
            <p className="text-sm mt-1">{parseResult.error}</p>
          </div>
        );
      }
    }

    return null;
  };

  // ============================================
  // Mobile Layout
  // ============================================
  if (isMobile) {
    return (
      <div className="h-full flex flex-col bg-[#1e1e1e] text-white">
        {/* Mobile header */}
        <div
          className="mobile-header flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-[#1e1e1e] overflow-visible relative z-20"
          style={{ paddingTop: `max(10px, var(--safe-area-top))` }}
        >
          <span className="text-sm font-semibold text-white/90 tracking-tight">spectree</span>
          <div className="flex items-center gap-2.5">
            <div className="editor-mode-toggle flex items-center bg-white/[0.08] rounded-full p-[3px]">
              <button
                onClick={() => setEditorMode('explorer')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  editorMode === 'explorer'
                    ? 'bg-[#007acc] text-white shadow-sm shadow-blue-500/30'
                    : 'text-gray-400 active:bg-white/10'
                }`}
                aria-label="Explorer mode"
              >
                <Search className="w-3 h-3" />
                <span>Explore</span>
              </button>
              <button
                onClick={() => setEditorMode('edit')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  editorMode === 'edit'
                    ? 'bg-[#007acc] text-white shadow-sm shadow-blue-500/30'
                    : 'text-gray-400 active:bg-white/10'
                }`}
                aria-label="Edit mode"
              >
                <Pencil className="w-3 h-3" />
                <span>Edit</span>
              </button>
            </div>
            <div className="w-px h-5 bg-white/[0.08]" />
            <LanguageSelector value={language} onChange={handleLanguageChange} isMobile />
          </div>
        </div>

        {/* Code editor fills remaining space */}
        <div className="flex-1 overflow-hidden relative">
          <CodeMirror
            ref={editorRef}
            value={code}
            height="100%"
            theme={vscodeDark}
            extensions={editorExtensions}
            onChange={editorMode === 'edit' ? handleCodeChange : undefined}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: editorMode === 'edit',
              highlightActiveLine: editorMode === 'edit',
              foldGutter: false,
              dropCursor: editorMode === 'edit',
              allowMultipleSelections: false,
              indentOnInput: editorMode === 'edit',
              bracketMatching: editorMode === 'edit',
              closeBrackets: editorMode === 'edit',
              autocompletion: false,
              rectangularSelection: false,
              crosshairCursor: false,
              highlightSelectionMatches: editorMode === 'edit',
            }}
            style={{ height: '100%', fontSize: '14px' }}
          />
        </div>

        {/* AST Bottom Sheet */}
        <BottomSheet
          snap={astSnap}
          onSnapChange={setAstSnap}
          collapsedLabel={parseResult?.ast ? `AST \u00b7 ${countNodes(parseResult.ast)} nodes` : 'AST'}
          header={
            <div className="flex items-center justify-between w-full px-3">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                AST
                {parseResult?.ast && (
                  <span className="text-gray-600 ml-2 normal-case tracking-normal">
                    {countNodes(parseResult.ast)} nodes
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                {/* Tree View toggle (mobile) */}
                <div className="flex items-center bg-white/[0.08] rounded-full p-[2px]">
                  <button
                    onClick={() => setTreeViewEnabled(false)}
                    className={`flex items-center justify-center w-6 h-6 rounded-full transition-all ${
                      !treeViewEnabled
                        ? 'bg-[#007acc] text-white shadow-sm shadow-blue-500/30'
                        : 'text-gray-500 active:bg-white/10'
                    }`}
                    aria-label="List view"
                  >
                    <List className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setTreeViewEnabled(true)}
                    className={`flex items-center justify-center w-6 h-6 rounded-full transition-all ${
                      treeViewEnabled
                        ? 'bg-[#007acc] text-white shadow-sm shadow-blue-500/30'
                        : 'text-gray-500 active:bg-white/10'
                    }`}
                    aria-label="Tree view"
                  >
                    <GitBranch className="w-3 h-3" />
                  </button>
                </div>
                {/* Expand/Collapse all (only in list view) */}
                {parseResult?.ast && !treeViewEnabled && (
                  <button
                    onClick={toggleExpandCollapseAll}
                    className="flex items-center justify-center w-7 h-7 rounded text-gray-500 active:bg-white/10 transition-colors"
                    aria-label={isAllExpanded ? 'Collapse all' : 'Expand all'}
                  >
                    {isAllExpanded ? (
                      <FoldVertical className="w-3.5 h-3.5" />
                    ) : (
                      <UnfoldVertical className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>
          }
        >
          <div className={`flex-1 ${treeViewEnabled ? 'relative overflow-hidden' : 'overflow-auto px-1 py-1 hide-scrollbar ast-tree'}`}>
            {renderAstContent()}
          </div>
        </BottomSheet>
      </div>
    );
  }

  // ============================================
  // Desktop Layout
  // ============================================
  return (
    <div className="h-full flex flex-col bg-[#1e1e1e] text-white">
      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Editor Panel */}
        <div className="flex flex-col border-r border-white/[0.06] md:w-1/2">
          {/* Desktop header */}
          <div className="flex px-4 py-2 border-b border-white/[0.06] bg-[#1e1e1e] items-center justify-between h-[36px]">
            <span className="text-xs font-semibold text-white/60 tracking-tight">Source Code</span>
            <div className="flex items-center gap-3">
              <div className="editor-mode-toggle flex items-center bg-white/[0.08] rounded-full p-[3px]">
                <button
                  onClick={() => setEditorMode('explorer')}
                  className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium transition-all ${
                    editorMode === 'explorer'
                      ? 'bg-[#007acc] text-white shadow-sm shadow-blue-500/30'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-white/10'
                  }`}
                  aria-label="Explorer mode"
                >
                  <Search className="w-3 h-3" />
                  <span>Explore</span>
                </button>
                <button
                  onClick={() => setEditorMode('edit')}
                  className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium transition-all ${
                    editorMode === 'edit'
                      ? 'bg-[#007acc] text-white shadow-sm shadow-blue-500/30'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-white/10'
                  }`}
                  aria-label="Edit mode"
                >
                  <Pencil className="w-3 h-3" />
                  <span>Edit</span>
                </button>
              </div>
              <LanguageSelector value={language} onChange={handleLanguageChange} />
            </div>
          </div>
          <div className="flex-1 overflow-hidden relative">
            <CodeMirror
              ref={editorRef}
              value={code}
              height="100%"
              theme={vscodeDark}
              extensions={editorExtensions}
              onChange={editorMode === 'edit' ? handleCodeChange : undefined}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLineGutter: editorMode === 'edit',
                highlightActiveLine: editorMode === 'edit',
                foldGutter: editorMode === 'edit',
                dropCursor: editorMode === 'edit',
                allowMultipleSelections: editorMode === 'edit',
                indentOnInput: editorMode === 'edit',
                bracketMatching: editorMode === 'edit',
                closeBrackets: editorMode === 'edit',
                autocompletion: editorMode === 'edit',
                rectangularSelection: editorMode === 'edit',
                crosshairCursor: false,
                highlightSelectionMatches: editorMode === 'edit',
              }}
              style={{ height: '100%', fontSize: '14px' }}
            />
          </div>
        </div>

        {/* AST Panel */}
        <div className="flex flex-col md:w-1/2 bg-[#1e1e1e]">
          {/* Desktop header */}
          <div className="flex px-4 py-2 border-b border-white/[0.06] bg-[#1e1e1e] items-center justify-between h-[36px]">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-white/60 tracking-tight">AST</span>
              {parseResult?.ast && (
                <span className="text-xs text-gray-600">
                  {countNodes(parseResult.ast)} nodes
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Tree View toggle */}
              <div className="flex items-center bg-white/[0.08] rounded-full p-[3px]">
                <button
                  onClick={() => setTreeViewEnabled(false)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all ${
                    !treeViewEnabled
                      ? 'bg-[#007acc] text-white shadow-sm shadow-blue-500/30'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-white/10'
                  }`}
                  aria-label="List view"
                >
                  <List className="w-3 h-3" />
                  <span>List</span>
                </button>
                <button
                  onClick={() => setTreeViewEnabled(true)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all ${
                    treeViewEnabled
                      ? 'bg-[#007acc] text-white shadow-sm shadow-blue-500/30'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-white/10'
                  }`}
                  aria-label="Tree view"
                >
                  <GitBranch className="w-3 h-3" />
                  <span>Tree</span>
                </button>
              </div>
              {/* Expand/Collapse all (only in list view) */}
              {parseResult?.ast && !treeViewEnabled && (
                <button
                  onClick={toggleExpandCollapseAll}
                  className="flex items-center gap-1.5 text-xs px-1.5 py-1 rounded hover:bg-white/10 transition-colors text-gray-500 hover:text-gray-400"
                  aria-label={isAllExpanded ? 'Collapse all nodes' : 'Expand all nodes'}
                >
                  {isAllExpanded ? (
                    <>
                      <FoldVertical className="w-3.5 h-3.5" />
                      <span>Collapse</span>
                    </>
                  ) : (
                    <>
                      <UnfoldVertical className="w-3.5 h-3.5" />
                      <span>Expand</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
          <div className={`flex-1 ${treeViewEnabled ? 'relative overflow-hidden' : 'overflow-auto px-2 py-1 ast-tree'}`}>
            {renderAstContent()}
          </div>
        </div>
      </div>

      {/* Footer - status bar */}
      <footer
        className="px-4 py-1 border-t border-blue-500/30 bg-[#007acc] text-xs text-white/90 flex justify-between items-center h-[22px]"
        style={{ paddingBottom: `max(4px, var(--safe-area-bottom))` }}
      >
        <span className="truncate">Tree-sitter WASM</span>
        {parseResult?.ast && (
          <span className="truncate ml-2">
            {countNodes(parseResult.ast)} nodes &middot; {parseResult.language}
          </span>
        )}
      </footer>
    </div>
  );
}

// Helper to count total nodes
function countNodes(node: AstNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

export default App;
