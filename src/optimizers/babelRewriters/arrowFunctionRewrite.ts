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
        })

        return ast;
    }
}

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

