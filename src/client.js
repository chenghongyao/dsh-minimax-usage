/**
 * dsh-minimax-usage client half — compact Token Plan quota indicator beside
 * the conversation model selector.
 *
 * Authored directly in the DSH client module format (window.__ModuleLoader__).
 * The Host half remains the source of truth for credentials, caching and
 * refresh scheduling; this half reads only the plugin-owned JSON endpoints.
 */
window.__ModuleLoader__.load({
	id: "dsh-minimax-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const createElement = react.createElement;

		// `slots` is the root service; `modelDirectories` is resolved in the
		// session-scoped inject below so every composer observes its own model.
		const inject = ["slots"];
		const POLL_MS = 15000;
		const REGION_LABEL = { global: "国际站", cn: "国内站" };

		const css = [
			// === inline quota cell (button on the conversation input row) ===
			".mxu_inline_host{display:inline-flex;position:relative;flex:none;align-items:center;height:28px;margin:0 2px;z-index:1}",
			".mxu_inline{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;width:102px;min-height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,rgba(255,255,255,.62));cursor:pointer;font:inherit;line-height:1;user-select:none;transition:background .14s ease,opacity .14s ease,transform .14s ease;-webkit-tap-highlight-color:transparent}",
			".mxu_inline:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}",
			".mxu_inline:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3,#3b82f6)}",
			".mxu_inline:active{transform:scale(.98)}",
			".mxu_inline[data-busy=true]{background:var(--dsw-alias-interactive-bg-active,rgba(59,130,246,.12))}",
			".mxu_inline_disabled{opacity:.5;cursor:default}",
			".mxu_inline_rows{display:inline-flex;flex-direction:column;align-items:stretch;justify-content:center;gap:3px;width:100%}",
			".mxu_inline_line{display:inline-flex;align-items:center;gap:4px;width:100%;height:6px}",
			".mxu_inline_label{display:inline-block;width:18px;color:var(--dsw-alias-label-tertiary,rgba(255,255,255,.45));font-size:9px;font-weight:600;line-height:10px;text-align:right;letter-spacing:.01em;flex:none}",
			".mxu_inline_track{display:block;flex:1;min-width:0;height:6px;border-radius:999px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.12));overflow:hidden}",
			".mxu_inline_reset{display:inline-block;width:36px;flex:none;color:var(--dsw-alias-label-tertiary,rgba(255,255,255,.45));font-size:9px;font-weight:600;line-height:10px;text-align:left;letter-spacing:.01em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".mxu_inline_reset.muted{opacity:.55}",
			".mxu_inline_fill{display:block;height:100%;min-width:0;border-radius:inherit;transition:width .45s cubic-bezier(.3,.7,.4,1),background-color .2s ease}",
			".mxu_inline_fill.ok{background:var(--dsw-alias-state-success-primary,#22c55e)}",
			".mxu_inline_fill.warn{background:var(--dsw-alias-state-warn-primary,#f59e0b)}",
			".mxu_inline_fill.danger{background:var(--dsw-alias-state-error-primary,#ef4444)}",
			".mxu_inline_fill.muted{background:var(--dsw-alias-label-tertiary,rgba(255,255,255,.32));opacity:.55}",
			".mxu_inline_fill.loading{width:55%;background:linear-gradient(90deg,#60a5fa,#93c5fd,#60a5fa);background-size:200% 100%;animation:mxu_inline_loading 1.4s ease-in-out infinite}",
			"@keyframes mxu_inline_loading{0%{background-position:100% 0;opacity:.42}50%{opacity:.9}100%{background-position:0 0;opacity:.42}}",

			// === shared detail surface (used by desktop hover & mobile bottom sheet) ===
			// Background, border and shadow all use DSH design tokens so the surface
			// looks at home next to native DSH cards. Fallback values mirror DSH's
			// dark theme (one slate-blue rounded card, hairline border, soft shadow).
			".mxu_inline_tip{pointer-events:none;position:absolute;right:0;bottom:calc(100% + 7px);width:296px;box-sizing:border-box;padding:14px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:12px;background:var(--dsw-alias-bg-layer-1,#1a1d23);color:var(--dsw-alias-label-primary,rgba(255,255,255,.92));box-shadow:0 4px 16px rgba(0,0,0,.18),0 1px 0 rgba(255,255,255,.04) inset;z-index:1000;line-height:1.45;font-family:inherit}",
			".mxu_inline_tip_head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}",
			".mxu_inline_tip_title{font-size:13px;font-weight:600;letter-spacing:-.005em;color:var(--dsw-alias-label-primary,rgba(255,255,255,.92))}",
			".mxu_inline_tip_sub{margin-top:2px;color:var(--dsw-alias-label-secondary,rgba(255,255,255,.62));font-size:11px}",
			".mxu_inline_tip_live{color:var(--dsw-alias-label-secondary,rgba(255,255,255,.62));font-size:11px;white-space:nowrap}",
			".mxu_inline_tip_error{margin:0 0 10px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-state-error-bg,rgba(239,68,68,.12));color:var(--dsw-alias-state-error-primary,#fca5a5);font-size:11px;line-height:1.45;border:1px solid var(--dsw-alias-state-error-border,rgba(239,68,68,.2))}",
			".mxu_inline_tip_empty{padding:12px 2px;color:var(--dsw-alias-label-secondary,rgba(255,255,255,.62));font-size:11px;text-align:center}",
			".mxu_inline_account{margin-top:8px;padding:10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06))}",
			".mxu_inline_account:first-of-type{margin-top:0}",
			".mxu_inline_account_selected{border-color:var(--dsw-alias-state-info-primary,rgba(59,130,246,.45));background:var(--dsw-alias-state-info-bg,rgba(59,130,246,.06))}",
			".mxu_inline_account_head{display:flex;align-items:center;gap:8px;margin-bottom:8px}",
			".mxu_inline_chip{padding:2px 8px;border-radius:6px;background:var(--dsw-alias-state-info-bg,rgba(59,130,246,.12));color:var(--dsw-alias-state-info-primary,#93c5fd);font-size:10px;font-weight:600;letter-spacing:.01em}",
			".mxu_inline_account_name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary,rgba(255,255,255,.92))}",
			".mxu_inline_stale{margin-left:auto;color:var(--dsw-alias-state-warn-primary,#fbbf24);font-size:10px;white-space:nowrap}",
			".mxu_inline_account_error{margin:0 0 8px;color:var(--dsw-alias-state-error-primary,#fca5a5);font-size:11px;line-height:1.4}",
			".mxu_inline_model{margin-top:8px}",
			".mxu_inline_model:first-of-type{margin-top:0}",
			".mxu_inline_model_name{margin-bottom:6px;color:var(--dsw-alias-label-tertiary,rgba(255,255,255,.45));font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}",
			".mxu_inline_metric{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:3px;color:var(--dsw-alias-label-secondary,rgba(255,255,255,.62));font-size:11px}",
			".mxu_inline_metric b{color:var(--dsw-alias-label-primary,rgba(255,255,255,.92));font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}",
			".mxu_inline_hint{margin-top:10px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));color:var(--dsw-alias-label-tertiary,rgba(255,255,255,.45));font-size:10.5px;line-height:1.45}",

			// === mobile: tap-toggled bottom sheet (iOS-style: large radius, sheet at bottom) ===
			".mxu_inline_backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);z-index:999;opacity:0;pointer-events:none;transition:opacity .2s ease}",
			".mxu_inline_backdrop.show{opacity:1;pointer-events:auto}",
			"@media (max-width:640px){",
				".mxu_inline_tip{position:fixed;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));width:auto;max-height:72vh;overflow:auto;border-radius:18px;padding:18px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));box-shadow:0 -8px 28px rgba(0,0,0,.32),0 1px 0 rgba(255,255,255,.04) inset;pointer-events:auto;animation:mxu_sheet_up .22s cubic-bezier(.2,.7,.2,1)}",
				".mxu_inline_tip::before{content:'';display:block;width:36px;height:4px;border-radius:999px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.18));margin:-6px auto 12px}",
				".mxu_inline_tip_title{font-size:15px}",
				".mxu_inline_chip{font-size:10px;padding:2px 9px}",
				".mxu_inline_account{padding:12px;border-radius:12px}",
				".mxu_inline_model_name{font-size:10.5px}",
				".mxu_inline_metric{font-size:12px}.mxu_inline_metric b{font-size:12px}",
				".mxu_inline_hint{font-size:11px}",
				"@keyframes mxu_sheet_up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}",
			"}",
			"@media (prefers-reduced-motion:reduce){.mxu_inline_backdrop,.mxu_inline_tip,.mxu_inline{transition:none;animation:none}}",
		].join("");

		if (typeof document !== "undefined") {
			const existing = document.querySelector('style[data-plugin-css="dsh-minimax-usage"]');
			if (existing) {
				existing.textContent = css;
			} else {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-minimax-usage";
				tag.dataset.pluginCss = "dsh-minimax-usage";
				tag.textContent = css;
				document.head.appendChild(tag);
			}
		}

		function api(path, options) {
			return fetch("/minimax-usage/api" + path, {
				headers: { "Content-Type": "application/json" },
				...options,
			}).then(async (resp) => ({
				ok: resp.ok,
				status: resp.status,
				body: await resp.json().catch(() => ({})),
			}));
		}

		function minimaxRegion(provider) {
			if (provider === "minimax-cn") return "cn";
			if (provider === "minimax") return "global";
			return undefined;
		}

		function toneOf(percent) {
			if (typeof percent !== "number" || Number.isNaN(percent)) return "muted";
			if (percent < 20) return "danger";
			if (percent < 50) return "warn";
			return "ok";
		}

		function formatPercent(percent) {
			if (typeof percent !== "number" || Number.isNaN(percent)) return "—";
			return Math.round(percent) + "%";
		}

		function formatCountdown(endAt, compact) {
			if (!endAt) return "";
			const remain = endAt - Date.now();
			if (remain <= 0) return compact ? "0s" : "已重置";
			const totalMin = Math.floor(remain / 60000);
			const days = Math.floor(totalMin / (60 * 24));
			const hours = Math.floor((totalMin % (60 * 24)) / 60);
			const mins = totalMin % 60;
			if (compact) {
				// Keep ≤5 chars so it fits in the 34px inline reset slot.
				// Full precision still lives in the detail panel.
				if (days > 0)       return days + "d" + hours + "h";             // 4 chars
				if (hours >= 10)    return hours + "h";                            // 3 chars (e.g. "19h")
				if (hours > 0)      return hours + "h" + mins + "m";              // 5 chars (e.g. "3h24m")
				if (mins > 0)       return mins + "m";                            // 2-3 chars
				return Math.max(1, Math.floor(remain / 1000)) + "s";
			}
			if (days > 0) return days + "天" + hours + "小时";
			if (hours > 0) return hours + "小时" + mins + "分";
			if (mins > 0) return mins + "分";
			return Math.max(1, Math.floor(remain / 1000)) + "秒";
		}

		function formatFetchedAt(ts) {
			if (!ts) return "";
			try {
				return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
			} catch {
				return "";
			}
		}

		function accountForSelection(accounts, region, modelId) {
			const account = (accounts || []).find((item) => item && item.region === region);
			if (!account) return { account: undefined, model: undefined };
			const wanted = typeof modelId === "string" ? modelId.toLowerCase() : "";
			const exact = wanted
				? (account.models || []).find((item) => item && String(item.name).toLowerCase() === wanted)
				: undefined;
			const fallback = (account.models || []).find((item) => item && item.included !== false) || (account.models || [])[0];
			return { account, model: exact || fallback };
		}

		function useUsage(enabled, region) {
			const [data, setData] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [tick, setTick] = react.useState(0);
			const requestSeq = react.useRef(0);
			const mounted = react.useRef(true);

			const load = react.useCallback((force) => {
				if (!enabled) return Promise.resolve();
				const seq = ++requestSeq.current;
				if (force) setBusy(true);
				return api(force ? "/refresh" : "/status", force ? { method: "POST" } : undefined)
					.then((response) => {
						if (seq !== requestSeq.current || !mounted.current) return;
						if (response.body && typeof response.body === "object") setData(response.body);
					})
					.catch(() => {})
					.finally(() => {
						if (seq === requestSeq.current && force) setBusy(false);
					});
			}, [enabled]);

			// 跟踪 mounted 状态。
			react.useEffect(() => {
				mounted.current = true;
				return () => { mounted.current = false; };
			}, []);

			// **关键**：用 onceRef 锁住首次 fetch，避免 enabled 在 true/false 反复
			// 切换时每次都重新 fetch。region 不进依赖，因为 region 翻转不该重启 fetch。
			// 整个 effect 只在 enabled 第一次变 true 时跑一次拿初始数据，之后依赖
			// 轮询 tick 来更新。
			const didInitialFetch = react.useRef(false);
			react.useEffect(() => {
				if (!enabled || didInitialFetch.current) return undefined;
				didInitialFetch.current = true;
				load(true);
				return undefined;
			}, [enabled, load]);

			// 轮询：每 15s 拉一次。region 变化不重启 timer —— 让 timer 一直跑。
			react.useEffect(() => {
				const POLL_MS = 15000;
				let cancelled = false;
				let timerId;
				const tick = () => {
					if (cancelled) return;
					load(false);
					timerId = setTimeout(tick, POLL_MS);
				};
				timerId = setTimeout(tick, 1000);    // 首次 1s 后快速拉一次
				return () => { cancelled = true; clearTimeout(timerId); };
			}, [enabled, load]);

			// 30s tick：让倒计时重算
			react.useEffect(() => {
				const id = setInterval(() => setTick((value) => value + 1), 30000);
				return () => clearInterval(id);
			}, []);

			return { data, busy, load, tick };
		}

		function CompactQuotaLine(props) {
			const percent = typeof props.percent === "number" && !Number.isNaN(props.percent)
				? Math.max(0, Math.min(100, props.percent))
				: undefined;
			const tone = props.loading ? "muted" : (props.included === false ? "muted" : toneOf(percent));
			const fillClass = "mxu_inline_fill " + (props.loading ? "loading" : tone);
			const width = props.loading ? undefined : (props.included === false || percent === undefined ? "0%" : percent + "%");
			const resetText = props.reset || "";
			const resetTone = props.loading ? "muted" : (props.included === false ? "muted" : "");
			return createElement("span", { className: "mxu_inline_line", "aria-hidden": "true" },
				createElement("span", { className: "mxu_inline_label" }, props.label),
				createElement("span", { className: "mxu_inline_track" },
					createElement("span", { className: fillClass, style: width === undefined ? undefined : { width } }),
				),
				createElement("span", { className: "mxu_inline_reset" + (resetTone ? " " + resetTone : "") }, resetText),
			);
		}

		function detailMetric(label, percent, included, reset) {
			const value = included === false ? "未包含" : formatPercent(percent);
			return createElement("div", { className: "mxu_inline_metric" },
				createElement("span", null, label + (reset ? " · " + reset : "")),
				createElement("b", null, value),
			);
		}

		function DetailPanel(props) {
			const accounts = Array.isArray(props.accounts) ? props.accounts : [];
			const data = props.data;
			const loading = !data || data.phase === "init";
			return createElement("div", { className: "mxu_inline_tip", role: "tooltip", id: props.id },
				createElement("div", { className: "mxu_inline_tip_head" },
					createElement("div", null,
						createElement("div", { className: "mxu_inline_tip_title" }, "MiniMax Token Plan"),
						createElement("div", { className: "mxu_inline_tip_sub" }, REGION_LABEL[props.region] || "MiniMax"),
					),
					createElement("span", { className: "mxu_inline_tip_live" },
						props.busy ? "刷新中…" : (loading ? "读取中…" : (data.fetchedAt ? "更新于 " + formatFetchedAt(data.fetchedAt) : "")),
					),
				),
				data && data.error ? createElement("div", { className: "mxu_inline_tip_error" }, data.error) : null,
				loading && accounts.length === 0
					? createElement("div", { className: "mxu_inline_tip_empty" }, props.busy ? "正在刷新用量…" : "正在读取用量…")
					: null,
				accounts.map((account) => createElement("div", {
					className: "mxu_inline_account" + (account.region === props.region ? " mxu_inline_account_selected" : ""),
					key: account.region,
				},
					createElement("div", { className: "mxu_inline_account_head" },
						createElement("span", { className: "mxu_inline_chip" }, REGION_LABEL[account.region] || account.region),
						createElement("span", { className: "mxu_inline_account_name" }, account.planName || "订阅套餐"),
						account.stale ? createElement("span", { className: "mxu_inline_stale" }, "可能过期") : null,
					),
					account.error ? createElement("div", { className: "mxu_inline_account_error" }, account.error) : null,
					(account.models || []).map((model) => createElement("div", { className: "mxu_inline_model", key: model.name },
						createElement("div", { className: "mxu_inline_model_name" }, model.name),
						detailMetric("5 小时窗口", model.intervalRemainingPercent, model.included, formatCountdown(model.intervalEndAt)),
						// 7d 行：套餐未提供时整行不渲染
						(model.weeklyRemainingPercent === undefined && model.weeklyRemainsTimeMs === undefined)
							? null
							: detailMetric("本周窗口", model.weeklyRemainingPercent, model.included, formatCountdown(model.weeklyEndAt)),
					)),
				)),
				createElement("div", { className: "mxu_inline_hint" }, "点击立即刷新 · 仅当前 MiniMax Token Plan provider 显示"),
			);
		}

		function MiniMaxUsageIndicator(props) {
			const directory = props.directory;
			const directoryState = react.useSyncExternalStore(
				(listener) => directory.subscribe(listener),
				() => directory.getSnapshot(),
				() => directory.getSnapshot(),
			);
			const current = directoryState && directoryState.current;
			const region = directoryState && directoryState.status === "ready"
				? minimaxRegion(current && current.provider)
				: undefined;
			const enabled = region !== undefined;
			const { data, busy, load, tick } = useUsage(enabled, region);
			void tick;
			const [hovered, setHovered] = react.useState(false);
			const [focused, setFocused] = react.useState(false);
			const [expanded, setExpanded] = react.useState(false);
			const tooltipId = react.useId();

			// 用 ref 记录"上一次成功的 region"。如果 enabled 短暂翻成 false（例如
			// mobile 切后台后 DSH 在 microtask 里重置 directory 再回 ready），我们继续
			// 用上一次的 region 显示数据，而不是切到 "—" 占位——后者会被肉眼看到
			// 一次闪烁。视觉上：稳定有数据 → 稳定有数据，从不抖。
			const lastGoodRegionRef = react.useRef(region);
			if (region !== undefined) lastGoodRegionRef.current = region;
			const stableRegion = region !== undefined ? region : lastGoodRegionRef.current;
			// disabled 仅在 enabled 一直是 false 时才显示占位（第一次挂载时），
			// 曾经是 minimax provider 又短暂翻成非时仍按 enabled=true 渲染。
			// 关键：disabled 是 stateful 的——一旦用户曾见到过数据，就不再 disabled。
			// 这避免了 useSyncExternalStore 在 microtask 里反复切换 status 导致的
			// "数据 ↔ 占位" 闪烁。
			const disabled = region === undefined && lastGoodRegionRef.current === undefined;

			const accounts = data && Array.isArray(data.accounts) ? data.accounts : [];
			const selected = disabled
				? { account: undefined, model: undefined }
				: accountForSelection(accounts, stableRegion, current && current.model);
			const account = selected.account;
			const model = selected.model;
			const loading = !data || data.phase === "init";
			const error = (account && account.error) || (data && data.error);
			const intervalEndAt = model && model.intervalEndAt;
			const weeklyEndAt = model && model.weeklyEndAt;
			const summary = disabled
				? "MiniMax Token Plan：当前模型不是 MiniMax Token Plan"
				: loading
					? "MiniMax Token Plan 用量读取中"
					: error && !model
						? "MiniMax Token Plan 用量异常：" + error
						: "MiniMax " + (REGION_LABEL[stableRegion] || "") + "：5h 剩余 " + formatPercent(model && model.intervalRemainingPercent) + "（" + formatCountdown(intervalEndAt, true) + "重置），7d 剩余 " + formatPercent(model && model.weeklyRemainingPercent) + "（" + formatCountdown(weeklyEndAt, true) + "重置）；点击展开详情";
			const showDesktopTooltip = hovered || focused;
			const showExpanded = expanded;
			const isMobile = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width:640px)").matches;

			// 移动端：把详情面板 portal 到 document.body，彻底脱离 slot 容器的 transform/overflow 陷阱
			const usePortal = isMobile && showExpanded;
			const closeMobile = react.useCallback(() => setExpanded(false), []);

			// 关键：依赖只放 usePortal 和 closeMobile。data / region / busy 变化时
			// **不要重建整个 panel**，否则 backdrop 会闪一下、sheet_up 动画会重新触发，
			// 用户看到的就是"闪烁"。面板内容由下面的 "刷新" effect 在不重建 backdrop
			// 的前提下单独 update。
			const panelRef = react.useRef(null);
			const latestArgsRef = react.useRef(null);
			latestArgsRef.current = { region, accounts, data, busy, closeMobile };

			react.useEffect(function () {
				if (!usePortal) return undefined;
				const root = document.createElement("div");
				root.setAttribute("data-minimax-usage-portal", "true");
				root.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:flex-end;justify-content:center;pointer-events:none";
				// 背景遮罩
				const backdrop = document.createElement("div");
				backdrop.className = "mxu_inline_backdrop show";
				backdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);pointer-events:auto";
				backdrop.addEventListener("click", closeMobile);
				// 详情面板（用已存在的 .mxu_inline_tip 样式，移动端自动贴底）
				const panel = document.createElement("div");
				panel.className = "mxu_inline_tip";
				panel.style.pointerEvents = "auto";
				panelRef.current = panel;
				// 首次渲染
				const renderInto = (host, args) => {
					host.innerHTML = "";
					return buildMobileSheet({
						host,
						region: args.region,
						accounts: args.accounts,
						data: args.data,
						busy: args.busy,
						onClose: args.closeMobile,
					});
				};
				renderInto(panel, latestArgsRef.current);
				root.appendChild(backdrop);
				root.appendChild(panel);
				document.body.appendChild(root);
				return () => {
					panelRef.current = null;
					try { document.body.removeChild(root); } catch (_) {}
				};
			}, [usePortal, closeMobile]);

			// 数据变化时只重新填充 panel 内容，不重建 backdrop、不重放动画。
			react.useEffect(function () {
				if (!usePortal || !panelRef.current) return;
				const renderInto = (host) => {
					host.innerHTML = "";
					return buildMobileSheet({
						host,
						region: latestArgsRef.current.region,
						accounts: latestArgsRef.current.accounts,
						data: latestArgsRef.current.data,
						busy: latestArgsRef.current.busy,
						onClose: latestArgsRef.current.closeMobile,
					});
				};
				renderInto(panelRef.current);
			}, [region, accounts, data, busy, usePortal]);

			// 弹窗内倒计时跟主按钮同步：每 30s 重新渲染 panel 内容。
			react.useEffect(function () {
				if (!usePortal || !panelRef.current) return undefined;
				const tickId = setInterval(() => {
					if (!panelRef.current) return;
					panelRef.current.innerHTML = "";
					buildMobileSheet({
						host: panelRef.current,
						region: latestArgsRef.current.region,
						accounts: latestArgsRef.current.accounts,
						data: latestArgsRef.current.data,
						busy: latestArgsRef.current.busy,
						onClose: latestArgsRef.current.closeMobile,
					});
				}, 30000);
				return () => clearInterval(tickId);
			}, [usePortal]);

			return createElement("span", {
				className: "mxu_inline_host",
				"data-minimax-usage": "true",
				"data-minimax-usage-provider": current && current.provider,
				"data-minimax-usage-region": region,
				"data-minimax-usage-disabled": disabled ? "true" : "false",
				"data-minimax-usage-region-hist": lastGoodRegionRef.current || "none",
				onMouseEnter: () => setHovered(true),
				onMouseLeave: () => setHovered(false),
			},
				createElement("button", {
					type: "button",
					// 关键：button 的 DOM `disabled` 属性永远设为 false，让 React/浏览器
					// 不把这个 button 当不可交互重建。disabled 状态用 CSS（半透明 + 默认
					// 光标）和 onClick 守卫来表达。
					className: "mxu_inline" + (disabled ? " mxu_inline_disabled" : ""),
					"aria-label": summary,
					"aria-busy": busy || loading ? "true" : "false",
					"aria-describedby": showDesktopTooltip ? tooltipId : undefined,
					"aria-expanded": showExpanded ? "true" : (showDesktopTooltip ? "true" : "false"),
					title: summary,
					"data-busy": busy ? "true" : undefined,
					"data-disabled": disabled ? "true" : undefined,
					onClick: () => {
						if (disabled) return;
						setExpanded((v) => !v);
						void load(true);
					},
					onFocus: () => setFocused(true),
					onBlur: () => setFocused(false),
				},
					createElement("span", { className: "mxu_inline_rows" },
						disabled
							? createElement("span", {
								className: "mxu_inline_line",
								style: { justifyContent: "center", color: "var(--dsw-alias-label-tertiary, rgba(255,255,255,.35))" },
							},
								createElement("span", {
									style: { fontSize: "10px", fontWeight: 500 },
								}, current && current.provider
									? "—" 
									: "…"),
							)
							: createElement(CompactQuotaLine, {
								label: "5h",
								percent: model && model.intervalRemainingPercent,
								included: model && model.included,
								loading,
								reset: intervalEndAt ? formatCountdown(intervalEndAt, true) : "",
							}),
						// 7d 行：套餐未提供 weekly 字段时（model.weeklyRemainingPercent 与
							// model.weeklyRemainsTimeMs 都为 undefined）整行不渲染。
							disabled || (model && (model.weeklyRemainingPercent === undefined && model.weeklyRemainsTimeMs === undefined))
								? null
								: createElement(CompactQuotaLine, {
									label: "7d",
									percent: model && model.weeklyRemainingPercent,
									included: model && model.included,
									loading,
									reset: weeklyEndAt ? formatCountdown(weeklyEndAt, true) : "",
								}),
					),
				),
				// 桌面：仍走 React 子树渲染浮窗（disabled 时不响应）
				!isMobile && showDesktopTooltip && !disabled ? createElement(DetailPanel, {
					id: tooltipId,
					data,
					accounts,
					busy,
					region,
				}) : null,
			);
		}

		// 移动端详情面板的纯 DOM 渲染（不依赖 react-dom portal）
		function buildMobileSheet(opts) {
			const { host, region, accounts, data, busy, onClose } = opts;
			const REGION_LABEL_LOC = REGION_LABEL;
			const root = document.createElement("div");
			root.style.cssText = "display:flex;flex-direction:column;gap:0";

			// header
			const head = document.createElement("div");
			head.className = "mxu_inline_tip_head";
			const headLeft = document.createElement("div");
			const title = document.createElement("div");
			title.className = "mxu_inline_tip_title";
			title.textContent = "MiniMax Token Plan";
			const sub = document.createElement("div");
			sub.className = "mxu_inline_tip_sub";
			sub.textContent = REGION_LABEL_LOC[region] || "MiniMax";
			headLeft.appendChild(title);
			headLeft.appendChild(sub);
			head.appendChild(headLeft);
			const live = document.createElement("span");
			live.className = "mxu_inline_tip_live";
			const loading = !data || data.phase === "init";
			live.textContent = busy ? "刷新中…" : (loading ? "读取中…" : (data && data.fetchedAt ? "更新于 " + new Date(data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""));
			head.appendChild(live);
			root.appendChild(head);

			if (data && data.error) {
				const err = document.createElement("div");
				err.className = "mxu_inline_tip_error";
				err.textContent = data.error;
				root.appendChild(err);
			}
			if (loading && (!accounts || accounts.length === 0)) {
				const empty = document.createElement("div");
				empty.className = "mxu_inline_tip_empty";
				empty.textContent = busy ? "正在刷新用量…" : "正在读取用量…";
				root.appendChild(empty);
			}

			(accounts || []).forEach(function (acct) {
				const card = document.createElement("div");
				card.className = "mxu_inline_account" + (acct.region === region ? " mxu_inline_account_selected" : "");
				const cardHead = document.createElement("div");
				cardHead.className = "mxu_inline_account_head";
				const chip = document.createElement("span");
				chip.className = "mxu_inline_chip";
				chip.textContent = REGION_LABEL_LOC[acct.region] || acct.region;
				cardHead.appendChild(chip);
				const name = document.createElement("span");
				name.className = "mxu_inline_account_name";
				name.textContent = acct.planName || "订阅套餐";
				cardHead.appendChild(name);
				if (acct.stale) {
					const stale = document.createElement("span");
					stale.className = "mxu_inline_stale";
					stale.textContent = "可能过期";
					cardHead.appendChild(stale);
				}
				card.appendChild(cardHead);
				if (acct.error) {
					const e = document.createElement("div");
					e.className = "mxu_inline_account_error";
					e.textContent = acct.error;
					card.appendChild(e);
				}
				(acct.models || []).forEach(function (m) {
					const mb = document.createElement("div");
					mb.className = "mxu_inline_model";
					const mn = document.createElement("div");
					mn.className = "mxu_inline_model_name";
					mn.textContent = m.name;
					mb.appendChild(mn);
					// 7d 窗口：套餐未提供时整行不渲染
					const hasWeekly = m.weeklyRemainingPercent !== undefined || m.weeklyRemainsTimeMs !== undefined;
					[{
						label: "5 小时窗口",
						percent: m.intervalRemainingPercent,
						included: m.included,
						endAt: m.intervalEndAt,
					}, hasWeekly ? {
						label: "本周窗口",
						percent: m.weeklyRemainingPercent,
						included: m.included,
						endAt: m.weeklyEndAt,
					} : null].forEach(function (row) {
						if (!row) return;
						const metric = document.createElement("div");
						metric.className = "mxu_inline_metric";
						const left = document.createElement("span");
						const resetText = row.endAt ? " · " + formatCountdown(row.endAt, false) : "";
						left.textContent = row.label + resetText;
						const right = document.createElement("b");
						right.textContent = row.included === false ? "未包含" : (typeof row.percent === "number" ? Math.round(row.percent) + "%" : "—");
						metric.appendChild(left);
						metric.appendChild(right);
						mb.appendChild(metric);
					});
					card.appendChild(mb);
				});
				root.appendChild(card);
			});

			// 关闭按钮（移动端专用；使用 DSH 主蓝，保持与 DSH 整体视觉一致）
			const close = document.createElement("button");
			close.type = "button";
			close.textContent = "关闭";
			close.style.cssText = "margin-top:14px;padding:10px 14px;width:100%;border:0;border-radius:10px;background:var(--dsw-alias-state-info-primary,#3b82f6);color:#fff;font-size:13px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;font-family:inherit";
			close.addEventListener("click", onClose);
			root.appendChild(close);

			host.appendChild(root);
			return function cleanup() { if (host.contains(root)) host.removeChild(root); };
		}

		function apply(ctx) {
			if (!ctx || typeof ctx.inject !== "function") return;
			ctx.inject(["slots", "modelDirectories"], (scope) => {
				if (!scope || !scope.slots || !scope.modelDirectories) return;
				scope.slots.inject("conversation.input.right", () => scope.slots.register({
					name: "conversation.input.right",
					id: "minimax-usage",
					order: 30,
					label: "MiniMax",
					inject: (sessionId) => ({
						directory: scope.modelDirectories.directoryFor(sessionId).store,
					}),
				}, MiniMaxUsageIndicator));
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
