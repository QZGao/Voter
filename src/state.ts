type LangDict = { hant: string; hans: string; };
type SectionOption = { data: number; label: string; };
type TemplateOption = { data: string; label: string; };

type HanAssistModule = {
	convByVar?: (langDict: LangDict | null) => string;
};

type RequireModuleFn = (moduleName: string) => HanAssistModule;

/**
 * 全局狀態管理。
 */
class State {
	// 簡繁轉換
	convByVar = (langDict: LangDict | null): string => {
		if (langDict && langDict.hant) {
			return langDict.hant; // 預設返回繁體中文
		}
		return "繁簡轉換未初始化，且 langDict 無效！";
	};
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

	// MediaWiki API 實例
	private _api: mw.Api | null = null;
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
}

export const state = new State();
export default state;
