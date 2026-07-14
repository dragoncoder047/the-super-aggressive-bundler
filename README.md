# the-super-aggressive-bundler

collection of javascript/typescript transformers to do more aggressive optimizations of your bundle using Bun.

source maps are preserved, and chained using [@ampproject/remapping](https://www.npmjs.com/package/@ampproject/remapping) or Babel, so the transformations don't show up in the source map.

## general API

the main entry point is `pipelineBuild()` - it takes 2 options, the first one is your standard `Bun.build()` options minus `format` and `sourcemap` (`format` is forced to `"esm"` and `sourcemap` is forced to `"external"`). the second argument is an array of optimizers, which will be applied in order to each output javascript file. css, html, etc. are not touched.

most of the optimizers are Babel AST transformations, so they might need to be wrapped in `babelRewrite()` to make it a transformer to fit in `pipelineBuild()`. if there are multiple consecutive Babel transforms, you can put them all in the same `babelRewrite()` to save having to stringify and re-parse on each transform.

## available optimizers

### bunMinify

just minifies the output again using Bun - useful to be used after other optimizers.

### classRewrite

rewrites `class A {}` into `var A = class {}` to get around [this Bun bug](https://github.com/oven-sh/bun/issues/32652)

### inlineConstantComputedKeys

workaround for [this Bun bug](https://github.com/oven-sh/bun/issues/29487). rewrites `{ [X]: Y }` into `{ X: Y }` when X is a constant (number or string literal).

### stringDedupe

replaces all strings with a variable reference to the string, so the string only has to be written once.

consider this simple file:

```ts
console.log("default", "default", "default", "default", "default", "default", "inherit", "default", "default", "inherit", "inherit", "inherit");
```

with standard minification it can be minified to:

```js
console.log("default","default","default","default","default","default","inherit","default","default","inherit","inherit","inherit");
```

but with this plugin, it minifies to:

```js
var x="inherit",p="default";console.log(p,p,p,p,p,p,x,p,p,x,x,x);
```

and the more times the string is repeated, the better minification you get!

## arrowFunctionRewrite

this rewrites all your `function` functions as arrow functions wherever possible (i.e. when their bodies don't use their own name, `this`, `super`, `arguments`, or `new.target`) and then hoists them to the top if it was a declaration (preserving the normal javascript weirdness). class methods are included.
