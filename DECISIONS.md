# Decisions

## Decided (the owner, 2026-10-29)

- Components are `.tacet` files: template, script, style, compiled by Vue's compiler (one `include` option, one tsconfig line, one editor line).
- Kept from Vue: the template syntax, props (a parent hands a component its view or object), the lifecycle hooks (`onMounted` and its family).
- Gone: `ref`, `reactive`, `computed`, `watch`, `watchEffect`, `provide`, `inject`, stores, `emit`.
- The marks are `@live` (shallow, compares before writing) and `@deep`. No base class, no call to make things live.
- Written for TypeScript with the owner's conventions; plain JavaScript works through the comment tags.
- A getter is cached only when marked `@live`: it follows what it reads and keeps its result until one of them changes. An unmarked getter is a plain getter. Methods never need a mark. (A `@live` getter must read only marked fields: one that reads a plain field keeps its old value, tested.)
- A DOM element reaches a view through `ref="view.box"` on a plain field: the `.tacet` build assigns the element on mount and `null` on unmount, writing only when it differs; no method form (the owner, 2026-10-29); something to do on arrival is the component's `onMounted`.

- A template never writes a field: a change goes through a method of the view (`view.typeDraft(...)`), the same method a test or a tool would call (the README's todo app does so).

- The marks are DECORATORS, `@live` and `@deep`, as the README shows them: the `.tacet` build compiles them (TypeScript 5's standard decorators, no flag) so nothing waits on the browsers. The comment tag `/** @live */` is the same mark spelled for plain JavaScript, one runtime under both (the owner, 2026-10-29).

- `@live` tracks assignment, `@deep` tracks mutation: a push under `@live` tells no one; under `@deep` it does (the owner, 2026-10-30).
- A `@live` getter may read only marked fields, checked by the build hop by hop through the types (`this.a.b.c`: a mark on each hop's class, or a plain object under a `@deep` field); a `readonly` hop is fixed and needs no mark; a plain or unknowable hop that can change is a BUILD ERROR naming the hop, never a stale value (the owner, 2026-10-30: "compilation problems seem like a good idea").
- `@deep` stops at a class instance: it walks plain objects and arrays, never enters a class; a class's surface is its own marks only, so one mark never changes another field's behaviour (the owner, 2026-10-30).
- A `@live` getter that reads an unmarked field keeping its old value "by design" is withdrawn: it is the build error above.

- A class with no marks at all (a library's: a Date, a DateRange, a chart) is a VALUE: it is held in a marked field and replaced when it changes; a path into it ends at that field (a leaf for the getter check); its own mutations tell no one. A library's plain containers (Map, Set, array) under `@deep` are tracked like plain data. A library object that changes itself (a socket, a chart instance) lives in a plain field and the view copies what the screen needs into marked fields when it calls back (the owner, 2026-10-30).

- A `@live` getter's reads are checked through every call the build can resolve to a body it can see (the class's own methods, the module's functions, an arrow function inside it); a call it cannot see through (a method on an interface, a function passed by reference, a library's method on an object that can change) is a build error naming the call. The marked reads are tracked at run time wherever they happen; the build hunts only the plain ones (the owner, 2026-10-30: refusing `this.calculateTotal()` would force the body into the getter).

- The template is checked like a getter: every `view.x` a template reads is compared with the marks by the build; a plain field that can change is a build error, a marked field no template reads a hint (the owner, 2026-10-30).

## Implemented (2026-10-29, the first implementation; the owner's to confirm)

- The runtime is a small library on Vue 3.5 (research path (a)): `shallowRef` behind a getter and a setter, `computed` for a `@live` getter, `markRaw` on the instance. `@deep` is Tacet's own thin proxy over Vue's `shallowReactive`, applied lazily to every plain object, array, Map and Set along the way and never to a class instance, so `@deep` stops at a class in fact and not only by rule (the prototype could not do this).
- The marks are standard decorators, and the comment tag is the same mark rewritten by the Vite plugin: `#__tacetN = __tacet.installField(this, "name", "live")` right after the field, a static block for a getter. One runtime under both.
- The check runs in `tacet()`: on `vite build` an error fails the build; in `vite dev` it is logged on every change. It reads the tsconfig; a `.tacet` template is turned into TypeScript statements after its script and checked with the same rules as a getter. A live getter's body says what it returns, so a template that walks its result is judged by that body.
- A library object: anything declared in a `.d.ts` is a value (reads and calls into it are leaves). A project class is judged by its marks wherever it sits, a project interface's method is opaque. An array, Map or Set is followed under `@deep`, or when typed `readonly` (`ReadonlyArray`, `ReadonlyMap`): TypeScript's readonly types say exactly "replaced, never mutated". A module `const` object is fixed; its properties need `as const` or `readonly`.
- `as live` (open item 1): done. The tag plugin rewrites `x.y as live` into `__tacet.watch(x, "y")`; the runtime installs an accessor on that one property at the first read and refuses a non-writable one; the check treats the read as followed. `live` is also exported as a type (`any`) so the cast type-checks.
- `<script setup>` (open item 4): the build adds `setup` to a bare `<script>` in a `.tacet` file, but `vue-tsc` and the editor read the raw file and need it written, so the README writes `<script setup lang="ts">`.
- Vue 3.5 (open item 5): 3.5.44. The Vapor copy was not rebuilt.
- The tag plugin's parser (open item 6): TypeScript's, which the check needs anyway.
- A mistyped tag (open item 7): the plugin warns on a doc-comment tag within two letters of `live` or `deep`.
- The getter on each instance (open item 3): still on the instance for the decorator and the tag; the `accessor` keyword with `@live` gives the prototype form, for entities made by the thousand.
- The hint: a marked field no template reads, directly or through a live getter or a method the template calls, is reported as a hint when the project has at least one `.tacet` file, and only for the files a `.tacet` file reaches through its imports (so a test's classes never get one).
- The instance is marked raw once, on its prototype (Vue reads `__v_skip` through the chain), instead of a `markRaw` on every instance. A class with the `accessor` keyword gets the ref in the accessor's own slot. Measured in RESEARCH: the instance form costs about half a microsecond per marked field, the accessor form 0.35 µs and is invisible to `JSON.stringify`.
- Vue 3.6 rc.13 (open item 5): the suite passes unchanged, and a `vapor` component drives the same view. The first "it has been tried" in the README is true again.

## Open
1. **`as live` on an expression, implemented as above; to try on a real player or socket.** The original note: `this.player.currentTime as live` inside a `@live` getter watches that one property on that one object (Tacet installs an accessor on the instance at the first read). It is the only way to follow a library object that changes itself with no callback (a player's time, a socket's state, a model's property on its own timer); the value rule covers the rest. Costs: a plain data property only (a library getter or a frozen object = a runtime error naming the property at the first read, never stale); `as live` is a build transform dressed as a cast (one type declaration keeps the editor quiet).

2. **A class loaded with no build.** Tags: plain fields, the screen never updates, no error. Decorators: `SyntaxError`. Decide whether the silent case needs a check (for example, the mount warns when a view has no marked field).
3. **The tag plugin writing the prototype getter** (0.08 µs an instance against 1.1 µs). The plugin owns its output, so it can; not done yet.
4. **The `.tacet` script in a `.vue`-aware editor.** `"files.associations"` is in `.vscode/settings.json`; not tried in an editor here.
5. **Devtools.** Not tried. Open a Tacet view in the Vue devtools in a browser before promising it works there.
6. **The `accessor` form and JSON.** A prototype getter is not an own property: `JSON.stringify` and `Object.keys` skip it. Decide whether Tacet should add a `toJSON` to such a class, or leave it to the author (the README says the latter for now).
