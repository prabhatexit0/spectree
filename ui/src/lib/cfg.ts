import type { AstNode } from './parser';

// ============================================
// CFG Types
// ============================================

export interface CfgBlock {
  id: string;
  label: string;
  /** Short summary shown inside the block */
  statements: string[];
  /** Source range in the original code */
  start: number;
  end: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  /** Block category for color-coding */
  kind: CfgBlockKind;
  /** AST path for bidirectional highlighting */
  astPath: string;
}

export type CfgBlockKind =
  | 'entry'
  | 'exit'
  | 'statement'
  | 'branch'
  | 'loop'
  | 'return'
  | 'match';

export interface CfgEdge {
  from: string;
  to: string;
  label?: string; // "true", "false", "default", case labels, etc.
}

export interface Cfg {
  blocks: CfgBlock[];
  edges: CfgEdge[];
}

// ============================================
// Language-agnostic CFG builder
// ============================================

// Node types that represent control-flow branching
const IF_TYPES = new Set([
  'if_statement', 'if_expression', 'if_let_expression',
  'conditional_expression', 'ternary_expression',
]);

const LOOP_TYPES = new Set([
  'for_statement', 'for_expression', 'for_in_statement',
  'while_statement', 'while_expression', 'loop_expression',
  'do_statement', 'for_range_statement',
]);

const MATCH_TYPES = new Set([
  'match_expression', 'switch_statement', 'switch_expression',
]);

const RETURN_TYPES = new Set([
  'return_statement', 'return_expression',
  'break_statement', 'break_expression',
  'continue_statement', 'continue_expression',
  'throw_statement', 'raise_statement',
]);

const FUNCTION_TYPES = new Set([
  'function_declaration', 'function_definition', 'function_item',
  'method_definition', 'method_declaration',
  'arrow_function', 'lambda', 'lambda_expression',
  'closure_expression',
  'let_declaration', // OCaml `let .. in`
  'value_definition',
]);

/** Types whose children we should recurse into for control flow */
const CONTAINER_TYPES = new Set([
  'program', 'source_file', 'source',
  'block', 'statement_block', 'compound_statement',
  'declaration_list', 'field_declaration_list',
  'expression_statement', 'lexical_declaration',
  'variable_declaration', 'short_var_declaration',
  'assignment_statement', 'assignment_expression',
  'call_expression', 'module',
  ...Array.from(FUNCTION_TYPES),
]);

// ============================================
// Builder
// ============================================

let nextBlockId = 0;

function makeId(): string {
  return `cfg_${nextBlockId++}`;
}

function truncate(s: string, max: number): string {
  const line = s.split('\n')[0].trim();
  return line.length > max ? line.slice(0, max - 2) + '..' : line;
}

function nodeText(node: AstNode, code: string): string {
  return code.slice(node.start, node.end);
}

/** Get the first line of a node's source text, nicely trimmed. */
function summary(node: AstNode, code: string, max = 48): string {
  return truncate(nodeText(node, code), max);
}

/**
 * Find the "condition" child of an if/while/for node.
 * Different grammars name it differently, so we search for common field names.
 */
function findCondition(node: AstNode): AstNode | null {
  // Look for common condition child types
  for (const child of node.children) {
    if (
      child.kind === 'condition' ||
      child.kind === 'parenthesized_expression' ||
      child.kind === 'binary_expression' ||
      child.kind === 'comparison_operator'
    ) {
      return child;
    }
  }
  // Fallback: second named child is often the condition
  const named = node.children.filter(c => c.isNamed);
  if (named.length >= 2) return named[1];
  return null;
}

/**
 * Find the body/consequence block of a control-flow node.
 */
function findBody(node: AstNode): AstNode | null {
  for (const child of node.children) {
    if (
      child.kind === 'block' ||
      child.kind === 'statement_block' ||
      child.kind === 'compound_statement' ||
      child.kind === 'consequence' ||
      child.kind === 'body'
    ) {
      return child;
    }
  }
  return null;
}

/**
 * Find the else branch of an if node.
 */
function findElse(node: AstNode): AstNode | null {
  for (const child of node.children) {
    if (
      child.kind === 'else_clause' ||
      child.kind === 'else' ||
      child.kind === 'alternative'
    ) {
      return child;
    }
  }
  return null;
}

/**
 * Find match/switch arms.
 */
function findArms(node: AstNode): AstNode[] {
  const arms: AstNode[] = [];
  for (const child of node.children) {
    if (
      child.kind === 'match_arm' ||
      child.kind === 'switch_case' ||
      child.kind === 'switch_default' ||
      child.kind === 'case_clause' ||
      child.kind === 'default_clause' ||
      child.kind === 'match_case'
    ) {
      arms.push(child);
    }
    // Also check inside match_block / switch_body
    if (
      child.kind === 'match_block' ||
      child.kind === 'switch_body'
    ) {
      arms.push(...findArms(child));
    }
  }
  return arms;
}

// ============================================
// Recursive CFG construction
// ============================================

interface BuildCtx {
  blocks: CfgBlock[];
  edges: CfgEdge[];
  code: string;
}

function makeBlock(
  ctx: BuildCtx,
  label: string,
  kind: CfgBlockKind,
  node: AstNode,
  astPath: string,
  statements: string[] = [],
): CfgBlock {
  const block: CfgBlock = {
    id: makeId(),
    label,
    statements,
    start: node.start,
    end: node.end,
    startPosition: node.startPosition,
    endPosition: node.endPosition,
    kind,
    astPath,
  };
  ctx.blocks.push(block);
  return block;
}

function addEdge(ctx: BuildCtx, from: string, to: string, label?: string) {
  ctx.edges.push({ from, to, label });
}

/**
 * Build CFG for a single AST node. Returns the entry block ID and exit block IDs,
 * or null if the node produces no CFG blocks.
 */
function buildNode(
  ctx: BuildCtx,
  node: AstNode,
  astPath: string,
  code: string,
): { entry: string; exits: string[] } | null {
  // --- If / conditional ---
  if (IF_TYPES.has(node.kind)) {
    const condNode = findCondition(node);
    const condText = condNode ? summary(condNode, code) : 'condition';
    const branchBlock = makeBlock(ctx, `if ${condText}`, 'branch', node, astPath, [`if ${condText}`]);

    // True branch
    const body = findBody(node);
    const trueResult = body
      ? buildChildren(ctx, body, astPath, code)
      : null;

    if (trueResult) {
      addEdge(ctx, branchBlock.id, trueResult.entry, 'true');
    }

    // False branch
    const elseNode = findElse(node);
    let falseResult: { entry: string; exits: string[] } | null = null;
    if (elseNode) {
      // else clause may contain another if (else-if chain) or a block
      falseResult = buildChildren(ctx, elseNode, astPath, code);
      if (falseResult) {
        addEdge(ctx, branchBlock.id, falseResult.entry, 'false');
      }
    }

    // Collect exits
    const exits: string[] = [];
    if (trueResult) exits.push(...trueResult.exits);
    else exits.push(branchBlock.id); // no body → branch itself is an exit
    if (falseResult) exits.push(...falseResult.exits);
    else if (!elseNode) exits.push(branchBlock.id); // no else → branch can fall through

    return { entry: branchBlock.id, exits };
  }

  // --- Loops ---
  if (LOOP_TYPES.has(node.kind)) {
    const condNode = findCondition(node);
    const condText = condNode ? summary(condNode, code) : '';
    const keyword = node.kind.startsWith('for') ? 'for' : 'while';
    const loopLabel = condText ? `${keyword} ${condText}` : keyword;
    const loopBlock = makeBlock(ctx, loopLabel, 'loop', node, astPath, [loopLabel]);

    const body = findBody(node);
    const bodyResult = body
      ? buildChildren(ctx, body, astPath, code)
      : null;

    if (bodyResult) {
      addEdge(ctx, loopBlock.id, bodyResult.entry, 'body');
      // Back-edge: body exits loop back to condition
      for (const ex of bodyResult.exits) {
        addEdge(ctx, ex, loopBlock.id, 'next');
      }
    }

    // Loop can also exit (condition false)
    return { entry: loopBlock.id, exits: [loopBlock.id] };
  }

  // --- Match / switch ---
  if (MATCH_TYPES.has(node.kind)) {
    const matchBlock = makeBlock(ctx, `match`, 'match', node, astPath, [summary(node, code, 32)]);
    const arms = findArms(node);
    const exits: string[] = [];

    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i];
      const armLabel = truncate(
        arm.children.filter(c => c.isNamed).map(c => summary(c, code, 20)).join(' ') || `arm ${i}`,
        24,
      );
      const armResult = buildChildren(ctx, arm, `${astPath}-arm${i}`, code);
      if (armResult) {
        addEdge(ctx, matchBlock.id, armResult.entry, armLabel);
        exits.push(...armResult.exits);
      }
    }

    if (exits.length === 0) exits.push(matchBlock.id);
    return { entry: matchBlock.id, exits };
  }

  // --- Return / break / continue ---
  if (RETURN_TYPES.has(node.kind)) {
    const block = makeBlock(ctx, summary(node, code), 'return', node, astPath, [summary(node, code)]);
    return { entry: block.id, exits: [] }; // no exits — terminates flow
  }

  // --- Function declarations: create a sub-CFG ---
  if (FUNCTION_TYPES.has(node.kind)) {
    const fnName = node.children.find(c => c.kind === 'identifier' || c.kind === 'name');
    const label = fnName ? `fn ${summary(fnName, code, 24)}` : 'fn';

    const entryBlock = makeBlock(ctx, label, 'entry', node, astPath, [label]);
    const body = findBody(node);
    const bodyResult = body
      ? buildChildren(ctx, body, astPath, code)
      : null;

    if (bodyResult) {
      addEdge(ctx, entryBlock.id, bodyResult.entry);
      // Create implicit exit block for the function
      const exitBlock = makeBlock(ctx, 'end', 'exit', node, astPath, ['end']);
      for (const ex of bodyResult.exits) {
        addEdge(ctx, ex, exitBlock.id);
      }
      return { entry: entryBlock.id, exits: [exitBlock.id] };
    }

    return { entry: entryBlock.id, exits: [entryBlock.id] };
  }

  // --- Container nodes: recurse into children ---
  if (CONTAINER_TYPES.has(node.kind) || isContainerLike(node)) {
    return buildChildren(ctx, node, astPath, code);
  }

  // --- Default: treat as a simple statement ---
  if (node.isNamed && node.kind !== 'comment') {
    const block = makeBlock(ctx, summary(node, code), 'statement', node, astPath, [summary(node, code)]);
    return { entry: block.id, exits: [block.id] };
  }

  return null;
}

/** Check if a node looks like a container (has named children that are statements) */
function isContainerLike(node: AstNode): boolean {
  if (!node.isNamed) return false;
  // If it has children that are control-flow or statement nodes, recurse
  return node.children.some(
    c =>
      IF_TYPES.has(c.kind) ||
      LOOP_TYPES.has(c.kind) ||
      MATCH_TYPES.has(c.kind) ||
      RETURN_TYPES.has(c.kind) ||
      FUNCTION_TYPES.has(c.kind),
  );
}

function buildChildren(
  ctx: BuildCtx,
  node: AstNode,
  astPath: string,
  code: string,
): { entry: string; exits: string[] } | null {
  const namedChildren = node.children.filter(c => c.isNamed);
  if (namedChildren.length === 0) return null;

  // Map children back to their original indices for correct AST paths
  const childIndices = node.children
    .map((c, i) => ({ child: c, index: i }))
    .filter(({ child }) => child.isNamed);

  const results: { entry: string; exits: string[] }[] = [];

  for (const { child, index } of childIndices) {
    const childPath = `${astPath}-${index}`;
    const result = buildNode(ctx, child, childPath, code);
    if (result) results.push(result);
  }

  if (results.length === 0) return null;

  // Chain results sequentially
  for (let i = 1; i < results.length; i++) {
    for (const ex of results[i - 1].exits) {
      addEdge(ctx, ex, results[i].entry);
    }
  }

  return {
    entry: results[0].entry,
    exits: results[results.length - 1].exits,
  };
}

// ============================================
// Public API
// ============================================

/**
 * Build a control-flow graph from an AST and source code.
 */
export function buildCfg(ast: AstNode, code: string): Cfg {
  // Reset block ID counter
  nextBlockId = 0;

  const ctx: BuildCtx = {
    blocks: [],
    edges: [],
    code,
  };

  // Build from root
  const result = buildChildren(ctx, ast, 'root', code);

  // If we got a CFG, add entry/exit sentinels if not already present
  if (result && ctx.blocks.length > 0) {
    const hasEntry = ctx.blocks.some(b => b.kind === 'entry');
    if (!hasEntry) {
      const entry = makeBlock(ctx, 'entry', 'entry', ast, 'root', ['entry']);
      addEdge(ctx, entry.id, result.entry);
      // Move entry to front
      ctx.blocks.pop();
      ctx.blocks.unshift(entry);
    }
  }

  // Deduplicate edges
  const edgeSet = new Set<string>();
  ctx.edges = ctx.edges.filter(e => {
    const key = `${e.from}->${e.to}:${e.label || ''}`;
    if (edgeSet.has(key)) return false;
    edgeSet.add(key);
    return true;
  });

  return {
    blocks: ctx.blocks,
    edges: ctx.edges,
  };
}
