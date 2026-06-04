export type VueModule = {
	createMwApp: (options: unknown) => VueApp;
};

export type VueApp = {
	mount: (selector: string) => unknown;
	component?: (name: string, value: unknown) => VueApp;
};

export type CodexModule = Partial<{
	CdxDialog: unknown;
	CdxButton: unknown;
	CdxSelect: unknown;
	CdxTextInput: unknown;
	CdxCheckbox: unknown;
	CdxField: unknown;
	CdxMultiselectLookup: unknown;
	CdxTextArea: unknown;
	CdxChipInput: unknown;
	CdxToggleSwitch: unknown;
}>;

export type CodeMirrorRequire = (moduleName: string) => unknown;
export type CodeMirrorLike = {
	initialize: () => void;
	view?: {
		state?: {
			doc?: { toString: () => string };
			selection?: { main?: { from: number; to: number } };
		};
		dispatch?: (spec: {
			changes?: { from: number; to: number; insert: string };
			selection?: { anchor: number };
		}) => void;
		focus?: () => void;
	};
	destroy?: () => void;
};
export type CodeMirrorBinding = {
	cm: CodeMirrorLike;
	textarea: HTMLTextAreaElement;
	onInput: () => void;
};

let mountedApp: VueApp | null = null;
let mountedRoot: unknown = null;
const MOUNT_ID = 'voter-dialog-mount';
let codeMirrorRequirePromise: Promise<CodeMirrorRequire> | null = null;

/**
 * Load Codex and Vue from ResourceLoader. Mirrors ReviewTool pattern for future UI work.
 * @returns Promise resolving to Vue and Codex module objects.
 */
function loadCodex(): Promise<{ Vue: unknown; Codex: unknown }> {
    return new Promise((resolve, reject) => {
        mw.loader
            .using('@wikimedia/codex')
            .then((requireFn: (name: string) => unknown) => {
                resolve({
                    Vue: requireFn ? requireFn('vue') : null,
                    Codex: requireFn ? requireFn('@wikimedia/codex') : null
                });
            })
            .catch((err: unknown) => {
                const reason =
                    err instanceof Error
                        ? err
                        : new Error(
                            typeof err === 'string'
                                ? err
                                : (() => {
                                    try {
                                        return JSON.stringify(err);
                                    } catch {
                                        return 'Unknown error';
                                    }
                                })()
                        );
                reject(reason);
            });
    });
}

/**
 * Load Codex and Vue modules with proper typing.
 * Wraps the internal loadCodex function with typed return values.
 * @returns Promise resolving to Vue and Codex module objects.
 */
export async function loadCodexAndVue(): Promise<{ Vue: VueModule; Codex: CodexModule }> {
    const loaded = await loadCodex();
    return loaded as { Vue: VueModule; Codex: CodexModule };
}

/**
 * Ensure a DOM mount point exists for Vue apps.
 * Creates a div with the provided id and appends to body if missing.
 * @param {string} id Element id to create or reuse.
 * @returns The mount point element.
 */
export function ensureMount(id = MOUNT_ID): HTMLElement {
    let mount = document.getElementById(id);
    if (!mount) {
        mount = document.createElement('div');
        mount.id = id;
        document.body.appendChild(mount);
    }
    return mount;
}

/**
 * Ensure a style element with given id exists, injecting the provided CSS text.
 * @param {string} id Element id for the style tag.
 * @param {string} cssText CSS text content to inject.
 */
export function ensureStyleElement(id: string, cssText: string): void {
    if (document.getElementById(id)) return;
    try {
        const styleEl = document.createElement('style');
        styleEl.id = id;
        styleEl.appendChild(document.createTextNode(cssText));
        document.head.appendChild(styleEl);
    } catch {
        const div = document.createElement('div');
        div.innerHTML = `<style id="${id}">${cssText}</style>`;
        const styleEl = div.firstChild as HTMLElement | null;
        if (styleEl) {
            document.head.appendChild(styleEl);
        }
    }
}

/**
 * Create the dialog mount point in the DOM if it doesn't exist.
 * The mount point is where Vue apps are mounted.
 * @returns The mount point HTMLElement.
 */
export function createDialogMountIfNeeded(): HTMLElement {
    return ensureMount(MOUNT_ID);
}

/**
 * Mount a Vue app to the dialog mount point.
 * Creates the mount point if needed and stores references to the app and root.
 * @param {VueApp} app The Vue app instance to mount.
 * @returns The mounted Vue app.
 */
export function mountApp(app: VueApp): VueApp {
    createDialogMountIfNeeded();
    mountedApp = app;
    mountedRoot = mountedApp.mount(`#${MOUNT_ID}`);
    return mountedApp;
}

/**
 * Get the currently mounted Vue app instance.
 * @returns The mounted app, or null if none is mounted.
 */
export function getMountedApp(): VueApp | null {
    return mountedApp;
}

/**
 * Get the root component instance of the mounted app.
 * @returns The root component instance, or null if none is mounted.
 */
export function getMountedRoot(): unknown {
    return mountedRoot;
}

/**
 * Remove the dialog mount point from the DOM and clear app references.
 * Should be called when the dialog is permanently closed.
 */
export function removeDialogMount(): void {
    const mount = document.getElementById(MOUNT_ID);
    if (mount) {
        mount.remove();
    }
    mountedApp = null;
    mountedRoot = null;
}

/**
 * Register Codex UI components with a Vue app.
 * Registers CdxDialog, CdxButton, CdxSelect, and CdxTextInput.
 * @param {VueApp} app The Vue app to register components with.
 * @param {CodexModule} Codex The Codex module containing component definitions.
 */
export function registerCodexComponents(app: VueApp, Codex: CodexModule): void {
    if (!app || !app.component || !Codex) return;
    try {
        if (Codex.CdxDialog) app.component('cdx-dialog', Codex.CdxDialog);
        if (Codex.CdxButton) app.component('cdx-button', Codex.CdxButton);
        if (Codex.CdxSelect) app.component('cdx-select', Codex.CdxSelect);
        if (Codex.CdxTextInput) app.component('cdx-text-input', Codex.CdxTextInput);
        if (Codex.CdxTextArea) app.component('cdx-text-area', Codex.CdxTextArea);
        if (Codex.CdxCheckbox) app.component('cdx-checkbox', Codex.CdxCheckbox);
        if (Codex.CdxField) app.component('cdx-field', Codex.CdxField);
        if (Codex.CdxMultiselectLookup) app.component('cdx-multiselect-lookup', Codex.CdxMultiselectLookup);
        if (Codex.CdxChipInput) app.component('cdx-chip-input', Codex.CdxChipInput);
        if (Codex.CdxToggleSwitch) app.component('cdx-toggle-switch', Codex.CdxToggleSwitch);
    } catch {
        // best effort; ignore registration errors
    }
}

/**
 * 加載CodeMirror模塊，使用緩存以避免重複加載。
 * @return {Promise<CodeMirrorRequire>} 加載完成後的CodeMirror require函數
 */
export function loadCodeMirrorModules(): Promise<CodeMirrorRequire> {
	if (codeMirrorRequirePromise) {
		return codeMirrorRequirePromise;
	}

	codeMirrorRequirePromise = new Promise<CodeMirrorRequire>((resolve, reject) => {
		mw.loader
			.using(["ext.CodeMirror.v6", "ext.CodeMirror.v6.mode.mediawiki"])
			.then(
				(requireFn: unknown) => resolve(requireFn as CodeMirrorRequire),
				(error: unknown) => {
					const reason = error instanceof Error ? error : new Error(String(error));
					reject(reason);
				}
			);
	});

	return codeMirrorRequirePromise;
}

/**
 * 在 textarea 上初始化 MediaWiki CodeMirror。
 * @param {HTMLTextAreaElement} textarea 要增強的 textarea
 * @param {() => void} onTextChange CodeMirror 同步 textarea 後的輸入回調
 * @returns {Promise<CodeMirrorBinding | null>} CodeMirror 綁定，無法初始化時為 null
 */
export async function createCodeMirrorBinding(
	textarea: HTMLTextAreaElement,
	onTextChange: () => void
): Promise<CodeMirrorBinding | null> {
	const requireFn = await loadCodeMirrorModules();
	const CodeMirrorCtor = requireFn("ext.CodeMirror.v6") as new (
		textareaEl: HTMLTextAreaElement,
		modeExt: unknown
	) => CodeMirrorLike;
	const modeModule = requireFn("ext.CodeMirror.v6.mode.mediawiki") as { mediawiki?: () => unknown };
	const mode = typeof modeModule.mediawiki === "function" ? modeModule.mediawiki() : undefined;
	if (!CodeMirrorCtor || !mode) return null;

	const cm = new CodeMirrorCtor(textarea, mode);
	cm.initialize();

	const onInput = () => {
		onTextChange();
	};
	textarea.addEventListener("input", onInput);

	return { cm, textarea, onInput };
}

/**
 * 取得 CodeMirror 或原 textarea 中的最新文字。
 * @param {CodeMirrorBinding} binding CodeMirror 綁定
 * @returns {string} 最新文字
 */
export function getCodeMirrorBindingText(binding: CodeMirrorBinding): string {
	return binding.cm.view?.state?.doc?.toString() ?? binding.textarea.value;
}

/**
 * 在 CodeMirror 目前游標位置插入文字。
 * @param {CodeMirrorBinding} binding CodeMirror 綁定
 * @param {string} text 要插入的文字
 * @returns {string | null} 插入後文字；若無法透過 CodeMirror 插入則為 null
 */
export function insertTextIntoCodeMirrorBinding(binding: CodeMirrorBinding, text: string): string | null {
	const view = binding.cm.view;
	const selection = view?.state?.selection?.main;
	if (!view || !selection || typeof view.dispatch !== "function") {
		return null;
	}

	view.dispatch({
		changes: {
			from: selection.from,
			to: selection.to,
			insert: text
		},
		selection: { anchor: selection.from + text.length }
	});
	const updated = view.state?.doc?.toString() || "";
	if (typeof view.focus === "function") {
		view.focus();
	}
	return updated;
}

/**
 * 銷毀 CodeMirror 綁定。
 * @param {CodeMirrorBinding} binding CodeMirror 綁定
 */
export function destroyCodeMirrorBinding(binding: CodeMirrorBinding): void {
	binding.textarea.removeEventListener("input", binding.onInput);
	if (typeof binding.cm.destroy === "function") {
		binding.cm.destroy();
	}
}
