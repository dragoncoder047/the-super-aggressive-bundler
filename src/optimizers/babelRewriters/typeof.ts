import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { BabelRewriter } from ".";
import { zish } from "../../utils";

export function typeofRewrite(): BabelRewriter {
    const sameTypeName = "__same_typeof" + zish();
    const reflectedName = "__same_typeof_reflected" + zish();
    const reflectDetect = { used: false };
    return (ast, verbose) => {
        var count = 0;
        if (verbose) console.log("starting typeofRewrite");
        traverse(ast, {
            BinaryExpression(path) {
                if (matchesTypeofCheck(path.node)) {
                    count++;
                }
            },
        });
        if (count < 2) {
            if (verbose)
                console.log(
                    "finished typeofRewrite with only",
                    count,
                    "instanceof expressions, nothing was done",
                );
            return ast;
        }
        traverse(ast, {
            BinaryExpression(path) {
                if (matchesTypeofCheck(path.node)) {
                    path.replaceWith(
                        rewriteTypeof(
                            path.node,
                            sameTypeName,
                            reflectedName,
                            reflectDetect,
                        ),
                    );
                }
            },
        });
        // Must happen after to prevent itself from being replaced
        traverse(ast, {
            Program(path) {
                if (reflectDetect.used) {
                    path.unshiftContainer(
                        "body",
                        t.variableDeclaration("var", [
                            t.variableDeclarator(
                                t.identifier(reflectedName),
                                t.arrowFunctionExpression(
                                    [t.identifier("type"), t.identifier("obj")],
                                    t.callExpression(
                                        t.identifier(sameTypeName),
                                        [
                                            t.identifier("obj"),
                                            t.identifier("type"),
                                        ],
                                    ),
                                ),
                            ),
                        ]),
                    );
                }
                path.unshiftContainer(
                    "body",
                    t.variableDeclaration("var", [
                        t.variableDeclarator(
                            t.identifier(sameTypeName),
                            t.arrowFunctionExpression(
                                [t.identifier("obj"), t.identifier("type")],
                                t.binaryExpression(
                                    "===",
                                    t.unaryExpression(
                                        "typeof",
                                        t.identifier("obj"),
                                    ),
                                    t.identifier("type"),
                                ),
                            ),
                        ),
                    ]),
                );
            },
        });

        if (verbose)
            console.log(
                "finished typeofRewrite by rewriting",
                count,
                "typeof checks as a function call",
            );
        return ast;
    };
}

function matchesTypeofCheck(node: t.BinaryExpression) {
    return (
        (node.operator === "===" || node.operator === "!==") &&
        ((t.isUnaryExpression(node.left) && node.left.operator === "typeof") ||
            (t.isUnaryExpression(node.right) &&
                node.right.operator === "typeof"))
    );
}

function rewriteTypeof(
    node: t.BinaryExpression,
    name: string,
    rName: string,
    reflected: { used: boolean },
): t.Expression {
    const { left, right, operator } = node;
    var out: t.Expression;
    if (t.isUnaryExpression(left) && left.operator === "typeof") {
        out = t.callExpression(t.identifier(name), [left.argument, right]);
    } else if (t.isUnaryExpression(right) && right.operator === "typeof") {
        out = t.callExpression(t.identifier(rName), [
            left as t.Expression,
            right.argument,
        ]);
    } else throw new Error("unreachable");
    if (operator === "!==") {
        out = t.unaryExpression("!", out);
    }
    return out;
}
