import {live} from "../../src";

const shared = {x: 1};
const alias = shared;
alias.x = 2;

export class AliasView {
    @live public get x(): number { return shared.x; }
}
