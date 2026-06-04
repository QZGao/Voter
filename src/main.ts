import { addVoteButtons } from "./dom";
import state from "./state";
import { loadUserConfig } from "./user_config";
import styles from './styles.css';

/**
 * 將 CSS 樣式注入到頁面中。
 * @param {string} css 要注入的 CSS 樣式
 */
function injectStyles(css: string): void {
	if (!css) return;
	try {
		const styleEl = document.createElement('style');
		styleEl.appendChild(document.createTextNode(css));
		document.head.appendChild(styleEl);
	} catch {
		// Fallback for older environments
		const div = document.createElement('div');
		div.innerHTML = `<style>${css}</style>`;
		const styleEl = div.firstElementChild as HTMLElement | null;
		if (styleEl) {
			document.head.appendChild(styleEl);
		}
	}
}

/**
 * 驗證是否為投票頁面，並設置投票模板。
 * @returns {boolean} 是否為有效的投票頁面
 */
function validatePage(pageName: string): boolean {
	return state.configureForPage(pageName);
}

/**
 * 小工具入口。
 */
async function init(): Promise<void> {
	// Inject bundled CSS into the page.
	if (typeof document !== 'undefined') {
		injectStyles(styles);
	}

	// 檢查當前頁面是否為目標頁面；不是則終止小工具。
	if (!validatePage(state.pageName)) {
		console.log('[Voter] 不是目標頁面，小工具終止。');
		return;
	}

	await state.initHanAssist();
	await loadUserConfig();
	console.log(`[Voter] 已載入，當前頁面為 ${state.pageName}。`);
	mw.hook('wikipage.content').add(() => {
		setTimeout(() => addVoteButtons(), 200);  // 等待編輯按鈕載入
	});
}

void init();
