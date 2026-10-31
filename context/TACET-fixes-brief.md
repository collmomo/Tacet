# Tacet: the fixes before the branch merges (a brief for the session that built it)

The branch `claude/confident-brown-40csr` (a01edbe, 4 commits on main 3952247) was reviewed on 2026-10-29. The core is close to the manifesto and the tests are green (41 passed, vue-tsc clean, both builds green). It does NOT merge as it is. Fix the points below on the same branch, in this order, each with a test where one is named, then hand back with the numbers.

The truth is main's README.md and DECISIONS.md (the owner's manifesto). The code follows the manifesto; the manifesto is not edited to fit the code. Where the code needs a decision the manifesto does not give, put ONE line under DECISIONS.md "Open" and stop there: the owner decides, never the session.

## 1. The getter check: a library object is NOT a leaf that may change

`src/check.ts` (member, ~line 338; the call branch, ~line 418): anything declared in a `.d.ts` returns "leaf", so a `@live` getter reading `this.date.getTime()`, `this.box.clientWidth` or `this.player.currentTime` passes the build and goes stale. The decided rule (DECISIONS.md, Decided): a `@live` getter may read only what can be followed; a library object held in a marked field is a value, replaced when it changes, and the getter follows the FIELD. So:
- a read or a call on a library object reached through a MARKED field (`@live date`, then `this.date.getTime()`) is fine: the field is followed;
- the same reached through a plain or readonly field that can hold a changing object (`readonly box: HTMLDivElement`, then `this.box.clientWidth`) is a BUILD ERROR naming the read, with the two ways out in the message: mark the field and replace the object, or `as live` on the one property if the owner opens it;
- a frozen value type stays a leaf (string, number, Date methods on a Date reached through a marked field). Keep a short closed list of value containers if one is needed; name it in a one-line comment.
Tests in `tests/check.test.ts`: the Date case, the DOM element case, the marked-field case that passes.

## 2. `ref="view.box"` names a field that must exist

`src/files.ts` (~85-107): `ref="view.bx"` is caught by nothing and makes a new field at runtime. The build checks that the field exists on the view's class and is a plain field (not marked, not readonly, not a getter); a miss is a build error naming the attribute. Test it. Also test "writes only when it differs" (`tests/fixtures/BoxView.ts` has `boxWrites` that no test reads: use it or delete it).

## 3. The `@deep` array proxy

`src/tacet.ts` (~50-80):
- `arr.constructor` answers Object, `String(arr)` answers "[object Array]": the method table (`arrayMethods`) inherits from Object.prototype. Make it a null-prototype object so unknown keys fall through to the real array.
- `items()` copies and wraps the WHOLE array on every `find`, `some`, `every`, `findIndex`, `forEach`...: a find over a million rows walks all of them, which is the cost Tacet exists to avoid. Wrap each item lazily as the callback reaches it (read `inner[i]` through Vue's tracking, `toDeep` on that one item, stop when the callback stops). Add a test with a 1,000,000-row `@deep` array where `find` of the first row touches one item (count the wraps).
- The same for Map/Set iterators if they copy.

## 4. The bench script

`npm run bench` exits 1 "No test files found" (`--dir bench` against the root-relative includes in the vitest config). Make it run. Then put THE OWNER'S measured table back in README.md "What it costs, measured" (35 ms vs 4,964 ms, +0 vs +1,009 MB, 13.5 ns vs 0.9 ns) and add the branch's run as a second line labelled with its box, Node and Vue version. The review box reproduced 8.3 ms vs 1,606 ms (+446 MB) and 1.1 / 14.9 ns a read; it did NOT reproduce "2 ms vs 1,100 ms, five hundred times" or "about nine nanoseconds". Never replace a measured number with one another box cannot reproduce.

## 5. The manifesto text: put the owner's words back, one Open line per change

Revert in README.md and DECISIONS.md, then propose each as ONE line under Open if the session still wants it:
- (a) "This shape is a convention, not a rule... a template may just as well call the view directly" (README "The shape of an app"). Main's rule: the template reads a view and calls its events; `view.events` is what the owner settled last. Put the sentence back as it was on main.
- (b) The `as live` section as a finished feature ("One property of a library's object"). Main keeps `as live` under Open, "to try". The code may stay; the README section goes until the owner closes the item.
- (c) `@live accessor` / `@deep accessor` and the "add a toJSON" advice (README "The marks", line ~27). Main: "Two marks. That is the whole surface on a class." Either the accessor form goes from the runtime, or it becomes one Open line with its cost case (0.08 vs 1.1 µs an instance) and the JSON cost, and the owner picks. Note the branch's own numbers disagree (Open 3 says 0.08 vs 1.1; "Implemented" says 0.35 vs 0.5): measure once, write one number.
- (d) `<script setup>` and `readonly TodoFilter[]` in the owner's example. The README component failed the check on `const filters: TodoFilter[]` (a mutable const array read by the template is an error). Decide the rule for a script-level const: the review's view is that a const the script never writes is a value and needs no readonly; if the session disagrees, one Open line, and the owner's example stays as he wrote it until he decides.
- (e) The measured table: point 4.
- (f) Open items 4-7 of main (script setup, Vue 3.5 vs 3.6, the tag parser, the mistyped tag) were closed by the session. Reopen them with one line each saying what was tried and what the owner has to confirm. "A .tacet file with vapor drives the same view" (README "Why it is useful"): there is no Vapor test in the repo; either add it (skipped unless Vue 3.6 is installed) or say "tried outside the repo, not kept".
- Keep: "The check" and "Running it" sections (they describe the code), the vite.config lines, RESEARCH.md's additions.

## 6. Quality, the owner's conventions (non-negotiable)

- Comments ONE line, always, doc blocks included, only when they state a constraint the code cannot show. The banners at tacet.ts 1-5, 136-141, 151-155, 271-276, 303-307, check.ts 1-7, example TodoEvents.ts 3-7 and every other multi-line block become one line or go.
- Names: a VERB and a FULL NOUN. `markOf`, `virtualFor`, `items`, `distance`, `merge`, `followed`, `lineColumn`, `reachableFrom`, `cachedGetter` renamed (`readMark`, `findVirtualFor`, `wrapItems`, `cacheGetter`...). Never `...Of`.
- No dead code: `tsc --noUnusedParameters --noUnusedLocals` clean (check.ts 154, 332, 488, 508, 534 x2, 870), the `isClassClassMember` alias (check.ts ~658), the branches that return "fixed" either way (~315-317, ~366-367), the no-op line (~502), `boxWrites` (point 2).
- `src/check.ts` reads TypeScript internals (`checkFlags & 8`, ~131-138). Use the public API (`isReadonlySymbol` is not public either: read the declaration's modifiers and `ReadonlyArray`/`Readonly<>` through the type) or state in one line why the internal is the only way and pin the TypeScript version it was checked against.
- Every member explicitly `public` or `private`, fields at the top of the class (check the example and src).

## 7. The package surface

- `src/index.ts` exports `watch`, `toDeep`, `installField`, `installGetter`, `setRef`. The user-facing entry "tacet" exports `live`, `deep` and the `live` type only. The build-time helpers move to a second entry (`tacet/runtime` or inside `tacet/vite`'s output), so the README's "ref()/reactive/computed/watch are gone" stays true at the import line.
- `src/vite.ts` (~55-58) rewrites the user's esbuild settings (every `.js` through esbuild, target es2022) only so decorators work in plain JS. The manifesto's plain-JS form is the COMMENT TAG, not a decorator. Remove the rewrite; if a user wants decorators in `.js`, they set esbuild themselves (one line in "Running it").
- `typescript` is a runtime dependency because the check needs it: fine, but say so in README "Running it"; the library entry `tacet` must not pull it (only `tacet/vite` does). Check with a build of `example/` that `dist/tacet.js` does not bundle TypeScript.
- The MIT licence and CI on every push AND every PR were the session's picks: leave the licence file but note it in DECISIONS.md Open for the owner; CI on push to main and on PRs only.

## Hand-back

The commit list, `npm test` / `npm run check` / `npm run build` / `npm run build:lib` / `npm run bench` results pasted, the lines added under Open, and nothing else changed in the manifesto. Say plainly what you did not do and why.
