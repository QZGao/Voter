import { addVoteButtons } from "./dom";
import state from "./state";
import styles from './styles.css';

/**
 * 將 CSS 樣式注入到頁面中。
 * @param css {string} 要注入的 CSS 樣式
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
	const validPages = [
		{
			name: 'Wikipedia:新条目推荐/候选',
			templates: [
				{ data: '支持', label: '支持' },
				{ data: '反對', label: '反對' },
				{ data: '不合要求', label: '不合要求' },
				{ data: '問題不當', label: '問題不當' },
			],
		}, {
			name: 'Wikipedia:優良條目評選',
			templates: [
				{ data: 'yesGA', label: '符合優良條目標準' },
				{ data: 'noGA', label: '不符合優良條目標準' },
			],
		}, {
			name: 'Wikipedia:典范条目评选',
			templates: [
				{ data: 'yesFA', label: '符合典範條目標準' },
				{ data: 'noFA', label: '不符合典範條目標準' },
			],
		}, {
			name: 'Wikipedia:特色列表评选',
			templates: [
				{ data: 'yesFL', label: '符合特色列表標準' },
				{ data: 'noFL', label: '不符合特色列表標準' },
			],
		},
	];

	for (const page of validPages) {
		if (pageName === page.name || new RegExp(`^${page.name}/`, 'i').test(pageName)) {
			state.validVoteTemplates = page.templates;
			state.invalidVoteTemplates = [
				'中立', '意見', '建議', '疑問', '同上', '提醒'
			].map(template => ({
				data: template, label: template,
			}));
			return true;
		}
	}
	return false;
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
	console.log(`[Voter] 已載入，當前頁面為 ${state.pageName}。`);
	mw.hook('wikipage.content').add(() => {
		setTimeout(() => addVoteButtons(), 200);  // 等待編輯按鈕載入
	});
}

void init();
