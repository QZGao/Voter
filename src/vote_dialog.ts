import state from "./state";
import { getXToolsInfo } from "./api";
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

interface DialogAction {
	label: string;
	actionType?: 'primary' | 'progressive';
	disabled?: boolean;
}

interface VoteDialogI18n {
	dialogTitle: string;
	submitting: string;
	submit: string;
	cancel: string;
	next: string;
	previous: string;
	selectEntries: string;
	selectEntriesPlaceholder: string;
	selectTemplates: string;
	insertTemplateHint: string;
	voteReason: string;
	voteReasonPlaceholder: string;
	useBulleted: string;
	previewHeading: string;
	previewInfo: string;
	votingFor: string;
	voteContent: string;
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
	isLoadingInfo: boolean;
	voteMessage: string;
	useBulleted: boolean;
}

interface VoteDialogComputed {
	entryOptions: EntryOption[];
	validTemplateOptions: TemplateOption[];
	invalidTemplateOptions: TemplateOption[];
	allTemplateOptions: TemplateOption[];
	selectedEntryNames: string[];
	previewVoteText: string;
	primaryAction: DialogAction;
	defaultAction: DialogAction;
}

type VoteDialogInstance = VoteDialogData & VoteDialogComputed & {
	$options: { i18n: VoteDialogI18n };
	loadEntryInfo: () => Promise<void>;
	validateStep0: () => boolean;
	validateStep1: () => boolean;
	getVoteTextarea: () => HTMLTextAreaElement | null;
	insertTemplate: (template: string) => void;
	onPrimaryAction: () => void;
	onDefaultAction: () => void;
	onUpdateOpen: (newValue: boolean) => void;
	closeDialog: () => void;
	submitVote: () => Promise<void>;
};

/**
 * 創建投票對話框。
 * @param sectionID 章節編號
 */
function createVoteDialog(sectionID: number): void {
	loadCodexAndVue().then(({ Vue, Codex }: { Vue: VueModule; Codex: CodexModule }) => {
		const app = Vue.createMwApp({
			i18n: {
				dialogTitle: state.convByVar({
					hant: `投票助手 (Voter v${state.version})`,
					hans: `投票助手 (Voter v${state.version})`
				}),
				submitting: state.convByVar({ hant: '儲存中…', hans: '保存中…' }),
				submit: state.convByVar({ hant: '儲存投票', hans: '保存投票' }),
				cancel: state.convByVar({ hant: '取消', hans: '取消' }),
				next: state.convByVar({ hant: '下一步', hans: '下一步' }),
				previous: state.convByVar({ hant: '上一步', hans: '上一步' }),

				// Step 0: Entry Selection
				selectEntries: state.convByVar({ hant: '投票條目', hans: '投票条目' }),
				selectEntriesPlaceholder: state.convByVar({ hant: '選擇要投票的條目', hans: '选择要投票的条目' }),

				// Step 1: Template Selection
				selectTemplates: state.convByVar({ hant: '投票模板', hans: '投票模板' }),
				insertTemplateHint: state.convByVar({ hant: '點擊模板按鈕可插入到下方文字框', hans: '点击模板按钮可插入到下方文本框' }),
				voteReason: state.convByVar({ hant: '投票內容（無須簽名）', hans: '投票内容（无须签名）' }),
				voteReasonPlaceholder: state.convByVar({ hant: '輸入投票內容…', hans: '输入投票内容…' }),
				useBulleted: state.convByVar({ hant: '使用 * 縮排', hans: '使用 * 缩进' }),

				// Step 2: Preview
				previewHeading: state.convByVar({ hant: '預覽投票內容', hans: '预览投票内容' }),
				previewInfo: state.convByVar({ hant: '以下是將要提交的投票內容：', hans: '以下是将要提交的投票内容：' }),
				votingFor: state.convByVar({ hant: '投票條目：', hans: '投票条目：' }),
				voteContent: state.convByVar({ hant: '投票內容：', hans: '投票内容：' }),

				// Validation
				noEntriesSelected: state.convByVar({ hant: '請選擇至少一個投票條目。', hans: '请选择至少一个投票条目。' }),
				noVoteContent: state.convByVar({ hant: '請輸入投票內容，或先插入模板。', hans: '请输入投票内容，或先插入模板。' }),
			},
			data() {
				return {
					open: true,
					isSubmitting: false,
					currentStep: 0,
					totalSteps: 3,

					// Step 0: Entry selection
					selectedEntries: [sectionID],
					entryInfoHtml: '',
					isLoadingInfo: false,

					// Step 1: Template & reason
					voteMessage: state.validVoteTemplates.length > 0 ? `{{${state.validVoteTemplates[0].data}}}。` : '',
					useBulleted: true,
				};
			},
			computed: {
				entryOptions(this: VoteDialogInstance): EntryOption[] {
					return state.sectionTitles.map(item => ({ value: item.data, label: item.label }));
				},
				validTemplateOptions(this: VoteDialogInstance): TemplateOption[] {
					return (state.validVoteTemplates || []).map(item => ({ value: item.data, label: item.label }));
				},
				invalidTemplateOptions(this: VoteDialogInstance): TemplateOption[] {
					return (state.invalidVoteTemplates || []).map(item => ({ value: item.data, label: item.label }));
				},
				allTemplateOptions(this: VoteDialogInstance): TemplateOption[] {
					return [...this.validTemplateOptions, ...this.invalidTemplateOptions];
				},
				selectedEntryNames(this: VoteDialogInstance): string[] {
					return this.selectedEntries.map((id: number) => {
						const entry = state.sectionTitles.find(x => x.data === id);
						return entry ? entry.label : `Section ${id}`;
					});
				},
				previewVoteText(this: VoteDialogInstance): string {
					const message = (this.voteMessage || '').trim();
					return message ? `${message}--~~~~` : '--~~~~';
				},
				primaryAction(this: VoteDialogInstance): DialogAction {
					if (this.currentStep < this.totalSteps - 1) {
						return { label: this.$options.i18n.next, actionType: 'primary', disabled: false };
					}
					return {
						label: this.isSubmitting ? this.$options.i18n.submitting : this.$options.i18n.submit,
						actionType: 'progressive',
						disabled: this.isSubmitting
					};
				},
				defaultAction(this: VoteDialogInstance): DialogAction {
					if (this.currentStep > 0) {
						return { label: this.$options.i18n.previous };
					}
					return { label: this.$options.i18n.cancel };
				},
			},
			watch: {
				selectedEntries: {
					handler(this: VoteDialogInstance) {
						void this.loadEntryInfo();
					},
					immediate: true,
				},
			},
			methods: {
				getStepClass(this: VoteDialogInstance, step: number) {
					return { 'voter-multistep-dialog__stepper__step--active': step <= this.currentStep };
				},

				async loadEntryInfo(this: VoteDialogInstance) {
					if (!this.selectedEntries.length) {
						this.entryInfoHtml = '';
						return;
					}

					this.isLoadingInfo = true;
					const infoPromises: Array<Promise<string>> = this.selectedEntries.map(async (id: number) => {
						const entryName = state.sectionTitles.find(x => x.data === id)?.label || '';
						if (!entryName) return '';
						return getXToolsInfo(entryName);
					});

					const results = await Promise.all(infoPromises);
					const filteredResults = results.filter((html): html is string => Boolean(html));
					this.entryInfoHtml = filteredResults.map(html => `<div style="margin-top:0.5em">${html}</div>`).join('');
					this.isLoadingInfo = false;
				},

				validateStep0(this: VoteDialogInstance): boolean {
					if (!this.selectedEntries.length) {
						mw.notify(this.$options.i18n.noEntriesSelected, { type: 'error', title: '[Voter]' });
						return false;
					}
					return true;
				},

				validateStep1(this: VoteDialogInstance): boolean {
					if (!(this.voteMessage || '').trim()) {
						mw.notify(this.$options.i18n.noVoteContent, { type: 'error', title: '[Voter]' });
						return false;
					}
					return true;
				},

				getVoteTextarea(): HTMLTextAreaElement | null {
					return document.querySelector('.voter-dialog textarea');
				},

				insertTemplate(this: VoteDialogInstance, template: string) {
					const templateText = `{{${template}}}`;
					const current = this.voteMessage || '';
					const textArea = this.getVoteTextarea();
					if (!textArea) {
						this.voteMessage = `${current}${templateText}`;
						return;
					}

					const start = textArea.selectionStart ?? current.length;
					const end = textArea.selectionEnd ?? start;
					this.voteMessage = `${current.slice(0, start)}${templateText}${current.slice(end)}`;

					setTimeout(() => {
						const focusedTextArea = this.getVoteTextarea();
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
					this.open = false;
					setTimeout(() => {
						removeDialogMount();
					}, 300);
				},

				async submitVote(this: VoteDialogInstance) {
					this.isSubmitting = true;

					try {
						const hasConflict = await vote(
							this.selectedEntries,
							this.voteMessage,
							this.useBulleted
						);

						if (hasConflict) {
							this.isSubmitting = false;
							return;
						}

						// Vote completed successfully
						mw.notify(state.convByVar({ hant: '投票已成功提交。', hans: '投票已成功提交。' }), { tag: 'voter' });
						this.isSubmitting = false;
						this.open = false;

						setTimeout(() => {
							removeDialogMount();
						}, 300);

					} catch (error: unknown) {
						console.error('[Voter] submitVote failed:', error);
						const msg = state.convByVar({ hant: '投票提交失敗，請稍後再試。', hans: '投票提交失败，请稍后再试。' });
						mw.notify(msg, { type: 'error', title: '[Voter]' });
						this.isSubmitting = false;
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

                    <!-- Step 0: Entry Selection -->
                    <div v-if="currentStep === 0" class="voter-form-section">
                        <label class="voter-form-label">{{ $options.i18n.selectEntries }}</label>
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

                    <!-- Step 1: Template Selection & Reason -->
                    <div v-else-if="currentStep === 1" class="voter-form-section">
                        <label class="voter-form-label">{{ $options.i18n.selectTemplates }}</label>
                        <div class="voter-template-hint">{{ $options.i18n.insertTemplateHint }}</div>
                        <div class="voter-template-buttons">
                            <cdx-button
                                v-for="option in allTemplateOptions"
                                :key="option.value"
                                @click="insertTemplate(option.value)"
                            >
                                {{ option.label }}
                            </cdx-button>
                        </div>

                        <div class="voter-form-section">
                            <label class="voter-form-label">{{ $options.i18n.voteReason }}</label>
                            <cdx-text-area
                                v-model="voteMessage"
                                :placeholder="$options.i18n.voteReasonPlaceholder"
                                rows="3"
                            ></cdx-text-area>
                        </div>

                        <div class="voter-form-section" style="padding-top: 0;">
                            <cdx-checkbox v-model="useBulleted">
                                {{ $options.i18n.useBulleted }}
                            </cdx-checkbox>
                        </div>
                    </div>

                    <!-- Step 2: Preview -->
                    <div v-else-if="currentStep === 2" class="voter-preview-section">
                        <h3>{{ $options.i18n.previewHeading }}</h3>
                        <p>{{ $options.i18n.previewInfo }}</p>

                        <div class="voter-preview-item">
                            <strong>{{ $options.i18n.votingFor }}</strong>
                            <ul>
                                <li v-for="name in selectedEntryNames" :key="name">{{ name }}</li>
                            </ul>
                        </div>

                        <div class="voter-preview-item">
                            <strong>{{ $options.i18n.voteContent }}</strong>
                            <pre class="voter-preview-code">{{ previewVoteText }}</pre>
                        </div>
                    </div>
                </cdx-dialog>
            `,
		});

		registerCodexComponents(app, Codex);
		mountApp(app);
	}).catch((error: unknown) => {
		console.error('[Voter] 無法加載 Codex:', error);
		mw.notify(state.convByVar({ hant: '無法加載對話框組件。', hans: '无法加载对话框组件。' }), {
			type: 'error',
			title: '[Voter]'
		});
	});
}

/**
 * 打開投票對話框。
 * @param sectionID 章節編號
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
