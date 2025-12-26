import { voteAPI } from "./api";
import state from "./state";
import { openVoteDialog } from "./vote_dialog";

/**
 * 為每個投票區段添加投票按鈕。
 */
export function addVoteButtons() {
	if (document.querySelector('#voter-finished-loading')) {
		return;
	}

	state.sectionTitles = [];

	let headingSelector;
	if (state.pageName === 'Wikipedia:新条目推荐/候选') {
		headingSelector = 'div.mw-heading.mw-heading4';
	} else {
		headingSelector = 'div.mw-heading.mw-heading2';
	}

	$(headingSelector).each((index, element) => {
		let $element = $(element);
		let anchor;
		if (state.pageName === 'Wikipedia:新条目推荐/候选') {
			anchor = $element.nextUntil(headingSelector, 'ul').find('li .anchor').attr('id');
		} else {
			anchor = $element.find('h2').attr('id');
		}

		if (anchor) {
			let sectionID = getSectionID(index + 1);
			const $voteLink = $('<a>').text(state.convByVar({ hant: '投票', hans: '投票' })).css({'cursor': 'pointer', 'margin-left': '0.25em'});
			$voteLink.on('click', (e) => {
				e.preventDefault();
				openVoteDialog(sectionID);
			});
			$('<span class="mw-editsection-bracket">|</span> ').insertAfter($element.find('span.mw-editsection > a').first());
			$voteLink.insertAfter($element.find('span.mw-editsection > a').first().next());

			state.sectionTitles.push({ data: sectionID, label: anchor.replace(/_/g, ' ') });
		}
	});
	console.log(`[Voter] 已識別可投票事項共 ${state.sectionTitles.length} 項。`);

	let finishedLoading = document.createElement('div');
	finishedLoading.id = 'voter-finished-loading';
	finishedLoading.style.display = 'none';
	document.querySelector('#mw-content-text .mw-parser-output')?.appendChild(finishedLoading);
}

/**
 * 取得特定章節編輯編號（支援不同參數位置）。
 * @param childid {number} 章節編號
 * @returns {number} 編輯編號
 */
function getSectionID(childid: number): number {
	try {
		let $heading;
		if (state.pageName === 'Wikipedia:新条目推荐/候选') {
			$heading = $('div.mw-heading.mw-heading4').eq(childid - 1);
		} else {
			$heading = $('div.mw-heading.mw-heading2').eq(childid - 1);
		}

		let $editlink = $heading.find('span.mw-editsection > a');
		let href = $editlink.attr('href');
		if (!href) throw new Error('No href found');

		let match = href.match(/section=(\\d+)/);
		if (match) return +match[1];

		let parts = href.split('&');
		for (let part of parts) {
			if (part.startsWith('section=')) return +part.split('=')[1].replace(/^T-/, '');
		}
	} catch (e) {
		console.log(`[Voter] Failed to get section ID for child ${childid}`);
		throw e;
	}
	return 0;
}

/**
 * 比對標題與文本內容。
 * @param title {string} 標題
 * @returns {string[]} 標題變體
 */
function titleVariants(title: string): string[] {
	let us = title.replace(/ /g, '_');
	let sp = title.replace(/_/g, ' ');
	return [title, us, sp, us.charAt(0).toUpperCase() + us.slice(1), sp.charAt(0).toUpperCase() + sp.slice(1)];
}

/**
 * 比對文本與標題變體。
 * @param text {string} 文本內容
 * @param title {string} 標題
 * @returns {boolean} 是否包含標題變體
 */
export function textMatchTitleVariants(text: string, title: string): boolean {
	return titleVariants(title).some(variant => text.includes(variant));
}

/**
 * 將文字加上縮排。
 * @param text {string} 文字內容
 * @param indent {string} 縮排字串
 * @returns {string} 加上縮排的文字
 */
export function addIndent(text: string, indent: string): string {
	return text.replace(/^/gm, indent);
}

/**
 * 刷新頁面內容。
 * @param entryName {string} 章節名稱
 */
export function refreshPage(entryName: string | undefined) {
	location.href = mw.util.getUrl(state.pageName + '#' + entryName);  // 先跳轉到投票章節，這樣重載後就不會跳到最上面了
	location.reload();
}


/**
 * 投票動作的完整實現。
 * @param voteIDs {number[]} 投票ID
 * @param templates {string[]} 投票模板
 * @param message {string} 投票理由
 * @param useBulleted {boolean} 是否使用 * 縮進
 * @returns {Promise<boolean>} 是否發生衝突
 */
export async function vote(voteIDs: number[], templates: string[], message: string, useBulleted: boolean): Promise<boolean> {
	// event.preventDefault();
	let VTReason = templates.map(str => `{{${str}}}`).join('；');
	message = message.trim();
	VTReason += message ? '：' + message : '。';
	VTReason += '--~~~~';

	for (const id of voteIDs) {
		let votedPageName = state.sectionTitles.find(x => x.data === id)?.label || `section ${id}`;
		let indent = useBulleted ? '* ' : ': ';
		let destPage = state.pageName;

		if (state.pageName === 'Wikipedia:新条目推荐/候选') {
			indent = useBulleted ? '** ' : '*: ';
		} else if (state.pageName === 'Wikipedia:優良條目評選') {
			destPage += '/提名區';
		} else if (/^Wikipedia:(典范条目评选|特色列表评选)$/i.test(state.pageName)) {
			destPage += '/提名区';
		}

		let text = addIndent(VTReason, indent);
		let summary = `/* ${votedPageName} */ `;
		summary += templates.join('、');
		summary += ' ([[User:SuperGrey/gadgets/voter|Voter]])';

		if (await voteAPI(state.pageName, destPage, id, text, summary)) return true;
	}

	// 投票完成，等待1秒鐘後刷新頁面。
	setTimeout(() => refreshPage(state.sectionTitles.find(x => x.data === voteIDs[0])?.label), 1000);
	return false;
}