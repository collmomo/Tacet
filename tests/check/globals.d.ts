interface Object {
    fillAll(this: {x: number[]}): void;
}

interface Array<T> {
    fillAll(this: {x: number[]}): void;
}

interface Api {
    format(this: void, n: number): string;
}

declare const api: Api;
