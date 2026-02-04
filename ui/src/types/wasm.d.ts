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
