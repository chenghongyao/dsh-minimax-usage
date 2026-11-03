/**
 * dsh-minimax-usage — MiniMax Token Plan usage in the DSH Web UI.
 *
 * Cordis host plugin entry. Loaded through the package's cordis.patch.yml
 * bundle layer. Zero runtime dependencies on `@deepseek-ai/*`: DSH services
 * are read through `ctx.get(...)` / `ctx.inject(...)`.
 */
export declare const name = "dsh-minimax-usage";
export declare const inject: string[];
/**
 * This MUST stay an arrow function. Cordis decides with `isConstructor(cb)` — true for
 * anything carrying a `prototype`, i.e. a plain `function` declaration or a class — and
 * then loads the plugin through its class branch (`new cb(ctx, config)`), where the
 * disposer returned below is dropped. Losing that disposer left the scheduler's heartbeat
 * timer armed forever, so the host process could never exit and desktop updates failed
 * with "Host did not complete graceful task teardown". An arrow function keeps the callback
 * non-constructible, so cordis takes the function branch and collects the disposer.
 */
export declare const apply: (ctx: unknown) => (() => void);
//# sourceMappingURL=index.d.ts.map