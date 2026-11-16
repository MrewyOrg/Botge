/* Build flags read with dot access, so Vite replaces them with constants and drops dead code. */

interface ImportMetaEnv {
  /** `'true'` in demo builds and `npm run dev:demo` (`.env.demo`); otherwise absent. */
  readonly VITE_ENABLE_ACTIVITY_DEMO?: string;
}
