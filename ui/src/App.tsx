import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { json } from '@codemirror/lang-json';
import { rust } from '@codemirror/lang-rust';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { StreamLanguage } from '@codemirror/language';
import { parser, type AstNode, type ParseResult } from './lib/parser';
import { LanguageSelector } from './components/LanguageSelector';
import { BottomSheet, type SnapPoint } from './components/BottomSheet';
import {
  cursorPositionTracker,
  highlightExtension,
  setHighlight,
  type CursorPosition,
} from './lib/codemirror-extensions';

// Sample code for each language
const SAMPLE_CODE: Record<string, string> = {
  json: `{
  "name": "TreeHouse",
  "version": "1.0.0",
  "features": ["parsing", "visualization"],
  "config": {
    "theme": "dark",
    "fontSize": 14
  }
}`,
  rust: `fn main() {
    let message = "Hello, AST (Welcome to TreeHouse)!";
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
  const [cursorNodePath, setCursorNodePath] = useState<string | null>(null);
  const [hoveredNodePath, setHoveredNodePath] = useState<string | null>(null);
  const [astSnap, setAstSnap] = useState<SnapPoint>('collapsed');

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
        }
      }, 50);
    },
    [parseResult?.ast, cursorNodePath, findNodeAtPosition, expandPathToNode]
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

  // Create cursor tracker extension
  const cursorTrackerExtension = useMemo(
    () => cursorPositionTracker(handleCursorChange),
    [handleCursorChange]
  );

  // Expand all nodes
  const expandAll = () => {
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
  };

  // Collapse all nodes
  const collapseAll = () => {
    setExpandedNodes(new Set(['root']));
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
      'ast-node-row flex items-center gap-1 md:gap-2 py-2 md:py-1 px-2 rounded cursor-pointer transition-colors touch-active',
      depth === 0 ? 'bg-white/5' : '',
      isAtCursor ? 'ast-node-at-cursor' : '',
      isHovered ? 'ast-node-hovered' : '',
      !isAtCursor && !isHovered ? 'hover:bg-white/10' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div key={path} className="select-none">
        <div
          className={rowClasses}
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
          <span className="ast-node-toggle w-6 md:w-4 text-gray-500 flex-shrink-0 flex items-center justify-center">
            {hasChildren ? (isExpanded ? '▼' : '▶') : '•'}
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
      <div className="h-full flex flex-col bg-[#0f0f0f] text-white">
        {/* Mobile header: language selector */}
        <div
          className="mobile-header flex items-center justify-between px-3 py-2 border-b border-white/10 bg-[#161616]"
          style={{ paddingTop: `max(8px, var(--safe-area-top))` }}
        >
          <span className="text-sm font-medium text-gray-300 truncate">TreeHouse</span>
          <LanguageSelector value={language} onChange={handleLanguageChange} isMobile />
        </div>

        {/* Code editor fills remaining space */}
        <div className="flex-1 overflow-hidden relative">
          <CodeMirror
            ref={editorRef}
            value={code}
            height="100%"
            theme={vscodeDark}
            extensions={[
              languageExtension,
              highlightExtension(),
              cursorTrackerExtension,
            ]}
            onChange={handleCodeChange}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
              foldGutter: false,
              dropCursor: true,
              allowMultipleSelections: false,
              indentOnInput: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: false,
              rectangularSelection: false,
              crosshairCursor: false,
              highlightSelectionMatches: true,
            }}
            style={{ height: '100%', fontSize: '14px' }}
          />
        </div>

        {/* AST Bottom Sheet */}
        <BottomSheet
          snap={astSnap}
          onSnapChange={setAstSnap}
          header={
            <div className="flex items-center justify-between w-full px-4">
              <span className="text-sm font-medium text-gray-300">
                AST Tree
                {parseResult?.ast && (
                  <span className="text-xs text-gray-500 ml-2">
                    {countNodes(parseResult.ast)} nodes
                  </span>
                )}
              </span>
              {parseResult?.ast && (
                <div className="flex gap-2">
                  <button
                    onClick={expandAll}
                    className="text-xs px-2 py-1 rounded bg-white/10 active:bg-white/20 transition-colors"
                  >
                    Expand
                  </button>
                  <button
                    onClick={collapseAll}
                    className="text-xs px-2 py-1 rounded bg-white/10 active:bg-white/20 transition-colors"
                  >
                    Collapse
                  </button>
                </div>
              )}
            </div>
          }
        >
          <div className="flex-1 overflow-auto p-3 hide-scrollbar ast-tree">
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
    <div className="h-full flex flex-col bg-[#0f0f0f] text-white">
      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Editor Panel */}
        <div className="flex flex-col border-r border-white/10 md:w-1/2">
          {/* Desktop header */}
          <div className="flex px-4 py-2 border-b border-white/10 bg-white/5 items-center justify-between h-[50px]">
            <span className="text-sm font-medium text-gray-400">Source Code</span>
            <LanguageSelector value={language} onChange={handleLanguageChange} />
          </div>
          <div className="flex-1 overflow-hidden">
            <CodeMirror
              ref={editorRef}
              value={code}
              height="100%"
              theme={vscodeDark}
              extensions={[
                languageExtension,
                highlightExtension(),
                cursorTrackerExtension,
              ]}
              onChange={handleCodeChange}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLineGutter: true,
                highlightActiveLine: true,
                foldGutter: true,
                dropCursor: true,
                allowMultipleSelections: true,
                indentOnInput: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: true,
                rectangularSelection: true,
                crosshairCursor: false,
                highlightSelectionMatches: true,
              }}
              style={{ height: '100%', fontSize: '14px' }}
            />
          </div>
        </div>

        {/* AST Panel */}
        <div className="flex flex-col md:w-1/2">
          {/* Desktop header */}
          <div className="flex px-4 py-2 border-b border-white/10 bg-white/5 items-center justify-between h-[50px]">
            <span className="text-sm font-medium text-gray-400">Abstract Syntax Tree</span>
            {parseResult?.ast && (
              <div className="flex gap-2">
                <button
                  onClick={expandAll}
                  className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
                >
                  Expand All
                </button>
                <button
                  onClick={collapseAll}
                  className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
                >
                  Collapse All
                </button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto p-3 md:p-4 hide-scrollbar ast-tree">
            {renderAstContent()}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer
        className="px-4 md:px-6 py-2 border-t border-white/10 text-xs text-gray-500 flex justify-between"
        style={{ paddingBottom: `max(8px, var(--safe-area-bottom))` }}
      >
        <span className="truncate">Tree-sitter WASM</span>
        {parseResult?.ast && (
          <span className="truncate ml-2">
            {countNodes(parseResult.ast)} nodes | {parseResult.language}
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
