# Research

Two questions, asked on 2026-10-29. Does this exist already? And what do we draw the screen with?

Everything below was checked against the projects' own code, docs and npm dates on that day. Where a claim comes from a run, the run is in the prototype.

## The prototype

Path: `/tmp/claude-0/-home-user/981683f0-6055-5711-bfbe-976687a8cc4d/scratchpad/tacet/` (a scratch folder, not in this repo).

- Vue 3.5.22, Vite 7, Vitest 3, TypeScript 5.8, standard decorators (no `experimentalDecorators`).
- `src/tacet.ts` (60 lines): `@live` (on a field or a getter), `@deep`, and the one function both forms share, `installField`.
- `src/tacetTags.ts` (45 lines): the comment-tag form, a Vite plugin.
- `src/tacetRefs.ts` (24 lines): the `.tacet` template step that makes `ref="view.attachCanvas"` call the method.
- The todo view four ways: decorators in TS, tags in TS, tags in plain JS, decorators in plain JS. One test file drives all four with no browser.
- `src/Todo.vue` and `src/Todo.tacet`: the same component, the script one line.
- `npm test`: 34 tests pass. `npx vue-tsc --noEmit`: clean, templates included.
- A second copy on Vue 3.6.0-rc.13 with Vapor: `.../scratchpad/tacet-vapor/`. 26 tests pass there.

How a mark works. The decorator asks to run right after its field is defined. At that moment it reads the value, puts it in a Vue `shallowRef`, and replaces the field with a getter and a setter on the instance. The setter compares with `Object.is` and returns if nothing changed. Then it calls `markRaw` on the instance, so Vue never wraps it.

The comment tag does the same at the same moment. The plugin adds a private field right after the tagged one: `#__tacet0 = __tacet.installField(this, "draft", "live");`. Fields run in order, so this runs right after `draft` is defined. A tagged getter gets a `static { }` block that wraps it once in a Vue `computed`. All of this is plain ES2022: no decorator support needed anywhere.

## The numbers

**1. The redraw cost.** A view holds a plain array of 1,000,000 slot objects under an unmarked field. One `@live count`. Two templates: one reads only the count, one calls a method that walks the layout. Arm A: the Tacet view, raw. Arm B: the same class with no mark, handed in as `reactive(view)`, which is what Vue does to anything in a store. Vue dev build, jsdom, Node 22, median of 10 redraws.

| Template | Arm | Mount | One redraw | Heap after mount | A write into the layout redraws? |
|---|---|---|---|---|---|
| reads the count | Tacet | 11.7 ms | 0.31 ms | +0 MB | no |
| reads the count | reactive(view) | 1.4 ms | 0.06 ms | +0 MB | no |
| walks the layout | Tacet | 45 ms | 35 ms | +0 MB | no |
| walks the layout | reactive(view) | 6,479 ms | 4,964 ms | +1,009 MB | yes |

What this says, plainly:
- `reactive()` costs nothing until something walks through it. Vue wraps lazily.
- The moment one reader walks the big thing through the wrapper, every redraw costs 5 seconds and a gigabyte. That is the grouping lag. Tacet's redraw is 140 times cheaper, because the walk reads plain data.
- With Tacet, a write into the unmarked layout does not redraw. That is the rule working: nothing walked unless marked.
- A side finding: `@vue/test-utils`' `mount` walks the props it is given. With the wrapped view, mounting the count-only template took 6.6 s and 66 MB, against 0.5 s raw. Any tool that walks what it is handed will find the big thing through the wrapper.

Run: `BENCH=1 npx vitest run bench/redraw.test.ts --pool=forks --poolOptions.forks.execArgv=--expose-gc`.

**2. The price of a mark** (`npx vite-node bench/read.ts`, 20 million reads):

| | One read | Making one instance (one field) |
|---|---|---|
| plain field | 0.9 ns | 0.02 µs |
| `@live` (getter put on the instance) | 13.5 ns | 1.11 µs |
| getter on the prototype (what `accessor` or our plugin could write) | 14.1 ns | 0.08 µs |

Reading costs the same either way: the tracking is the cost. Making an instance is 14 times dearer with the getter put on each instance. A few views do not care. A million entities would pay 1.1 s.

**3. The comment-tag build step.** Loading the TypeScript parser: 575 ms, once per build. A tagged file: 1.9 ms for the todo view, 27.6 ms for vSheet's `DealView.ts` (1,916 lines). A file with no tag: 0.024 ms (a text check skips it).

**4. Output size** of the plain-JS todo view, same Vite build for both: decorators 4.51 kB (1.94 kB gzip), tags 1.85 kB (0.82 kB gzip). The difference is the helper code the compiler writes to run decorators, once per bundle.

## What works and what does not

Works, each one a test:
- One public method per action drives the view; the test needs no browser.
- A write of the same value notifies nobody.
- A `@live` getter re-runs only when a marked field it read changed.
- `reactive(view)` returns the view itself; so does a view put inside a reactive object.
- A write in the constructor body goes through the setter. A field that reads an earlier marked field sees its value.
- A subclass adds its own marks.
- A marked class inside a `@deep` list is left raw.
- The same view drives a Vapor component on Vue 3.6.0-rc.13, unchanged.
- A `.tacet` file compiles with no plugin of ours: one option, `vue({include: [/\.vue$/, /\.tacet$/]})`. Type-checking needs one tsconfig line, `"vueCompilerOptions": {"extensions": [".vue", ".tacet"]}`: `vue-tsc` then caught a typo in a `.tacet` template. The editor needs one line, `"files.associations": {"*.tacet": "vue"}` (VS Code; not tried in an editor here).

Does not work, or needs a rule (each one a test):
- An array under `@live`: `push` is silent. Replacing the array notifies. This is what shallow means.
- A class with no mark inside `@deep` is walked like Vue today. Its big fields too.
- A class with ONE mark inside `@deep` becomes raw. Its unmarked fields stop updating the screen.
- A `@live` getter that reads a plain field returns the old value forever: the cache only knows the marked fields. A getter with no mark is always right: it is live through the marked fields it reads, it just re-runs on each read.
- Devtools: not tried. There is no browser devtools in this box. The view is a plain object whose marked fields are getters; whether the Vue devtools panel shows their values has to be seen in a browser.

## A DOM element reaching a view

The decided form: `<canvas ref="view.attachCanvas">`, the method gets the element when it is drawn and `null` when it is removed. What Vue does with it, tested in `tests/functionRef.test.ts`:

- `ref="view.attachCanvas"` as Vue reads it: a plain NAME, not code. The method is never called and nothing warns.
- `:ref="view.attachCanvas"`: Vue calls the function with no `this`. It throws `TypeError` inside the method.
- `:ref="el => view.attachCanvas(el)"`: works. The element on mount, `null` on unmount.
- `@click="view.countClick"` keeps its `this`: Vue's compiler wraps a dotted path in an event into a call. It does not do that for `ref`.
- Vue calls a function ref AGAIN on every redraw of its element, with the same element, even when the function is the same one. So `attachCanvas` must compare first, like every setter.
- The one way: write `ref="view.attachCanvas"` in a `.tacet` file and let the `.tacet` step rewrite it to `:ref="el => view.attachCanvas(el)"`. That step is `src/tacetRefs.ts`, 24 lines, a template transform handed to Vue's compiler for `.tacet` files only (a second `vue()` entry with `include: /\.tacet$/`). It works: element on mount, `null` on unmount, no error.
- One type note: Vue types a function ref's argument as `Element | ComponentPublicInstance | null`, so the method's parameter must accept that (or `unknown`).

## Decorators and the class field setting

Standard decorators cannot turn a field into an accessor; only the `accessor` keyword does that (Lit, MobX and signal-utils all require it). Tacet does not need it. The TC39 text says a field decorator's extra setup runs "immediately after the field or accessor that they were applied to is initialized". So the decorator replaces the field after it exists.

Tried in every combination:
- `tsc` and esbuild, `useDefineForClassFields` true and false, target ES2022 and ES2020: all eight install the getter, and a constructor write goes through the setter.
- Babel's decorator plugin: version `"2023-11"` works. `"2023-05"` runs the setup before the field exists: the field stays plain, with no error. `"2022-03"` throws.
- Vite does not compile decorators in `.js` files by default (esbuild skips `.js`). It needs `esbuild: {include: /\.(m?ts|js)$/, exclude: [], target: "es2022"}`.
- Ember does exactly this trick for `@tracked` on a plain field (`tracked.ts`, the `'field'` case: `addInitializer`, then `Object.defineProperty`).

## Browsers and decorators

No browser runs decorators, and none plans to soon.
- Node 22 loading the decorated plain-JS file: `SyntaxError`. The tagged file loads and runs, with plain fields.
- TC39, 2026-05-19: "Decorators moved back to Stage 2.7". SpiderMonkey: "no plans to start that work unless another engine ships first". V8: "the implementation is halted until issues are resolved". JavaScriptCore: "We don't plan on resuming it until some other implementation ships." Apple added it might be better as a compile-only layer. ([notes](https://github.com/tc39/notes/blob/HEAD/meetings/2026-05/may-19.md#decorators-for-stage-27), [proposals table](https://github.com/tc39/proposals), the proposal README changed to "Stage: 2.7" on 2026-06-20.)
- [caniuse](https://caniuse.com/decorators) lists none.

So a decorator is build-only syntax, like a type. TypeScript, esbuild and Babel compile it today, and Ember, MobX and Lit rely on that.

## Decorators or comment tags

| | `@live draft = ""` | `/** @live */ draft = ""` |
|---|---|---|
| Build step | the compiler that already runs (esbuild for `.ts`); `.js` needs the include line above; Babel needs `"2023-11"` | our plugin, 45 lines, before every other step |
| Build cost | none extra | 575 ms once, 2 to 28 ms per tagged file |
| Loaded raw, no build | `SyntaxError` everywhere | runs, fields plain, the screen never updates, no error |
| TypeScript | a typo in the mark is an error | the checker ignores the tag; a typo is silent unless the plugin warns |
| Plain JS editor | an unknown `@` | a doc comment; nothing to set up |
| Minifiers | not affected | not affected: the plugin reads the source first; a library published already minified loses its tags |
| Output | 4.51 kB for the todo | 1.85 kB for the todo |
| Making an instance | 1.1 µs per field (getter on each instance) | the same today; the plugin owns the output, so it can write the 0.08 µs prototype getter |
| Depends on | a proposal that just moved back | nothing outside our 45 lines |

My pick for ONE surface: the comment tags. They work the same in TypeScript and in JavaScript with no flag and no version to choose. They depend on nothing that can move under us. Our plugin writes the output, so it can write the cheap prototype getter. The price: the plugin is part of every build and every test run (Vitest runs it), and a mistyped tag needs a warning from the plugin. Decorators can come back later as sugar: both forms call the same `installField`.

## Question 1: does this exist already?

Tacet's four rules: (1) reactivity by a mark on a plain class field, opt-in, compare before write; (2) the view is a class with one public method per user action; (3) the template is a projection that reads the view and calls it; (4) the one-file layout (template, script, style) kept.

| Project | Activity | (1) marks on plain fields | (2) view = class, one method per action | (3) template a projection | (4) one file |
|---|---|---|---|---|---|
| **Ember Octane** `@tracked` | ember-source 7.4.0, 2026-10-28 | YES, on any class. Same field trick. But a bare `@tracked` writes even an unchanged value: compare is opt-in, `@tracked({equals})`. `@cached` getters opt-in. `push` not seen: tracked collections | partly: components are classes that extend `Component`, methods marked `@action` | yes | `.gjs` puts the template inside the class; no style block |
| **MobX** | mobx 7.1.3, 2026-10-27 | `@observable` is DEEP by default, `observable.ref` shallow; compares by default; standard decorators need `accessor` | yes (store classes with actions) | needs a bridge: mobx-vue is Vue 2 only (2022), mobx-vue-lite 0.4.3 (2024-08) | no, React-first |
| **Svelte 5** runes | svelte 5.57.3, 2026-10-26 | `done = $state(false)` in a class: "Class instances are not proxied". But `$state` is deep for arrays and objects, `$state.raw` shallow. Compares (`===`). A call, not a mark, only in `.svelte`/`.svelte.js` files | yes | templates may write (`bind:`) | yes, its own `.svelte` |
| **Angular** signals | @angular/core 22.2.4, 2026-10-29 | `count = signal(0)` on a component class, `Object.is` compare; calls, read as `count()` | the component IS the class | yes | template and style in the decorator or other files |
| **Lit** | lit 3.3.3, 2026-05-14 | `@property` / `@state` decorators, compare before update. Must extend `LitElement`. Standard decorators need `accessor`; Lit still recommends the old flag | the element is the class | `render()` in the class | no |
| **signal-utils** (TC39 Signals helpers) | 0.21.1, 2024-12 | `@signal accessor x`; no renderer | n/a | n/a | n/a |
| **Knockout** + knockout-es5 | knockout 3.5.3 (2026-03); es5 plugin 2016 | `ko.track(this, {fields: [...]})` turns fields into accessors: our "list the names" idea, 2013 | YES: the view model with methods, MVVM's origin | `data-bind` reads the model | no |
| **ivue** | 2.6.0, 2026-09 | plain classes on Vue's reactivity, but wrapped by `Reactive(Class)` and state as getters returning `ref()`: everything reactive | yes | Vue templates | Vue's |
| **vue-class-component**, **vue-property-decorator** | DEPRECATED (their READMEs); last pushes 2023 | every field becomes deep reactive data | the component is the class | Vue | Vue's |
| **vue-facing-decorator** | 4.0.1, 2025-05 | the same model as above; README warns it fights "modern vue build tools" | the component is the class | Vue | advises `.tsx` |
| **Solid** | solid-js 1.9.17, 2026-10-27 | signals and stores, no classes | no | JSX | no |
| **Qwik** | 1.20.3 / 2.0.0-rc.4, 2026-10 | `useSignal`, `useStore` (deep) | no | JSX | no |
| **Marko 6** | 6.4.6, 2026-10 | `<let>` tags compiled fine-grained | no | yes | yes, `.marko` |
| **Mithril** | 2.3.8, 2026-08 | no marks at all: redraws everything after each event | plain objects and methods, yes | yes | no |
| **Alpine** | 3.17.5, 2026-10 | `x-data` objects, deep, built ON `@vue/reactivity` | no | in HTML attributes | no |

The class-component libraries died for one reason: they made the component the class, and every field deep data. Vue's own notice: "It is no longer recommend to use Class-based components in Vue 3." Tacet keeps the class away from the component: the component holds a view, it is not one.

### The verdict

- Ember Octane is the closest. Marks on plain class fields, the same field trick, a cached-getter mark, the warning that `push` is not seen. It differs in three ways: no compare by default, the component is a class that extends a base, and it is Ember's whole world, not Vue's one-file components.
- Svelte 5 is the second closest: class instances are not proxied, fields are marked one by one, one-file components. But the marks are compiler calls, arrays default to deep, and templates may write.
- Not new in Tacet: marks on fields, shallow by default (`$state.raw`, `observable.ref`), compare before write (MobX, Angular, Svelte), cached getters (`@cached`, `computed`), view models with methods (Knockout, 2010).
- New in Tacet: the combination on Vue's one-file components, with nothing walked unless marked as THE default, and the compare as the default. And the view as the list of user actions: one public method per action, so a test, a script and a chat model's tool list (vSheet's `WorkbookTools.ts`) all call what the button calls. No project in this table names that as its point. It comes free from the shape.

## Question 2: the renderer

The owner's thought: start by taking Vue's rendering engine and adapting it. Vue's layout (MIT licence), `main` at 3.5.44, `minor` at 3.6.0-rc.13, lines of source without tests:

| Package | 3.5 | 3.6 rc |
|---|---|---|
| reactivity | 3,963 | 4,014 (rebuilt on alien-signals) |
| runtime-core | 21,166 | 23,465 |
| runtime-dom | 5,183 | 5,494 |
| compiler-core / compiler-dom / compiler-sfc | 11,093 / 1,432 / 8,539 | 11,296 / 1,472 / 8,910 |
| compiler-vapor / runtime-vapor | none | 12,694 / 23,354 |

How runtime-core leans on reactivity: 25 of its files import 33 runtime functions from `@vue/reactivity`. The most used: `pauseTracking` and `resetTracking` (7 files), `toRaw` (7), `isRef` (6), `shallowReadonly` (5), `track` / `trigger` (3). The renderer's own update loop is a `ReactiveEffect`. Props are a `shallowReactive`. What `setup` returns goes through `proxyRefs`. `watch` lives in the reactivity package since 3.5. runtime-dom, server-renderer and compiler-sfc import none of it directly.

### (a) A library on Vue

What the prototype is. The marks are Vue `shallowRef`s behind a getter and setter, `@deep` is `reactive()`, a `@live` getter is `computed()`, the instance is `markRaw`. The compiler, the renderer, the devtools hook, Transition, Suspense, slots and the editor tooling are Vue's, untouched.
- Cost: the prototype took an afternoon; a release is about a week with docs and tests.
- Risk: low. Six public Vue functions. It ran unchanged on 3.5 and on 3.6 Vapor.
- What it cannot do: stop Vue from walking an UNMARKED class inside `@deep`. That stays a rule people follow.

### (b) A fork of runtime-core with Tacet's own reactivity

- The surface to rewrite: those 33 functions, with the same behavior, across 25 files. The update loop, the props, the scheduler and `watch` all sit on them.
- Then we own a 21,000-line fork. Vue shipped 44 patch releases of 3.5, and 3.6 rebuilt reactivity entirely. Each one would have to be carried over by hand.
- What breaks: every outside component that calls `ref` or `reactive` (its data would live in a reactivity the renderer does not follow, so it never redraws); the devtools; Transition, KeepAlive and Suspense, which run on effects; server rendering, which runs runtime-core.
- What it buys: nothing (a) does not already give. The marks are a layer over refs; they do not need a different engine underneath.

### (c) A renderer of our own, compiled from the one-file template

- The size, from those who did it: Solid's runtime 4,666 + store 1,096 + web 271 + dom-expressions runtime 2,454 + its compiler 4,228: about 12,700 lines, with JSX instead of templates. Svelte: a 40,168-line compiler and a 16,099-line client runtime. Vue's own Vapor: 12,694 + 23,354 lines, about two years of Vue's team, and still a release candidate (rc.13, 2026-10-23).
- On top of that: slots, Transition, Teleport, KeepAlive, hydration, devtools, and type-checked templates in the editor.
- And Vapor IS path (c), already built: no virtual DOM, compiled from the same one-file template, on Vue's own reactivity. The Tacet todo view drove a `<script setup vapor>` component with no change.

### Recommendation

Take (a). Tacet is a small library on Vue, not a fork. The renderer is borrowed whole, not adapted. When Vue 3.6 is stable, a component that needs speed adds `vapor` to its script tag: that is path (c), done by Vue, for free. Do not fork (b): it costs a full-time job to keep up, breaks every outside component, and gives nothing the marks need. Do not build (c): Vue just did.

## Sources

- TC39 notes, 2026-05-19: https://github.com/tc39/notes/blob/HEAD/meetings/2026-05/may-19.md#decorators-for-stage-27
- TC39 proposals table: https://github.com/tc39/proposals ; the decorators README: https://github.com/tc39/proposal-decorators
- caniuse, decorators: https://caniuse.com/decorators
- Ember `tracked.ts`: https://github.com/emberjs/ember.js/blob/main/packages/@ember/-internals/metal/lib/tracked.ts ; the autotracking guide: https://guides.emberjs.com/release/in-depth-topics/autotracking-in-depth/
- Svelte `$state`: https://svelte.dev/docs/svelte/$state
- MobX decorators: https://mobx.js.org/enabling-decorators.html ; mobx-vue: https://github.com/mobxjs/mobx-vue
- Lit decorators: https://lit.dev/docs/components/decorators/
- Angular signals: https://angular.dev/guide/signals
- signal-utils: https://github.com/proposal-signals/signal-utils ; knockout-es5: https://github.com/SteveSanderson/knockout-es5
- vue-class-component: https://github.com/vuejs/vue-class-component ; vue-property-decorator: https://github.com/kaorun343/vue-property-decorator ; vue-facing-decorator: https://github.com/facing-dev/vue-facing-decorator ; ivue: https://www.npmjs.com/package/ivue
- Vue core (`main`, `minor`): https://github.com/vuejs/core ; Solid: https://github.com/solidjs/solid ; dom-expressions: https://github.com/ryansolid/dom-expressions ; Svelte: https://github.com/sveltejs/svelte
- npm versions and dates: `npm view <package> version time.modified`, 2026-10-29.
