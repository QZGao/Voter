import state from "./state";
import { getXToolsInfo } from "./api";
import { buildWikitext } from "./build_comment";
import {
	loadCodexAndVue,
	mountApp,
	removeDialogMount,
	registerCodexComponents,
	getMountedApp
} from "./dialog";
import type { VueModule, CodexModule } from "./dialog";
import { vote } from "./dom";

type EntryOption = { value: number; label: string };
type TemplateOption = { value: string; label: string };
type EntryVoteItem = { id: number; name: string };
type PreviewVoteItem = { id: number; name: string; text: string };
type CodeMirrorRequire = (moduleName: string) => unknown;
type CodeMirrorLike = {
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
type CodeMirrorBinding = {
	cm: CodeMirrorLike;
	textarea: HTMLTextAreaElement;
	onInput: () => void;
};

const entryInfoPromiseCache = new Map<string, Promise<string>>();
const voteMessageCache = new Map<string, string>();
let codeMirrorRequirePromise: Promise<CodeMirrorRequire> | null = null;

/**
 * 根據是否使用項目符號與頁面類型，取得投票內容縮排字串。
 * @param {boolean} useBulleted 是否使用 * 縮排
 * @returns {string} 對應的縮排字串
 */
function getVoteIndent(useBulleted: boolean): string {
	if (state.pageName === 'Wikipedia:新条目推荐/候选') {
		return useBulleted ? '**' : '*:';
	}
	return useBulleted ? '*' : ':';
}

/**
 * 建構最終提交與預覽使用的投票 wikitext。
 * @param {string} rawText 原始投票文字
 * @param {string} indent 縮排字串
 * @returns {string} 處理後的投票 wikitext
 */
function buildFinalVoteWikitext(rawText: string, indent: string): string {
	let finalVoteText = rawText.trim();
	if (!/--~{3,}/.test(finalVoteText)) {
		finalVoteText += '--~~~~';
	}
	return buildWikitext(finalVoteText, indent);
}

/**
 * 獲取條目資訊，使用緩存以避免重複請求。
 * @param {string} entryName 條目名稱
 * @returns {Promise<string>} 條目資訊的HTML內容
 */
function getCachedEntryInfo(entryName: string): Promise<string> {
	const cached = entryInfoPromiseCache.get(entryName);
	if (cached) return cached;

	const pending = getXToolsInfo(entryName).catch((error: unknown) => {
		entryInfoPromiseCache.delete(entryName);
		throw error;
	});
	entryInfoPromiseCache.set(entryName, pending);
	return pending;
}

/**
 * 加載CodeMirror模塊，使用緩存以避免重複加載。
 * @return {Promise<CodeMirrorRequire>} 加載完成後的CodeMirror require函數
 */
function loadCodeMirrorModules(): Promise<CodeMirrorRequire> {
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
 * 根據條目ID獲取條目名稱。
 * @param {number} entryId 條目ID
 * @return {string} 條目名稱，如果未找到則返回空字符串
 */
function getEntryNameById(entryId: number): string {
	return state.sectionTitles.find((x) => x.data === entryId)?.label || "";
}

/**
 * 根據條目ID獲取緩存的投票訊息。
 * @param {number} entryId 條目ID
 * @return {string | undefined} 緩存的投票訊息，如果未找到則返回undefined
 */
function getCachedVoteMessageById(entryId: number): string | undefined {
	const entryName = getEntryNameById(entryId);
	if (!entryName) return undefined;
	return voteMessageCache.get(entryName);
}

/**
 * 根據條目ID設置緩存的投票訊息。
 * @param {number} entryId 條目ID
 * @param {string} message 要緩存的投票訊息
 */
function setCachedVoteMessageById(entryId: number, message: string): void {
	const entryName = getEntryNameById(entryId);
	if (!entryName) return;
	voteMessageCache.set(entryName, message);
}

interface DialogAction {
	label: string;
	actionType?: "primary" | "progressive";
	disabled?: boolean;
}

interface VoteDialogI18n {
	dialogTitle: string;
	submitting: string;
	submit: string;
	cancel: string;
	next: string;
	previous: string;
	selectEntriesHeading: string;
	selectEntriesHint: string;
	insertTemplateHeading: string;
	insertTemplateHint: string;
	voteReasonPlaceholder: string;
	useBulleted: string;
	previewHeading: string;
	previewInfo: string;
	noEntriesSelected: string;
	noVoteContent: string;
}

interface VoteDialogData {
	open: boolean;
	isSubmitting: boolean;
	currentStep: number;
	totalSteps: number;
	selectedEntries: number[];
	entryInfoHtml: string;
	entryInfoById: Record<number, string>;
	isLoadingInfo: boolean;
	voteMessages: Record<number, string>;
	codeMirrorByEntryId: Record<number, CodeMirrorBinding>;
	useBulleted: boolean;
}

interface VoteDialogComputed {
	entryOptions: EntryOption[];
	validTemplateOptions: TemplateOption[];
	invalidTemplateOptions: TemplateOption[];
	allTemplateOptions: TemplateOption[];
	selectedEntryItems: EntryVoteItem[];
	previewVoteItems: PreviewVoteItem[];
	primaryAction: DialogAction;
	defaultAction: DialogAction;
}

type VoteDialogInstance = VoteDialogData & VoteDialogComputed & {
	$options: { i18n: VoteDialogI18n };
	getDefaultVoteMessage: () => string;
	loadEntryInfo: () => Promise<void>;
	syncVoteMessages: () => void;
	syncVoteMessagesFromTextareas: () => void;
	validateStep0: () => boolean;
	validateStep1: () => boolean;
	getVoteTextarea: (entryId: number) => HTMLTextAreaElement | null;
	destroyCodeMirrorForEntry: (entryId: number) => void;
	destroyAllCodeMirror: () => void;
	syncCodeMirrorInstances: () => void;
	initCodeMirrorForEntry: (entryId: number) => Promise<void>;
	insertTemplate: (template: string, entryId: number) => void;
	onPrimaryAction: () => void;
	onDefaultAction: () => void;
	onUpdateOpen: (newValue: boolean) => void;
	closeDialog: () => void;
	submitVote: () => Promise<void>;
};

/**
 * 創建投票對話框。
 * @param {number} sectionID 章節編號
 */
function createVoteDialog(sectionID: number): void {
	loadCodexAndVue().then(({ Vue, Codex }: { Vue: VueModule; Codex: CodexModule }) => {
		const app = Vue.createMwApp({
			i18n: {
				dialogTitle: state.convByVar({
					hant: `投票助手 (Voter v${state.version})`,
					hans: `投票助手 (Voter v${state.version})`
				}),
				submitting: state.convByVar({ hant: "儲存中…", hans: "保存中…" }),
				submit: state.convByVar({ hant: "儲存投票", hans: "保存投票" }),
				cancel: state.convByVar({ hant: "取消", hans: "取消" }),
				next: state.convByVar({ hant: "下一步", hans: "下一步" }),
				previous: state.convByVar({ hant: "上一步", hans: "上一步" }),

				// Step 0: Entry Selection
				selectEntriesHeading: state.convByVar({ hant: "投票條目", hans: "投票条目" }),
				selectEntriesHint: state.convByVar({ hant: "建議在閱讀條目後再投票。", hans: "建议在阅读条目后再投票。" }),

				// Step 1: Per-entry Vote Content
				insertTemplateHeading: state.convByVar({ hant: "投票理由", hans: "投票理由" }),
				insertTemplateHint: state.convByVar({ hant: "模板按鈕會插入到游標所在位置。", hans: "模板按钮会插入到光标所在位置。" }),
				voteReasonPlaceholder: state.convByVar({ hant: "輸入投票內容…", hans: "输入投票内容…" }),
				useBulleted: state.convByVar({ hant: "使用 * 縮排", hans: "使用 * 缩进" }),

				// Step 2: Preview
				previewHeading: state.convByVar({ hant: "預覽投票內容", hans: "预览投票内容" }),
				previewInfo: state.convByVar({ hant: "以下是將要提交的投票內容。", hans: "以下是将要提交的投票内容。" }),

				// Validation
				noEntriesSelected: state.convByVar({ hant: "請選擇至少一個投票條目。", hans: "请选择至少一个投票条目。" }),
				noVoteContent: state.convByVar({ hant: "請輸入投票內容，或先插入模板。", hans: "请输入投票内容，或先插入模板。" })
			},
			data() {
				const defaultVoteMessage = state.validVoteTemplates.length > 0 ? `{{${state.validVoteTemplates[0].data}}}。` : "";
				const initialVoteMessage = getCachedVoteMessageById(sectionID) ?? defaultVoteMessage;
				return {
					open: true,
					isSubmitting: false,
					currentStep: 0,
					totalSteps: 3,

					// Step 0: Entry selection
					selectedEntries: [sectionID],
					entryInfoHtml: "",
					entryInfoById: {},
					isLoadingInfo: false,

					// Step 1: Per-entry vote content
					voteMessages: {
						[sectionID]: initialVoteMessage
					},
					codeMirrorByEntryId: {},
					useBulleted: true
				};
			},
			computed: {
				entryOptions(this: VoteDialogInstance): EntryOption[] {
					return state.sectionTitles.map((item) => ({ value: item.data, label: item.label }));
				},
				validTemplateOptions(this: VoteDialogInstance): TemplateOption[] {
					return (state.validVoteTemplates || []).map((item) => ({ value: item.data, label: item.label }));
				},
				invalidTemplateOptions(this: VoteDialogInstance): TemplateOption[] {
					return (state.invalidVoteTemplates || []).map((item) => ({ value: item.data, label: item.label }));
				},
				allTemplateOptions(this: VoteDialogInstance): TemplateOption[] {
					return [...this.validTemplateOptions, ...this.invalidTemplateOptions];
				},
				selectedEntryItems(this: VoteDialogInstance): EntryVoteItem[] {
					return this.selectedEntries.map((id: number) => {
						const entry = state.sectionTitles.find((x) => x.data === id);
						return { id, name: entry ? entry.label : `Section ${id}` };
					});
				},
				previewVoteItems(this: VoteDialogInstance): PreviewVoteItem[] {
					const indent = getVoteIndent(this.useBulleted);
					return this.selectedEntryItems.map((item: EntryVoteItem) => {
						const message = this.voteMessages[item.id] || "";
						return {
							id: item.id,
							name: item.name,
							text: buildFinalVoteWikitext(message, indent)
						};
					});
				},
				primaryAction(this: VoteDialogInstance): DialogAction {
					if (this.currentStep < this.totalSteps - 1) {
						return { label: this.$options.i18n.next, actionType: "primary", disabled: false };
					}
					return {
						label: this.isSubmitting ? this.$options.i18n.submitting : this.$options.i18n.submit,
						actionType: "progressive",
						disabled: this.isSubmitting
					};
				},
				defaultAction(this: VoteDialogInstance): DialogAction {
					if (this.currentStep > 0) {
						return { label: this.$options.i18n.previous };
					}
					return { label: this.$options.i18n.cancel };
				}
			},
			watch: {
				selectedEntries: {
					handler(this: VoteDialogInstance) {
						if (this.currentStep === 1) {
							this.syncVoteMessagesFromTextareas();
						}
						this.syncVoteMessages();
						void this.loadEntryInfo();
						if (this.currentStep === 1) {
							setTimeout(() => {
								void this.syncCodeMirrorInstances();
							}, 0);
						}
					},
					immediate: true
				},
				currentStep(this: VoteDialogInstance, step: number) {
					if (step === 1) {
						setTimeout(() => {
							void this.syncCodeMirrorInstances();
						}, 0);
					} else {
						this.destroyAllCodeMirror();
					}
				}
			},
			methods: {
				getStepClass(this: VoteDialogInstance, step: number) {
					return { "voter-multistep-dialog__stepper__step--active": step <= this.currentStep };
				},

				getDefaultVoteMessage(this: VoteDialogInstance): string {
					return this.validTemplateOptions.length > 0 ? `{{${this.validTemplateOptions[0].value}}}。` : "";
				},

				syncVoteMessages(this: VoteDialogInstance) {
					const nextMessages: Record<number, string> = {};
					for (const id of this.selectedEntries) {
						if (Object.prototype.hasOwnProperty.call(this.voteMessages, id)) {
							nextMessages[id] = this.voteMessages[id];
						} else {
							nextMessages[id] = getCachedVoteMessageById(id) ?? this.getDefaultVoteMessage();
						}
						setCachedVoteMessageById(id, nextMessages[id]);
					}
					this.voteMessages = nextMessages;
				},

				syncVoteMessagesFromTextareas(this: VoteDialogInstance) {
					const nextMessages: Record<number, string> = { ...this.voteMessages };
					for (const id of this.selectedEntries) {
						const binding = this.codeMirrorByEntryId[id];
						const codeMirrorText = binding?.cm?.view?.state?.doc?.toString();
						if (typeof codeMirrorText === "string") {
							nextMessages[id] = codeMirrorText;
							continue;
						}

						const textarea = this.getVoteTextarea(id);
						if (textarea) {
							nextMessages[id] = textarea.value;
						}
						setCachedVoteMessageById(id, nextMessages[id]);
					}
					this.voteMessages = nextMessages;
				},

				async loadEntryInfo(this: VoteDialogInstance) {
					if (!this.selectedEntries.length) {
						this.entryInfoHtml = "";
						this.entryInfoById = {};
						return;
					}

					this.isLoadingInfo = true;
					const infoPromises: Array<Promise<{ id: number; html: string }>> = this.selectedEntries.map(async (id: number) => {
						const entryName = state.sectionTitles.find((x) => x.data === id)?.label || "";
						if (!entryName) return { id, html: "" };
						const html = await getCachedEntryInfo(entryName);
						return { id, html };
					});

					const results = await Promise.all(infoPromises);
					const nextInfoById: Record<number, string> = {};
					for (const result of results) {
						nextInfoById[result.id] = result.html || "";
					}
					this.entryInfoById = nextInfoById;
					this.entryInfoHtml = this.selectedEntries
						.map((id: number) => this.entryInfoById[id])
						.filter(Boolean)
						.map((html: string) => `<div style="margin-top:0.5em">${html}</div>`)
						.join("");
					this.isLoadingInfo = false;
				},

				validateStep0(this: VoteDialogInstance): boolean {
					if (!this.selectedEntries.length) {
						mw.notify(this.$options.i18n.noEntriesSelected, { type: "error", title: "[Voter]" });
						return false;
					}
					return true;
				},

				validateStep1(this: VoteDialogInstance): boolean {
					this.syncVoteMessagesFromTextareas();
					for (const item of this.selectedEntryItems) {
						if (!(this.voteMessages[item.id] || "").trim()) {
							mw.notify(`${this.$options.i18n.noVoteContent} (${item.name})`, { type: "error", title: "[Voter]" });
							return false;
						}
					}
					return true;
				},

				getVoteTextarea(entryId: number): HTMLTextAreaElement | null {
					const container = document.querySelector(`.voter-entry-vote[data-entry-id="${entryId}"]`);
					return container ? container.querySelector("textarea") : null;
				},

				destroyCodeMirrorForEntry(this: VoteDialogInstance, entryId: number) {
					const binding = this.codeMirrorByEntryId[entryId];
					if (!binding) return;
					binding.textarea.removeEventListener("input", binding.onInput);
					try {
						if (typeof binding.cm.destroy === "function") {
							binding.cm.destroy();
						}
					} catch (error: unknown) {
						console.warn("[Voter] Failed to destroy CodeMirror:", error);
					}
					const nextBindings = { ...this.codeMirrorByEntryId };
					delete nextBindings[entryId];
					this.codeMirrorByEntryId = nextBindings;
				},

				destroyAllCodeMirror(this: VoteDialogInstance) {
					const ids = Object.keys(this.codeMirrorByEntryId).map((id) => Number(id));
					for (const id of ids) {
						this.destroyCodeMirrorForEntry(id);
					}
				},

				async initCodeMirrorForEntry(this: VoteDialogInstance, entryId: number) {
					if (this.codeMirrorByEntryId[entryId]) return;
					const textarea = this.getVoteTextarea(entryId);
					if (!textarea) return;

					try {
						const requireFn = await loadCodeMirrorModules();
						const CodeMirrorCtor = requireFn("ext.CodeMirror.v6") as new (textareaEl: HTMLTextAreaElement, modeExt: unknown) => CodeMirrorLike;
						const modeModule = requireFn("ext.CodeMirror.v6.mode.mediawiki") as { mediawiki?: () => unknown };
						const mode = typeof modeModule.mediawiki === "function" ? modeModule.mediawiki() : undefined;
						if (!CodeMirrorCtor || !mode) return;

						const cm = new CodeMirrorCtor(textarea, mode);
						cm.initialize();

						const onInput = () => {
							this.voteMessages = {
								...this.voteMessages,
								[entryId]: textarea.value
							};
						};
						textarea.addEventListener("input", onInput);

						this.codeMirrorByEntryId = {
							...this.codeMirrorByEntryId,
							[entryId]: { cm, textarea, onInput }
						};
					} catch (error: unknown) {
						console.warn("[Voter] CodeMirror initialization failed, fallback to textarea.", error);
					}
				},

				async syncCodeMirrorInstances(this: VoteDialogInstance) {
					if (this.currentStep !== 1) return;
					const selectedIdSet = new Set(this.selectedEntries);
					for (const key of Object.keys(this.codeMirrorByEntryId)) {
						const id = Number(key);
						if (!selectedIdSet.has(id)) {
							this.destroyCodeMirrorForEntry(id);
						}
					}
					for (const id of this.selectedEntries) {
						await this.initCodeMirrorForEntry(id);
					}
				},

				insertTemplate(this: VoteDialogInstance, template: string, entryId: number) {
					const templateText = `{{${template}}}`;
					const binding = this.codeMirrorByEntryId[entryId];
					const view = binding?.cm?.view;
					const selection = view?.state?.selection?.main;
					if (view && selection && typeof view.dispatch === "function") {
						view.dispatch({
							changes: {
								from: selection.from,
								to: selection.to,
								insert: templateText
							},
							selection: { anchor: selection.from + templateText.length }
						});
						const updated = view.state?.doc?.toString() || "";
						this.voteMessages = {
							...this.voteMessages,
							[entryId]: updated
						};
						setCachedVoteMessageById(entryId, updated);
						if (typeof view.focus === "function") {
							view.focus();
						}
						return;
					}

					const current = this.voteMessages[entryId] || "";
					const textArea = this.getVoteTextarea(entryId);
					if (!textArea) {
						this.voteMessages = {
							...this.voteMessages,
							[entryId]: `${current}${templateText}`
						};
						setCachedVoteMessageById(entryId, `${current}${templateText}`);
						return;
					}

					const start = textArea.selectionStart ?? current.length;
					const end = textArea.selectionEnd ?? start;
					this.voteMessages = {
						...this.voteMessages,
						[entryId]: `${current.slice(0, start)}${templateText}${current.slice(end)}`
					};
					setCachedVoteMessageById(entryId, `${current.slice(0, start)}${templateText}${current.slice(end)}`);

					setTimeout(() => {
						const focusedTextArea = this.getVoteTextarea(entryId);
						if (!focusedTextArea) return;
						const nextCursor = start + templateText.length;
						focusedTextArea.focus();
						focusedTextArea.setSelectionRange(nextCursor, nextCursor);
					}, 0);
				},

				onPrimaryAction(this: VoteDialogInstance) {
					// Validate current step before advancing
					if (this.currentStep === 0 && !this.validateStep0()) {
						return;
					}
					if (this.currentStep === 1 && !this.validateStep1()) {
						return;
					}

					// Advance step or submit
					if (this.currentStep < this.totalSteps - 1) {
						this.currentStep++;
						return;
					}

					// Final step: submit vote
					void this.submitVote();
				},

				onDefaultAction(this: VoteDialogInstance) {
					if (this.currentStep > 0) {
						this.currentStep--;
						return;
					}
					this.closeDialog();
				},

				onUpdateOpen(this: VoteDialogInstance, newValue: boolean) {
					if (!newValue) {
						this.closeDialog();
					}
				},

				closeDialog(this: VoteDialogInstance) {
					this.destroyAllCodeMirror();
					this.open = false;
					setTimeout(() => {
						removeDialogMount();
					}, 300);
				},

				async submitVote(this: VoteDialogInstance) {
					this.isSubmitting = true;
					this.syncVoteMessagesFromTextareas();

					try {
						const indent = getVoteIndent(this.useBulleted);
						const builtVoteTexts = this.selectedEntries.reduce((acc: Record<number, string>, id: number) => {
							acc[id] = buildFinalVoteWikitext(this.voteMessages[id] || "", indent);
							return acc;
						}, {});
						const hasConflict = await vote(this.selectedEntries, builtVoteTexts, this.voteMessages);

						if (hasConflict) {
							this.isSubmitting = false;
							return;
						}

						mw.notify(state.convByVar({ hant: "投票已成功提交。", hans: "投票已成功提交。" }), { tag: "voter" });
						this.isSubmitting = false;
						this.open = false;

						setTimeout(() => {
							removeDialogMount();
						}, 300);
					} catch (error: unknown) {
						console.error("[Voter] submitVote failed:", error);
						const msg = state.convByVar({ hant: "投票提交失敗，請稍後再試。", hans: "投票提交失败，请稍后再试。" });
						mw.notify(msg, { type: "error", title: "[Voter]" });
						this.isSubmitting = false;
					}
				}
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
                    class="voter-dialog voter-multistep-dialog"
                >
                    <template #header>
                        <div class="voter-multistep-dialog__header-top">
                            <h2>{{ $options.i18n.dialogTitle }}</h2>
                        </div>

                        <div class="voter-multistep-dialog__stepper">
                            <div class="voter-multistep-dialog__stepper__label">{{ (currentStep + 1) + ' / ' + totalSteps }}</div>
                            <div class="voter-multistep-dialog__stepper__steps" aria-hidden="true">
                                <span
                                    v-for="step of [0, 1, 2]"
                                    :key="step"
                                    class="voter-multistep-dialog__stepper__step"
                                    :class="getStepClass(step)"
                                ></span>
                            </div>
                        </div>
                    </template>

                    <div v-if="currentStep === 0" class="voter-form-section">
                        <h3>{{ $options.i18n.selectEntriesHeading }}</h3>
                        <div class="voter-template-hint">{{ $options.i18n.selectEntriesHint }}</div>
                        <div class="voter-checkbox-grid">
                            <cdx-checkbox
                                v-for="option in entryOptions"
                                :key="option.value"
                                v-model="selectedEntries"
                                :input-value="option.value"
                            >
                                {{ option.label }}
                            </cdx-checkbox>
                        </div>

                        <div
                            v-if="entryInfoHtml"
                            class="voter-entry-info"
                            v-html="entryInfoHtml"
                        ></div>
                        <div v-else-if="isLoadingInfo" class="voter-entry-info voter-entry-info--loading">
                            載入中...
                        </div>
                    </div>

                    <div v-else-if="currentStep === 1" class="voter-form-section">
						<h3>{{ $options.i18n.insertTemplateHeading }}</h3>
                        <div class="voter-template-hint">{{ $options.i18n.insertTemplateHint }}</div>

                        <div
                            v-for="item in selectedEntryItems"
                            :key="item.id"
                            class="voter-entry-vote"
                            :data-entry-id="item.id"
                        >
                            <div class="voter-entry-vote__title">{{ item.name }}</div>
                            <div class="voter-template-buttons">
                                <cdx-button
                                    v-for="option in allTemplateOptions"
                                    :key="option.value"
                                    @click="insertTemplate(option.value, item.id)"
                                >
                                    {{ option.label }}
                                </cdx-button>
                            </div>
                            <cdx-text-area
                                v-model="voteMessages[item.id]"
                                :placeholder="$options.i18n.voteReasonPlaceholder"
                                rows="3"
                            ></cdx-text-area>
                            <div
                                v-if="entryInfoById[item.id]"
                                class="voter-entry-info voter-entry-info--inline"
                                v-html="entryInfoById[item.id]"
                            ></div>
                        </div>

                        <div class="voter-form-section" style="padding-bottom: 0;">
                            <cdx-checkbox v-model="useBulleted">
                                {{ $options.i18n.useBulleted }}
                            </cdx-checkbox>
                        </div>
                    </div>

                    <div v-else-if="currentStep === 2" class="voter-preview-section">
                        <h3>{{ $options.i18n.previewHeading }}</h3>
                        <div class="voter-template-hint">{{ $options.i18n.previewInfo }}</div>

                        <div
                            v-for="item in previewVoteItems"
                            :key="item.id"
                            class="voter-preview-item"
                        >
                            <strong>{{ item.name }}</strong>
                            <pre class="voter-preview-code">{{ item.text }}</pre>
                        </div>
                    </div>
                </cdx-dialog>
            `
		});

		registerCodexComponents(app, Codex);
		mountApp(app);
	}).catch((error: unknown) => {
		console.error("[Voter] 無法加載 Codex:", error);
		mw.notify(state.convByVar({ hant: "無法加載對話框組件。", hans: "无法加载对话框组件。" }), {
			type: "error",
			title: "[Voter]"
		});
	});
}

/**
 * 打開投票對話框。
 * @param {number} sectionID 章節編號
 */
export function openVoteDialog(sectionID: number): void {
	const mountedApp = getMountedApp();
	if (mountedApp) removeDialogMount();
	createVoteDialog(sectionID);
}

// Expose to global scope for legacy compatibility
declare global {
	interface Window {
		openVoteDialog?: (sectionID: number) => void;
	}
}

window.openVoteDialog = openVoteDialog;
