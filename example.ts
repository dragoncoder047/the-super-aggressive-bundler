
const a = Math.random();
const b = Math.random();

export function main(x: any) {
    console.log("flags1", x, innerCannotBeHoisted(flags1));
    function innerCannotBeHoisted(x: any[]) {
        x.forEach(i => i.length ? innerCannotBeHoisted(i) : null);
        return x;
    }
}

export function canBeRewrittenAsArrow(a: any, b: any, c: any) {
    main(a);
    console.log(b, c, function (this: any) { return this.f });
}

export function cannotBeRewrittenAsArrow1(this: any, a: any, b: any, c: any) {
    this.something(a);
    console.log(b, c);
}
export function cannotBeRewrittenAsArrow2(this: any, a: any, b: any, c: any) {
    main(a);
    console.log(b, c, () => this.f);
}

export class TheClass {
    bar = 1;
    methodThatUsesThis() {
        return this.bar;
    }
    methodThatDoesNotUseThis() {
        return 1;
    }
}

enum Foo {
    bar, baz
}

export const x = { [Foo.bar]: 1, [Foo.baz]: 2, ["hi"]: 3 };

export const str1 = String.raw`foo${a}bar${b}bam`;
export const str2 = `foo${a}bar${b}bam`;
export const flags1 = ["default", "default", "default", "default", "default", "default", "inherit", "default", "default", "inherit", "inherit", "inherit"];
export const flags2 = ["foo", "bar", "foo", "bam", "foo", "bar", "foo", "bam"];
