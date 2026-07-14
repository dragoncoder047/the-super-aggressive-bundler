import { arrowFunctionRewrite, babelRewrite, bunMinify, classRewrite, hoistAllFunctions, inlineConstantComputedKeys, pipelineBuild, stringDedupe } from ".";

await pipelineBuild({
    entrypoints: ["./example.ts"],
}, [
    babelRewrite(
        stringDedupe(),
        arrowFunctionRewrite(),
        hoistAllFunctions(),
        classRewrite(),
        inlineConstantComputedKeys()),
    bunMinify()
]);

