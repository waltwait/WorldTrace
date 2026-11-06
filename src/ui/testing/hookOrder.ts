/**
 * A small rules-of-hooks check, run as a test, because nothing else in this
 * project lints and a component cannot be rendered under vitest.
 *
 * The bug it exists for: FlightDetailSheet returned null for a missing flight
 * and only then called seven useCallbacks. Mounted with no flight it ran six
 * hooks; tapping a card made it run thirteen, React threw "Rendered more hooks
 * than during the previous render", and with no error boundary the whole app
 * went down. Every test passed, since no test can mount a component here — so
 * this reads the source instead, with the TypeScript compiler the project
 * already has.
 *
 * It looks at each function on its own, ignoring the functions nested inside
 * it (a return inside a useEffect callback is not an early return of the
 * component), and reports a hook call that comes after a return, or that sits
 * under an if, a loop, a ternary or a short-circuit.
 */

import ts from 'typescript';

export interface HookViolation {
  hook: string;
  line: number;
  reason: 'after-early-return' | 'conditional';
}

const HOOK_NAME = /^use[A-Z0-9]/;

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function hookName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee) && HOOK_NAME.test(callee.text)) return callee.text;
  if (ts.isPropertyAccessExpression(callee) && HOOK_NAME.test(callee.name.text)) {
    return callee.name.text;
  }
  return null;
}

/** Visit the nodes of one function's own body, not of functions inside it. */
function forEachOwnNode(node: ts.Node, visit: (n: ts.Node) => void): void {
  ts.forEachChild(node, (child) => {
    if (isFunctionLike(child)) return;
    visit(child);
    forEachOwnNode(child, visit);
  });
}

function containsOwnReturn(node: ts.Node): boolean {
  if (ts.isReturnStatement(node)) return true;
  let found = false;
  forEachOwnNode(node, (n) => {
    if (ts.isReturnStatement(n)) found = true;
  });
  return found;
}

function isConditionalAncestor(node: ts.Node, child: ts.Node): boolean {
  if (ts.isIfStatement(node)) return child !== node.expression;
  if (ts.isConditionalExpression(node)) return child !== node.condition;
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    const shortCircuit =
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken;
    return shortCircuit && child === node.right;
  }
  return (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isCaseClause(node) ||
    ts.isDefaultClause(node)
  );
}

function checkFunction(
  fn: ts.FunctionLikeDeclaration,
  source: ts.SourceFile,
  out: HookViolation[],
): void {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return;

  let returnedAlready = false;
  for (const statement of body.statements) {
    const calls: ts.CallExpression[] = [];
    const collect = (n: ts.Node) => {
      if (ts.isCallExpression(n) && hookName(n)) calls.push(n);
    };
    collect(statement);
    forEachOwnNode(statement, collect);

    for (const call of calls) {
      const line = source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1;
      const hook = hookName(call) as string;
      if (returnedAlready) {
        out.push({ hook, line, reason: 'after-early-return' });
        continue;
      }
      let child: ts.Node = call;
      for (let node = call.parent; node && node !== body; node = node.parent) {
        if (isConditionalAncestor(node, child)) {
          out.push({ hook, line, reason: 'conditional' });
          break;
        }
        child = node;
      }
    }

    if (containsOwnReturn(statement)) returnedAlready = true;
  }
}

export function findHookViolations(fileName: string, text: string): HookViolation[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const out: HookViolation[] = [];
  const visit = (node: ts.Node) => {
    if (isFunctionLike(node)) checkFunction(node, source, out);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out.sort((a, b) => a.line - b.line);
}
