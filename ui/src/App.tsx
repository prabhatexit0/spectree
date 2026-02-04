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
    let message = "Hello, AST!";
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

function App() {
  const [code, setCode] = useState(SAMPLE_CODE.json);
  const [language, setLanguage] = useState('json');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [cursorNodePath, setCursorNodePath] = useState<string | null>(null);
  const [hoveredNodePath, setHoveredNodePath] = useState<string | null>(null);

  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const cursorDebounceRef = useRef<number | null>(null);

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
      'flex items-center gap-2 py-1 px-2 rounded cursor-pointer transition-colors',
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
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => hasChildren && toggleNode(path)}
          onMouseEnter={() => handleNodeHover(path)}
          onMouseLeave={handleNodeLeave}
        >
          {/* Expand/collapse indicator */}
          <span className="w-4 text-gray-500 flex-shrink-0">
            {hasChildren ? (isExpanded ? '▼' : '▶') : '•'}
          </span>

          {/* Node kind with styling based on named/anonymous */}
          <span
            className={`font-mono text-sm ${isNamed ? 'text-blue-400 font-semibold' : 'text-gray-500'
              }`}
          >
            {node.kind}
          </span>

          {/* Position info */}
          <span className="text-xs text-gray-600 font-mono">
            [{node.startPosition.row}:{node.startPosition.column} -{' '}
            {node.endPosition.row}:{node.endPosition.column}]
          </span>

          {/* Text content for leaf nodes */}
          {node.text && (
            <span className="text-green-400 text-sm font-mono truncate max-w-xs">
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

  return (
    <div className="h-full flex flex-col bg-[#0f0f0f] text-white">
      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Editor Panel */}
        <div className="w-1/2 flex flex-col border-r border-white/10">
          <div className="px-4 py-2 border-b border-white/10 bg-white/5 flex items-center justify-between h-[50px]">
            <span className="text-sm font-medium text-gray-400">
              Source Code
            </span>
            <LanguageSelector
              value={language}
              onChange={handleLanguageChange}
            />
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
        <div className="w-1/2 flex flex-col">
          <div className="px-4 py-2 border-b border-white/10 bg-white/5 flex items-center justify-between h-[50px]">
            <span className="text-sm font-medium text-gray-400">
              Abstract Syntax Tree
            </span>
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

          <div className="flex-1 overflow-auto p-4">
            {isLoading && (
              <div className="flex items-center justify-center h-full">
                <div className="text-gray-400">Loading Tree-sitter...</div>
              </div>
            )}

            {initError && (
              <div className="bg-red-500/20 border border-red-500/50 rounded p-4 text-red-300">
                <p className="font-semibold mb-2">Initialization Error</p>
                <p className="text-sm">{initError}</p>
              </div>
            )}

            {!isLoading && !initError && parseResult && (
              <>
                {parseResult.success && parseResult.ast ? (
                  <div className="font-mono text-sm">
                    {renderAstNode(parseResult.ast, 'root')}
                  </div>
                ) : (
                  <div className="bg-red-500/20 border border-red-500/50 rounded p-4 text-red-300">
                    <p className="font-semibold">Parse Error</p>
                    <p className="text-sm mt-1">{parseResult.error}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="px-6 py-2 border-t border-white/10 text-xs text-gray-500 flex justify-between">
        <span>Powered by Tree-sitter WASM</span>
        {parseResult?.ast && (
          <span>
            Nodes: {countNodes(parseResult.ast)} | Language:{' '}
            {parseResult.language}
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
