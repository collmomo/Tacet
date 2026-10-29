import ts from "typescript";

export type MarkName = "live" | "deep";

function readMarkName(name: string): MarkName | undefined {
    return name === "live" || name === "deep" ? name : undefined;
}

export function readDecoratorMark(member: ts.Node): MarkName | undefined {
    if (!ts.canHaveDecorators(member)) return undefined;
    for (const decorator of ts.getDecorators(member) ?? []) {
        const expression = decorator.expression;
        const name = ts.isIdentifier(expression) ? expression.text : ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) ? expression.expression.text : "";
        const mark = readMarkName(name);
        if (mark !== undefined) return mark;
    }
    return undefined;
}

export function readTagMark(member: ts.Node): MarkName | undefined {
    for (const tag of ts.getJSDocTags(member)) {
        const mark = readMarkName(tag.tagName.text);
        if (mark !== undefined) return mark;
    }
    return undefined;
}

export function readMark(member: ts.Node): MarkName | undefined {
    return readDecoratorMark(member) ?? readTagMark(member);
}

export function findScriptOpening(source: string, contentOffset: number): number {
    return source.lastIndexOf("<script", contentOffset);
}

export function promoteScriptToSetup(source: string, contentOffset: number): string {
    const after = findScriptOpening(source, contentOffset) + "<script".length;
    return source.slice(0, after) + " setup" + source.slice(after);
}
