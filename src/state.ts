type LangDict = { hant: string; hans: string; };
type SectionOption = { data: number; label: string; };
export type TemplateOption = { data: string; label: string; };
export type ValidVotePage = {
	name: string;
	label: string;
	templates: TemplateOption[];
};
export type VoterUserConfig = {
	invalidVoteTemplates: string[];
	defaultVoteMessages: Record<string, string>;
	largerCodeMirrorHeight: boolean;
};

type HanAssistModule = {
	convByVar?: (langDict: LangDict | null) => string;
};

type RequireModuleFn = (moduleName: string) => HanAssistModule;

const DEFAULT_INVALID_VOTE_TEMPLATE_NAMES = ['中立', '意見', '建議', '疑問', '同上', '提醒'];

const VALID_VOTE_PAGES: ValidVotePage[] = [
	{
		name: 'Wikipedia:新条目推荐/候选',
		label: '新条目推荐',
		templates: [
			{ data: '支持', label: '支持' },
			{ data: '反對', label: '反對' },
			{ data: '不合要求', label: '不合要求' },
			{ data: '問題不當', label: '問題不當' },
		],
	},
	{
		name: 'Wikipedia:優良條目評選',
		label: '優良條目評選',
		templates: [
			{ data: 'yesGA', label: '符合優良條目標準' },
			{ data: 'noGA', label: '不符合優良條目標準' },
		],
	},
	{
		name: 'Wikipedia:典范条目评选',
		label: '典范条目评选',
		templates: [
			{ data: 'yesFA', label: '符合典範條目標準' },
			{ data: 'noFA', label: '不符合典範條目標準' },
		],
	},
	{
		name: 'Wikipedia:特色列表评选',
		label: '特色列表评选',
		templates: [
			{ data: 'yesFL', label: '符合特色列表標準' },
			{ data: 'noFL', label: '不符合特色列表標準' },
		],
	},
];

/**
 * 將字串轉為可安全放入正規表達式的 literal。
 * @param {string} value 要轉義的字串
 * @returns {string} 已轉義字串
 */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 正規化模板名稱列表，移除空值、重複值與外層模板括號。
 * @param {unknown} value 原始模板名稱列表
 * @param {string[]} fallback 無效輸入時使用的預設列表
 * @returns {string[]} 正規化後的模板名稱列表
 */
function normalizeTemplateNames(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return fallback.slice();

	const seen = new Set<string>();
	const result: string[] = [];
	for (const rawName of value) {
		if (typeof rawName !== 'string' && typeof rawName !== 'number') continue;
		const name = String(rawName)
			.trim()
			.replace(/^\{\{\s*/, '')
			.replace(/\s*\}\}$/, '');
		if (!name || seen.has(name)) continue;
		seen.add(name);
		result.push(name);
	}
	return result;
}

/**
 * 建立預設使用者設定。
 * @returns {VoterUserConfig} 預設使用者設定
 */
function createDefaultUserConfig(): VoterUserConfig {
	return {
		invalidVoteTemplates: DEFAULT_INVALID_VOTE_TEMPLATE_NAMES.slice(),
		defaultVoteMessages: {},
		largerCodeMirrorHeight: false,
	};
}

/**
 * 全局狀態管理。
 */
class State {
	/**
	 * 簡繁轉換函式，HanAssist 載入前預設回傳繁體。
	 * @param {LangDict | null} langDict 簡繁字串表
	 * @returns {string} 轉換後字串
	 */
	convByVar = (langDict: LangDict | null): string => {
		if (langDict && langDict.hant) {
			return langDict.hant; // 預設返回繁體中文
		}
		return "繁簡轉換未初始化，且 langDict 無效！";
	};

	/**
	 * 初始化 HanAssist 簡繁轉換模組。
	 */
	async initHanAssist(): Promise<void> {
		const requireModule = await mw.loader.using('ext.gadget.HanAssist');
		const hanAssist = (requireModule as RequireModuleFn)('ext.gadget.HanAssist');
		if (hanAssist && typeof hanAssist.convByVar === 'function') {
			this.convByVar = hanAssist.convByVar;
		}
	}

	// 用戶名
	readonly userName = mw.config.get('wgUserName') || 'Example';

	// 頁面名稱
	readonly pageName = mw.config.get('wgPageName');

	/**
	 * 版本號
	 */
	version: string = '4.2.2';

	/**
	 * 支援的投票頁面與其有效投票模板。
	 */
	readonly validVotePages: ValidVotePage[] = VALID_VOTE_PAGES;

	/**
	 * 使用者設定。
	 */
	userConfig: VoterUserConfig = createDefaultUserConfig();

	/**
	 * MediaWiki API 實例。
	 */
	private _api: mw.Api | null = null;

	/**
	 * 取得共用 MediaWiki API 實例。
	 * @returns {mw.Api} MediaWiki API 實例
	 */
	getApi(): mw.Api {
		if (!this._api) {
			this._api = new mw.Api({
				ajax: {
					headers: {
						'User-Agent': `Voter/${this.version}`,
					},
				},
			});
		}
		return this._api;
	}

	/**
	 * 頁面標題
	 * @type {{data: number; label: string;}[]}
	 */
	sectionTitles: SectionOption[] = [];

	/**
	 * 有效投票模板
	 * @type {{data: string; label: string;}[]}
	 */
	validVoteTemplates: TemplateOption[] = [];

	/**
	 * 無效投票模板
	 * @type {{data: string; label: string;}[]}
	 */
	invalidVoteTemplates: TemplateOption[] = [];

	/**
	 * 使用者設定頁面名稱。
	 * @returns {string} 使用者設定頁完整頁名
	 */
	get configPageTitle(): string {
		return `User:${this.userName}/Voter-config.json`;
	}

	/**
	 * 依頁面名稱取得對應的投票頁設定。
	 * @param {string} pageName 頁面名稱
	 * @returns {ValidVotePage | undefined} 投票頁設定
	 */
	getValidVotePage(pageName = this.pageName): ValidVotePage | undefined {
		return this.validVotePages.find((page) => (
			pageName === page.name ||
			new RegExp(`^${escapeRegExp(page.name)}/`, 'i').test(pageName)
		));
	}

	/**
	 * 依目前使用者設定套用頁面專用模板。
	 * @param {string} pageName 頁面名稱
	 * @returns {boolean} 是否為支援的投票頁
	 */
	configureForPage(pageName: string): boolean {
		const page = this.getValidVotePage(pageName);
		if (!page) return false;
		this.validVoteTemplates = page.templates.slice();
		this.invalidVoteTemplates = this.userConfig.invalidVoteTemplates.map((template) => ({
			data: template,
			label: template,
		}));
		return true;
	}

	/**
	 * 正規化使用者設定。
	 * @param {unknown} rawConfig 原始設定
	 * @returns {VoterUserConfig} 正規化設定
	 */
	normalizeUserConfig(rawConfig: unknown): VoterUserConfig {
		const defaults = createDefaultUserConfig();
		if (!rawConfig || typeof rawConfig !== 'object') return defaults;

		const config = rawConfig as Partial<VoterUserConfig>;
		const defaultVoteMessages: Record<string, string> = {};
		if (config.defaultVoteMessages && typeof config.defaultVoteMessages === 'object') {
			for (const page of this.validVotePages) {
				const message = config.defaultVoteMessages[page.name];
				if (typeof message === 'string') {
					defaultVoteMessages[page.name] = message;
				}
			}
		}

		return {
			invalidVoteTemplates: normalizeTemplateNames(config.invalidVoteTemplates, defaults.invalidVoteTemplates),
			defaultVoteMessages,
			largerCodeMirrorHeight: config.largerCodeMirrorHeight === true,
		};
	}

	/**
	 * 套用使用者設定並刷新目前頁面的模板設定。
	 * @param {unknown} rawConfig 原始設定
	 */
	applyUserConfig(rawConfig: unknown): void {
		this.userConfig = this.normalizeUserConfig(rawConfig);
		this.configureForPage(this.pageName);
	}

	/**
	 * 建立可保存到 JSON 頁面的設定快照。
	 * @param {unknown} rawConfig 原始設定
	 * @returns {VoterUserConfig} 正規化設定
	 */
	getSerializableUserConfig(rawConfig: unknown = this.userConfig): VoterUserConfig {
		return this.normalizeUserConfig(rawConfig);
	}

	/**
	 * 取得設定的穩定字串，用於比較是否有變更。
	 * @param {unknown} rawConfig 原始設定
	 * @returns {string} JSON 字串
	 */
	getUserConfigSnapshot(rawConfig: unknown = this.userConfig): string {
		return JSON.stringify(this.getSerializableUserConfig(rawConfig));
	}

	/**
	 * 取得不套用使用者自訂訊息時的預設投票訊息。
	 * @param {string} pageName 頁面名稱
	 * @returns {string} 預設投票訊息
	 */
	getBuiltInDefaultVoteMessage(pageName = this.pageName): string {
		const page = this.getValidVotePage(pageName);
		const templates = page ? page.templates : this.validVoteTemplates;
		return templates.length > 0 ? `{{${templates[0].data}}}。` : "";
	}

	/**
	 * 取得使用者設定後的預設投票訊息。
	 * @param {string} pageName 頁面名稱
	 * @returns {string} 預設投票訊息
	 */
	getDefaultVoteMessage(pageName = this.pageName): string {
		const page = this.getValidVotePage(pageName);
		if (page && Object.prototype.hasOwnProperty.call(this.userConfig.defaultVoteMessages, page.name)) {
			return this.userConfig.defaultVoteMessages[page.name];
		}
		return this.getBuiltInDefaultVoteMessage(pageName);
	}
}

export const state = new State();
export default state;
