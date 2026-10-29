import {it} from "vitest";
import {run} from "./read";

it.skipIf(!process.env.BENCH)("the price of a mark", () => { run(); });
