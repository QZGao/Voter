import state, { type VoterUserConfig } from "./state";
import { saveUserConfig } from "./user_config";
import {
	createCodeMirrorBinding,
	destroyCodeMirrorBinding,
	getCodeMirrorBindingText,
	getMountedApp,
	loadCodexAndVue,
	mountApp,
	removeDialogMount,
	registerCodexComponents,
	type CodeMirrorBinding,
	type CodexModule,
	type VueModule
} from "./dialog";

type DialogAction = {
	label: string;
	actionType?: "primary" | "progressive";
	disabled?: boolean;
};
type ChipInputItem = { value: string };
type SettingsPageItem = {
	index: number;
	name: string;
	label: string;
};

interface SettingsDialogI18n {
	dialogTitle: string;
	save: string;
	saving: string;
	cancel: string;
	invalidVoteTemplatesHeading: string;
	invalidVoteTemplatesHint: string;
	invalidVoteTemplatesPlaceholder: string;
	defaultVoteMessagesHeading: string;
	defaultVoteMessagesHint: string;
	largerCodeMirrorHeight: string;
	largerCodeMirrorHeightDescription: string;
	saved: string;
	saveFailed: string;
}

interface SettingsDialogData {
	open: boolean;
	isSaving: boolean;
	invalidVoteTemplateChips: ChipInputItem[];
	defaultVoteMessageEnabledByPage: Record<string, boolean>;
	defaultVoteMessagesByPage: Record<string, string>;
	codeMirrorByPageName: Record<string, CodeMirrorBinding>;
	largerCodeMirrorHeight: boolean;
	initialConfigSnapshot: string;
}

interface SettingsDialogComputed {
	validPageItems: SettingsPageItem[];
	hasChanges: boolean;
	primaryAction: DialogAction;
	defaultAction: DialogAction;
}

type SettingsDialogInstance = SettingsDialogData & SettingsDialogComputed & {
	$options: { i18n: SettingsDialogI18n };
	buildConfig: () => VoterUserConfig;
	syncDefaultVoteMessagesFromTextareas: () => void;
	getDefaultVoteTextarea: (pageName: string) => HTMLTextAreaElement | null;
	destroyCodeMirrorForPage: (pageName: string) => void;
	destroyAllCodeMirror: () => void;
	initCodeMirrorForPage: (pageName: string) => Promise<void>;
	syncCodeMirrorInstances: () => Promise<void>;
	onPrimaryAction: () => void;
	onDefaultAction: () => void;
	onUpdateOpen: (newValue: boolean) => void;
	closeDialog: () => void;
	saveSettings: () => Promise<void>;
};

/**
 * 檢查物件是否直接擁有指定鍵。
 * @param {Record<string, string>} object 要檢查的物件
 * @param {string} key 要檢查的鍵
 * @returns {boolean} 是否直接擁有該鍵
 */
function hasOwn(object: Record<string, string>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * 建立設定對話框的初始資料。
 * @returns {SettingsDialogData} 設定對話框初始資料
 */
function createInitialSettingsData(): SettingsDialogData {
	const defaultVoteMessageEnabledByPage: Record<string, boolean> = {};
	const defaultVoteMessagesByPage: Record<string, string> = {};

	for (const page of state.validVotePages) {
		const hasCustomMessage = hasOwn(state.userConfig.defaultVoteMessages, page.name);
		defaultVoteMessageEnabledByPage[page.name] = hasCustomMessage;
		defaultVoteMessagesByPage[page.name] = hasCustomMessage ?
			state.userConfig.defaultVoteMessages[page.name] :
			state.getBuiltInDefaultVoteMessage(page.name);
	}

	return {
		open: true,
		isSaving: false,
		invalidVoteTemplateChips: state.userConfig.invalidVoteTemplates.map((template) => ({ value: template })),
		defaultVoteMessageEnabledByPage,
		defaultVoteMessagesByPage,
		codeMirrorByPageName: {},
		largerCodeMirrorHeight: state.userConfig.largerCodeMirrorHeight,
		initialConfigSnapshot: state.getUserConfigSnapshot(),
	};
}

/**
 * 建立並掛載 Voter 設定對話框。
 */
function createSettingsDialog(): void {
	loadCodexAndVue().then(({ Vue, Codex }: { Vue: VueModule; Codex: CodexModule }) => {
		const app = Vue.createMwApp({
			i18n: {
				dialogTitle: state.convByVar({ hant: "Voter 設定", hans: "Voter 设置" }),
				save: state.convByVar({ hant: "儲存", hans: "保存" }),
				saving: state.convByVar({ hant: "儲存中…", hans: "保存中…" }),
				cancel: state.convByVar({ hant: "取消", hans: "取消" }),
				invalidVoteTemplatesHeading: state.convByVar({ hant: "無效票模板", hans: "无效票模板" }),
				invalidVoteTemplatesHint: state.convByVar({
					hant: "輸入模板名稱即可，不需要包含 {{ }}。",
					hans: "输入模板名称即可，不需要包含 {{ }}。"
				}),
				invalidVoteTemplatesPlaceholder: state.convByVar({ hant: "新增模板名稱", hans: "新增模板名称" }),
				defaultVoteMessagesHeading: state.convByVar({ hant: "預設投票訊息", hans: "默认投票信息" }),
				defaultVoteMessagesHint: state.convByVar({
					hant: "勾選頁面後可自訂該頁面的預設投票內容。",
					hans: "勾选页面后可自定义该页面的默认投票内容。"
				}),
				largerCodeMirrorHeight: state.convByVar({ hant: "加大 CodeMirror 高度", hans: "加大 CodeMirror 高度" }),
				largerCodeMirrorHeightDescription: state.convByVar({
					hant: "投票與設定中的 wikitext 編輯器會使用較高的編輯區。",
					hans: "投票与设置中的 wikitext 编辑器会使用较高的编辑区。"
				}),
				saved: state.convByVar({ hant: "Voter 設定已儲存。", hans: "Voter 设置已保存。" }),
				saveFailed: state.convByVar({ hant: "Voter 設定儲存失敗，請稍後再試。", hans: "Voter 设置保存失败，请稍后再试。" }),
			},
			/**
			 * 取得 Vue app 初始資料。
			 * @returns {SettingsDialogData} 對話框資料
			 */
			data(): SettingsDialogData {
				return createInitialSettingsData();
			},
			computed: {
				/**
				 * 取得設定對話框中的有效頁面清單。
				 * @returns {SettingsPageItem[]} 頁面清單
				 */
				validPageItems(): SettingsPageItem[] {
					return state.validVotePages.map((page, index) => ({
						index,
						name: page.name,
						label: page.label,
					}));
				},
				/**
				 * 檢查目前表單內容是否不同於初始設定。
				 * @returns {boolean} 是否有尚未保存的變更
				 */
				hasChanges(this: SettingsDialogInstance): boolean {
					return state.getUserConfigSnapshot(this.buildConfig()) !== this.initialConfigSnapshot;
				},
				/**
				 * 取得設定對話框主要按鈕狀態。
				 * @returns {DialogAction} 主要按鈕設定
				 */
				primaryAction(this: SettingsDialogInstance): DialogAction {
					return {
						label: this.isSaving ? this.$options.i18n.saving : this.$options.i18n.save,
						actionType: "progressive",
						disabled: this.isSaving || !this.hasChanges,
					};
				},
				/**
				 * 取得設定對話框次要按鈕狀態。
				 * @returns {DialogAction} 次要按鈕設定
				 */
				defaultAction(this: SettingsDialogInstance): DialogAction {
					return { label: this.$options.i18n.cancel };
				},
			},
			watch: {
				defaultVoteMessageEnabledByPage: {
					/**
					 * 在頁面自訂訊息開關變化時同步並刷新 CodeMirror。
					 */
					handler(this: SettingsDialogInstance) {
						this.syncDefaultVoteMessagesFromTextareas();
						setTimeout(() => {
							void this.syncCodeMirrorInstances();
						}, 0);
					},
					deep: true,
				},
			},
			/**
			 * Vue 掛載後初始化已啟用的 CodeMirror 編輯器。
			 */
			mounted(this: SettingsDialogInstance) {
				setTimeout(() => {
					void this.syncCodeMirrorInstances();
				}, 0);
			},
			methods: {
				/**
				 * 依目前表單內容建立可保存的設定。
				 * @returns {VoterUserConfig} 正規化後的使用者設定
				 */
				buildConfig(this: SettingsDialogInstance): VoterUserConfig {
					const defaultVoteMessages: Record<string, string> = {};
					for (const page of state.validVotePages) {
						if (this.defaultVoteMessageEnabledByPage[page.name]) {
							defaultVoteMessages[page.name] = this.defaultVoteMessagesByPage[page.name] || "";
						}
					}

					return state.getSerializableUserConfig({
						invalidVoteTemplates: this.invalidVoteTemplateChips.map((chip) => chip.value),
						defaultVoteMessages,
						largerCodeMirrorHeight: this.largerCodeMirrorHeight,
					});
				},

				/**
				 * 從 CodeMirror 或 textarea 同步各頁面的自訂預設投票訊息。
				 */
				syncDefaultVoteMessagesFromTextareas(this: SettingsDialogInstance) {
					const nextMessages: Record<string, string> = { ...this.defaultVoteMessagesByPage };
					for (const page of state.validVotePages) {
						const binding = this.codeMirrorByPageName[page.name];
						if (binding) {
							nextMessages[page.name] = getCodeMirrorBindingText(binding);
							continue;
						}

						const textarea = this.getDefaultVoteTextarea(page.name);
						if (textarea) {
							nextMessages[page.name] = textarea.value;
						}
					}
					this.defaultVoteMessagesByPage = nextMessages;
				},

				/**
				 * 取得指定頁面自訂預設投票訊息的 textarea。
				 * @param {string} pageName 頁面名稱
				 * @returns {HTMLTextAreaElement | null} textarea 元素，找不到時為 null
				 */
				getDefaultVoteTextarea(pageName: string): HTMLTextAreaElement | null {
					const pageIndex = state.validVotePages.findIndex((page) => page.name === pageName);
					if (pageIndex === -1) return null;
					const container = document.querySelector(`.voter-settings-default-message[data-page-index="${pageIndex}"]`);
					return container ? container.querySelector("textarea") : null;
				},

				/**
				 * 銷毀指定頁面的 CodeMirror 編輯器。
				 * @param {string} pageName 頁面名稱
				 */
				destroyCodeMirrorForPage(this: SettingsDialogInstance, pageName: string) {
					const binding = this.codeMirrorByPageName[pageName];
					if (!binding) return;
					this.defaultVoteMessagesByPage = {
						...this.defaultVoteMessagesByPage,
						[pageName]: getCodeMirrorBindingText(binding),
					};
					try {
						destroyCodeMirrorBinding(binding);
					} catch (error: unknown) {
						console.warn("[Voter] Failed to destroy CodeMirror:", error);
					}
					const nextBindings = { ...this.codeMirrorByPageName };
					delete nextBindings[pageName];
					this.codeMirrorByPageName = nextBindings;
				},

				/**
				 * 銷毀所有設定對話框中的 CodeMirror 編輯器。
				 */
				destroyAllCodeMirror(this: SettingsDialogInstance) {
					for (const pageName of Object.keys(this.codeMirrorByPageName)) {
						this.destroyCodeMirrorForPage(pageName);
					}
				},

				/**
				 * 初始化指定頁面的 CodeMirror 編輯器。
				 * @param {string} pageName 頁面名稱
				 */
				async initCodeMirrorForPage(this: SettingsDialogInstance, pageName: string) {
					if (this.codeMirrorByPageName[pageName]) return;
					const textarea = this.getDefaultVoteTextarea(pageName);
					if (!textarea) return;

					try {
						const binding = await createCodeMirrorBinding(textarea, () => {
							this.defaultVoteMessagesByPage = {
								...this.defaultVoteMessagesByPage,
								[pageName]: textarea.value,
							};
						});
						if (!binding) return;
						this.codeMirrorByPageName = {
							...this.codeMirrorByPageName,
							[pageName]: binding,
						};
					} catch (error: unknown) {
						console.warn("[Voter] CodeMirror initialization failed, fallback to textarea.", error);
					}
				},

				/**
				 * 依目前啟用狀態同步 CodeMirror 編輯器生命週期。
				 */
				async syncCodeMirrorInstances(this: SettingsDialogInstance) {
					const enabledPageNames = new Set(
						state.validVotePages
							.filter((page) => this.defaultVoteMessageEnabledByPage[page.name])
							.map((page) => page.name)
					);

					for (const pageName of Object.keys(this.codeMirrorByPageName)) {
						if (!enabledPageNames.has(pageName)) {
							this.destroyCodeMirrorForPage(pageName);
						}
					}

					for (const pageName of enabledPageNames) {
						await this.initCodeMirrorForPage(pageName);
					}
				},

				/**
				 * 處理主要按鈕點擊。
				 */
				onPrimaryAction(this: SettingsDialogInstance) {
					if (this.isSaving || !this.hasChanges) return;
					void this.saveSettings();
				},

				/**
				 * 處理次要按鈕點擊。
				 */
				onDefaultAction(this: SettingsDialogInstance) {
					this.closeDialog();
				},

				/**
				 * 處理 Codex dialog 開關狀態更新。
				 * @param {boolean} newValue 新的開啟狀態
				 */
				onUpdateOpen(this: SettingsDialogInstance, newValue: boolean) {
					if (!newValue) {
						this.closeDialog();
					}
				},

				/**
				 * 關閉設定對話框並清理掛載點。
				 */
				closeDialog(this: SettingsDialogInstance) {
					this.destroyAllCodeMirror();
					this.open = false;
					setTimeout(() => {
						removeDialogMount();
					}, 300);
				},

				/**
				 * 保存設定到使用者 JSON 頁。
				 */
				async saveSettings(this: SettingsDialogInstance) {
					this.isSaving = true;
					this.syncDefaultVoteMessagesFromTextareas();
					const nextConfig = this.buildConfig();

					try {
						await saveUserConfig(nextConfig);
						state.applyUserConfig(nextConfig);
						this.initialConfigSnapshot = state.getUserConfigSnapshot();
						mw.notify(this.$options.i18n.saved, { tag: "voter" });
						this.isSaving = false;
						this.closeDialog();
					} catch (error: unknown) {
						console.error("[Voter] saveSettings failed:", error);
						mw.notify(this.$options.i18n.saveFailed, { type: "error", title: "[Voter]" });
						this.isSaving = false;
					}
				},
			},
			template: `
				<cdx-dialog
					v-model:open="open"
					:title="$options.i18n.dialogTitle"
					:use-close-button="true"
					:primary-action="primaryAction"
					:default-action="defaultAction"
					@primary="onPrimaryAction"
					@default="onDefaultAction"
					@update:open="onUpdateOpen"
					class="voter-dialog voter-settings-dialog"
					:class="{ 'voter-dialog--large-codemirror': largerCodeMirrorHeight }"
				>
					<div class="voter-settings-section">
						<h3>{{ $options.i18n.invalidVoteTemplatesHeading }}</h3>
						<div class="voter-template-hint">{{ $options.i18n.invalidVoteTemplatesHint }}</div>
						<cdx-chip-input
							v-model:input-chips="invalidVoteTemplateChips"
							:separate-input="true"
							:placeholder="$options.i18n.invalidVoteTemplatesPlaceholder"
						></cdx-chip-input>
					</div>

					<div class="voter-settings-section">
						<h3>{{ $options.i18n.defaultVoteMessagesHeading }}</h3>
						<div class="voter-template-hint">{{ $options.i18n.defaultVoteMessagesHint }}</div>
						<div class="voter-settings-default-message-list">
							<div
								v-for="page in validPageItems"
								:key="page.name"
								class="voter-settings-default-message"
								:data-page-index="page.index"
							>
								<cdx-checkbox v-model="defaultVoteMessageEnabledByPage[page.name]">
									{{ page.label }}
								</cdx-checkbox>
								<div
									v-if="defaultVoteMessageEnabledByPage[page.name]"
									class="voter-settings-default-message__editor"
								>
									<cdx-text-area
										v-model="defaultVoteMessagesByPage[page.name]"
										rows="4"
									></cdx-text-area>
								</div>
							</div>
						</div>
					</div>

					<div class="voter-settings-section voter-settings-section--last">
						<cdx-toggle-switch v-model="largerCodeMirrorHeight" :align-switch="true">
							{{ $options.i18n.largerCodeMirrorHeight }}
							<template #description>
								{{ $options.i18n.largerCodeMirrorHeightDescription }}
							</template>
						</cdx-toggle-switch>
					</div>
				</cdx-dialog>
			`,
		});

		registerCodexComponents(app, Codex);
		mountApp(app);
	}).catch((error: unknown) => {
		console.error("[Voter] 無法加載 Codex:", error);
		mw.notify(state.convByVar({ hant: "無法加載設定對話框組件。", hans: "无法加载设置对话框组件。" }), {
			type: "error",
			title: "[Voter]"
		});
	});
}

/**
 * 打開 Voter 設定對話框。
 * @returns {void}
 */
export function openSettingsDialog(): void {
	const mountedApp = getMountedApp();
	if (mountedApp) removeDialogMount();
	createSettingsDialog();
}

declare global {
	interface Window {
		openVoterSettingsDialog?: () => void;
	}
}

window.openVoterSettingsDialog = openSettingsDialog;
