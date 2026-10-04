import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { BabelRewriter } from ".";

export function arrowFunctionSingle(): BabelRewriter {
    return (ast, verbose) => {

        var count = 0;
        if (verbose) console.log("starting arrowFunctionSingle");
        traverse(ast, {
            ArrowFunctionExpression(path) {
                const node = path.node;
                const retArg = getSingleReturnBody(node.body);
                if (!retArg) return;
                const { params, async: isAsync } = path.node;
                path.replaceWith(t.arrowFunctionExpression(params, retArg, isAsync));
                count++;
            }
        });

        if (verbose) console.log("finished arrowFunctionSingle by fixing", count, "functions");
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
