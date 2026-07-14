import traverse, { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { BabelRewriter } from ".";

export function arrowFunctionRewrite(): BabelRewriter {
    return ast => {

        traverse(ast, {
            FunctionDeclaration(path) {
                if (!canConvertFunctionDeclaration(path)) return;
                const { id, params, body, async: isAsync } = path.node;
                const arrow = t.arrowFunctionExpression(params, body, isAsync);
                const decl = t.variableDeclaration("var", [t.variableDeclarator(id!, arrow)]);
                // Hoist to top
                path.remove();
                (path.findParent(p => p.isBlockStatement() || p.isProgram()) as NodePath<t.BlockStatement | t.Program>).unshiftContainer("body", decl);
            },
            FunctionExpression(path) {
                if (!canConvertFunctionExpression(path)) return;
                const { params, body, async: isAsync } = path.node;
                const arrow = t.arrowFunctionExpression(params, body, isAsync);
                path.replaceWith(arrow);
            },
            ClassMethod(path) {
                const node = path.node;
                if (node.kind !== "method") return;
                if (node.generator) return;

                const retArg = getSingleReturnBody(node.body);
                if (!retArg) return;

                const { params, async: isAsync, computed, static: isStatic, key, decorators } = node;

                const arrow = t.arrowFunctionExpression(params as t.FunctionParameter[], retArg, isAsync);

                // public method -> public field, private method -> private field
                var newProp: t.ClassProperty | t.ClassPrivateProperty
                if (t.isPrivateName(key)) {
                    newProp = t.classPrivateProperty(key, arrow, null, isStatic)
                    newProp.decorators = decorators;
                } else {
                    newProp = t.classProperty(key, arrow, null, decorators, computed, isStatic)
                }

                path.replaceWith(newProp);
            }
        })

        return ast;
    }
}

function getSingleReturnBody(body: t.BlockStatement | t.Expression): t.Expression | null {
    if (!t.isBlockStatement(body)) return null;
    if (body.body.length !== 1) return null;
    const stmt = body.body[0];
    if (!t.isReturnStatement(stmt) || !stmt.argument) return null;
    return stmt.argument;
};

function canConvertFunctionDeclaration(path: NodePath<t.FunctionDeclaration>): boolean {
    const node = path.node;
    if (node.generator) return false;
    if (hasUnsafeThis(path)) return false;
    return true;
}

function canConvertFunctionExpression(path: NodePath<t.FunctionExpression>): boolean {
    const node = path.node;
    if (node.generator) return false;
    if (hasUnsafeThis(path)) return false;
    // named function expression: (function foo() { return foo }) -> (() => foo) would bind outer foo
    if (node.id) {
        const innerBinding = path.scope.getBinding(node.id.name);
        // innerBinding is the function expression's own name, visible only inside
        // if there is a reference inside that resolves to innerBinding, we can't convert
        var usesOwnName = false;
        path.traverse({
            Identifier(inner) {
                if (inner.node.name === node.id!.name && inner.scope.getBinding(node.id!.name) === innerBinding
                    // ignore the declaration itself
                    && inner.node !== node.id) usesOwnName = true;
            }
        })
        if (usesOwnName) return false;
    }
    return true;
}

function hasUnsafeThis(funcPath: NodePath<any>): boolean {
    var unsafe = false;
    funcPath.traverse({
        FunctionExpression(path) {
            // Don't recurse into inner "function" functions
            path.skip();
        },
        "ThisExpression|Super"() {
            unsafe = true;
        },
        MetaProperty(path) {
            if (path.node.meta.name === "new" && path.node.property.name === "target") unsafe = true;
        },
        Identifier(path) {
            if (path.node.name === "arguments" && !path.scope.hasBinding("arguments")) unsafe = true;
        }
    })
    return unsafe;
}

