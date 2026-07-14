import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { BabelRewriter } from ".";

export function arrowFunctionSingle(): BabelRewriter {
    return ast => {

        traverse(ast, {
            ArrowFunctionExpression(path) {
                const node = path.node;
                const retArg = getSingleReturnBody(node.body);
                if (!retArg) return;
                const { params, async: isAsync } = path.node;
                path.replaceWith(t.arrowFunctionExpression(params, retArg, isAsync));
            }
        });

        return ast;
    }
}

function getSingleReturnBody(body: t.BlockStatement | t.Expression): t.Expression | null {
    if (!t.isBlockStatement(body)) return null;
    if (body.body.length !== 1) return null;
    const stmt = body.body[0];
    if (!t.isReturnStatement(stmt) || !stmt.argument) return null;
    return stmt.argument;
}
