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

## Open
1. **`as live` on an expression, to try in the prototype (the owner, 2026-10-30: it has value):** `this.player.currentTime as live` inside a `@live` getter watches that one property on that one object (Tacet installs an accessor on the instance at the first read). It is the only way to follow a library object that changes itself with no callback (a player's time, a socket's state, a model's property on its own timer); the value rule covers the rest. Costs: a plain data property only (a library getter or a frozen object = a runtime error naming the property at the first read, never stale); `as live` is a build transform dressed as a cast (one type declaration keeps the editor quiet).

2. **A class loaded with no build.** Tags: plain fields, the screen never updates, no error. Decorators: `SyntaxError`. Decide whether the silent case needs a check (for example, the mount warns when a view has no marked field).
3. **The getter on each instance or on the prototype.** On each instance, making an object costs 1.1 µs per marked field, against 0.08 µs on the prototype. A few views do not care; entities made by the thousand do. The tag plugin can write the prototype form; a decorator needs the `accessor` keyword for it. What was built and measured is at line 11; the owner confirms.
4. **`<script>` or `<script setup>` in a `.tacet` file.** Vue gives the template a file's top-level names only from `<script setup>`. The README's `<script lang="ts">` needs `setup`, or the plugin adds it. The plugin adds it, with the catch at line 13; the owner confirms.
5. **Vue 3.5 or 3.6.** 3.6 brings the new reactivity and Vapor, but is a release candidate (rc.13, 2026-10-23). The prototype runs on both. The implementation is on 3.5.44; the suite passes on 3.6.0-rc.13 in a copy outside the repo, and a vapor component drove the view there; not kept; the owner confirms.
6. **The tag plugin's parser.** TypeScript (already installed with `vue-tsc`, 575 ms to load per build) or a lighter one (Babel's or oxc's parser). The plugin uses TypeScript's parser, which the check needs anyway; the owner confirms.
7. **A mistyped tag.** `/** @lvie */` is silently plain. Decide whether the plugin warns on an `@` tag on a field that is close to `live` or `deep`. The plugin warns on a tag within two letters of `live` or `deep`; the owner confirms.
8. **Devtools.** Not tried. Open a Tacet view in the Vue devtools in a browser before promising it works there.
9. **A `const` the script or module never writes.** The check treats its reads as a value (the review's rule), in a template and in a `@live` getter alike, so the owner's example passes as he wrote it, `const filters: TodoFilter[]`; confirm, or ask for `readonly`.
10. **`as live`, implemented behind the build.** The tag plugin rewrites `x.y as live` into a runtime watch of that one property and the check treats the read as followed; still open, to try on a real player or socket, and not in the README until the owner closes it.
11. **The `accessor` form.** `@live accessor x`, the getter on the prototype, was built and measured on this box at 0.35 µs an instance against 0.5 for the field form (the prototype's research said 0.08 against 1.1), and it is invisible to `JSON.stringify` and `Object.keys`; removed from the runtime; the owner decides whether it comes back.
12. **The licence and CI.** `"license": "MIT"` in package.json and the CI workflow (push to main and pull requests) were the session's picks; the owner confirms or changes them.
13. **The `.tacet` script.** The build adds `setup` to a bare `<script>`, but vue-tsc and the editor read the raw file and need it written; the example in `example/` writes `<script setup lang="ts">` so `npm run check` passes while the README keeps the owner's `<script lang="ts">`; the owner decides which the README shows.
14. **A library object in a `@live` getter.** Reached through a readonly or plain field (`this.box.clientWidth`) it is a build error; through a marked field it is a value the field follows; the pure namespaces (Math, JSON, Object...) stay leaves; the owner confirms the list, and whether `console` joins it: a `console.log` inside a `@live` getter is refused today.
