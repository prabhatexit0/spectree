import Parser from 'web-tree-sitter';

export interface AstNode {
  kind: string;
  start: number;
  end: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  text?: string;
  isNamed: boolean;
  children: AstNode[];
}

export interface ParseResult {
  success: boolean;
  ast?: AstNode;
  error?: string;
  language: string;
}

// Supported languages and their WASM file paths
const LANGUAGE_WASM: Record<string, string> = {
  json: '/parsers/tree-sitter-json.wasm',
  rust: '/parsers/tree-sitter-rust.wasm',
  javascript: '/parsers/tree-sitter-javascript.wasm',
  typescript: '/parsers/tree-sitter-typescript.wasm',
  tsx: '/parsers/tree-sitter-tsx.wasm',
  python: '/parsers/tree-sitter-python.wasm',
  go: '/parsers/tree-sitter-go.wasm',
  ocaml: '/parsers/tree-sitter-ocaml.wasm',
};

class TreeSitterParser {
  private parser: Parser | null = null;
  private languages: Map<string, Parser.Language> = new Map();
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.parser) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await Parser.init({
        locateFile: (scriptName: string) => {
          if (scriptName === 'tree-sitter.wasm') {
            return '/tree-sitter.wasm';
          }
          return scriptName;
        },
      });
      this.parser = new Parser();
    })();

    return this.initPromise;
  }

  async loadLanguage(lang: string): Promise<Parser.Language> {
    await this.init();

    if (this.languages.has(lang)) {
      return this.languages.get(lang)!;
    }

    const wasmPath = LANGUAGE_WASM[lang];
    if (!wasmPath) {
      throw new Error(`Unsupported language: ${lang}`);
    }

    const language = await Parser.Language.load(wasmPath);
    this.languages.set(lang, language);
    return language;
  }

  private nodeToAst(node: Parser.SyntaxNode, source: string): AstNode {
    const children: AstNode[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        children.push(this.nodeToAst(child, source));
      }
    }

    return {
      kind: node.type,
      start: node.startIndex,
      end: node.endIndex,
      startPosition: {
        row: node.startPosition.row,
        column: node.startPosition.column,
      },
      endPosition: {
        row: node.endPosition.row,
        column: node.endPosition.column,
      },
      text: node.childCount === 0 ? node.text : undefined,
      isNamed: node.isNamed,
      children,
    };
  }

  async parse(code: string, language: string): Promise<ParseResult> {
    try {
      await this.init();

      if (!this.parser) {
        return {
          success: false,
          error: 'Parser not initialized',
          language,
        };
      }

      const lang = await this.loadLanguage(language);
      this.parser.setLanguage(lang);

      const tree = this.parser.parse(code);
      const ast = this.nodeToAst(tree.rootNode, code);

      return {
        success: true,
        ast,
        language,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        language,
      };
    }
  }

  getSupportedLanguages(): string[] {
    return Object.keys(LANGUAGE_WASM);
  }
}

// Singleton instance
export const parser = new TreeSitterParser();
