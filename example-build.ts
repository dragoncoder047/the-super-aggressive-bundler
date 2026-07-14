import { arrowFunctionRewrite, babelRewrite, bunMinify, classRewrite, hoistAllFunctions, inlineConstantComputedKeys, pipelineBuild, stringDedupe, arrowFunctionSingle } from "the-super-aggressive-bundler";

await pipelineBuild({
    entrypoints: ["./example.ts"],
}, [
    bunMinify(),
    babelRewrite(
        stringDedupe(),
        arrowFunctionRewrite(),
        hoistAllFunctions(),
        arrowFunctionSingle(),
        classRewrite(),
        inlineConstantComputedKeys()),
    bunMinify(),
]);

