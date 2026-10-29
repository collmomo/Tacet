/** The price of a mark: one read and one instance for a plain field, a @live field and a tagged field; run with npm run bench. */
import {shallowRef} from "vue";
import {live} from "../src";
import {TagField} from "./TagField";

const READS = 20_000_000;
const MAKES = 200_000;

class Plain { public n = 1; }
class Field { @live public n = 1; }

function reads(name: string, make: () => {n: number}): void {
    const instance = make();
    let sum = 0;
    const start = performance.now();
    for (let i = 0; i < READS; i++) sum += instance.n;
    const ns = ((performance.now() - start) * 1e6) / READS;
    const t = performance.now();
    for (let i = 0; i < MAKES; i++) make();
    const us = ((performance.now() - t) * 1e3) / MAKES;
    console.log(`${name.padEnd(42)} one read ${ns.toFixed(1)} ns   making one instance ${us.toFixed(2)} µs   (${sum})`);
}

function refsAlone(): void {
    const t = performance.now();
    for (let i = 0; i < MAKES; i++) shallowRef(i);
    console.log(`${"a Vue shallowRef alone".padEnd(42)} ${"".padEnd(17)}   making one ${(((performance.now() - t) * 1e3) / MAKES).toFixed(2)} µs`);
}

export function run(): void {
    for (let round = 0; round < 2; round++) {
        refsAlone();
        reads("plain field", () => new Plain());
        reads("@live field (getter on the instance)", () => new Field());
        reads("/** @live */ field (the tag, same getter)", () => new TagField());
    }
}

if (!process.env.VITEST) run();
