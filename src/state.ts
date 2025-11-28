declare var mw: any;

/**
 * 全局狀態管理。
 */
class State {
	// 簡繁轉換
	convByVar = function (langDict: any) {
		if (langDict && langDict.hant) {
			return langDict.hant; // 預設返回繁體中文
		}
		return "繁簡轉換未初始化，且 langDict 無效！";
	};
	initHanAssist(): Promise<void> {
		return mw.loader.using('ext.gadget.HanAssist').then((require) => {
			const { convByVar } = require('ext.gadget.HanAssist');
			if (typeof convByVar === 'function') {
				this.convByVar = convByVar;
			}
		});
	}

	// 用戶名
	readonly userName = mw.config.get('wgUserName') || 'Example';

	// 頁面名稱
	readonly pageName = mw.config.get('wgPageName');

	/**
	 * 版本號
	 */
	version: string = '4.2.0';

	// MediaWiki API 實例
	private _api: any = null;
	getApi() {
		if (!this._api) {
			this._api = new mw.Api({ 'User-Agent': `ReviewTool/${this.version}` });
		}
		return this._api;
	}

	/**
	 * 頁面標題
	 * @type {{data: number; label: string;}[]}
	 */
	sectionTitles: {
		data: number;
		label: string;
	}[];

	/**
	 * 有效投票模板
	 * @type {{data: string; label: string;}[]}
	 */
	validVoteTemplates: {
		data: string;
		label: string;
	}[];

	/**
	 * 無效投票模板
	 * @type {{data: string; label: string;}[]}
	 */
	invalidVoteTemplates: {
		data: string;
		label: string;
	}[];
}

export const state = new State();
export default state;