// Ambient declarations for the vendored classic-script globals lib/ code
// reaches for (Tonal and lamejs are loaded as <script>s before the module
// entry points — see CLAUDE.md's "Static assets layout") and that tests stub
// onto globalThis directly. Untyped on purpose: modeling their real surface
// isn't worth it for a type-check whose job is catching slips in *this*
// codebase's own logic, not vendor API misuse.
declare global {
  // eslint-disable-next-line no-var -- `var` is what merges into globalThis's type
  var Tonal: any;
  // eslint-disable-next-line no-var -- `var` is what merges into globalThis's type
  var lamejs: any;
}

export {};
