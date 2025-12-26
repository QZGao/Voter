import { textMatchTitleVariants } from "./dom";
import state from "./state";
import type { UnknownApiParams } from "types-mediawiki/api_params";

interface XToolsAssessment {
	value: string;
	badge: string;
}

interface XToolsPageInfo {
	project: string;
	page: string;
	created_rev_id: number;
	modified_rev_id: number;
	pageviews_offset: number;
	creator: string;
	created_at: string;
	revisions: number;
	editors: number;
	watchers: number;
	pageviews: number;
	secs_since_last_edit: number;
	creator_editcount?: number;
	assessment: XToolsAssessment;
}

interface VotePageRevisionSlot {
	main: Record<string, string>;
}

interface VotePageRevision {
	slots: VotePageRevisionSlot;
}

interface VotePage {
	revisions: VotePageRevision[];
}

interface VotePageQueryResponse {
	query: {
		pageids: string[];
		pages: Record<string, VotePage>;
	};
}

/**
 * 獲取XTools頁面資訊。無法獲取時按下不表，返回空字串。
 * @param pageName {string} 頁面名稱
 * @returns {Promise<string>} XTools頁面資訊。
 */
export async function getXToolsInfo(pageName: string): Promise<string> {
	const safeToLocaleString = (value: unknown): string => {
		if (typeof value === 'number' && !isNaN(value)) {
			return value.toLocaleString();
		}
		return '0';
	};

	try {
		const pageInfo = await $.get('https://xtools.wmcloud.org/api/page/pageinfo/' + mw.config.get('wgServerName') + '/' + pageName.replace(/["?%&+\\]/g, escape)) as XToolsPageInfo;

		const project = pageInfo.project;
		const pageEnc = encodeURIComponent(pageInfo.page);
		const pageUrl = `https://${project}/wiki/${pageInfo.page}`;
		const pageinfoUrl = `https://xtools.wmcloud.org/pageinfo/${project}/${pageEnc}`;
		const permaLinkUrl = `https://${project}/wiki/Special:PermaLink%2F${pageInfo.created_rev_id}`;
		const diffUrl = `https://${project}/wiki/Special:Diff%2F${pageInfo.modified_rev_id}`;
		const pageviewsUrl = `https://pageviews.wmcloud.org/?project=${project}&pages=${pageEnc}&range=latest-${pageInfo.pageviews_offset}`;
		const creatorLink = `https://${project}/wiki/User:${pageInfo.creator}`;
		const creatorContribsUrl = `https://${project}/wiki/Special:Contributions/${pageInfo.creator}`;
		const createdDate = new Date(pageInfo.created_at).toISOString().split('T')[0];
		const revisionsText = safeToLocaleString(pageInfo.revisions);
		const editorsText = safeToLocaleString(pageInfo.editors);
		const watchersText = safeToLocaleString(pageInfo.watchers);
		const pageviewsText = safeToLocaleString(pageInfo.pageviews);
		const days = Math.round(pageInfo.secs_since_last_edit / 86400);

		let creatorText = '';
		if (pageInfo.creator_editcount) {
			creatorText = `<bdi><a href="${creatorLink}" target="_blank">${pageInfo.creator}</a></bdi> (<a href="${creatorContribsUrl}" target="_blank">${safeToLocaleString(pageInfo.creator_editcount)}</a>)`;
		} else {
			creatorText = `<bdi><a href="${creatorContribsUrl}" target="_blank">${pageInfo.creator}</a></bdi>`;
		}
		let pageCreationText = `「<a target="_blank" title="評級: ${pageInfo.assessment.value}" href="${pageinfoUrl}"><img src="${pageInfo.assessment.badge}" style="height:16px !important; vertical-align:-4px; margin-right:3px"/></a><bdi><a target="_blank" href="${pageUrl}">${pageInfo.page}</a></bdi>」由 ${creatorText} 於 <bdi><a target='_blank' href='${permaLinkUrl}'>${createdDate}</a></bdi> 建立，共 ${revisionsText} 個修訂，最後修訂於 <a href="${diffUrl}">${days} 天</a>前。`;
		let pageEditorsText = `共 ${editorsText} 編輯者` + (watchersText !== '0' ? `、${watchersText} 監視者` : '') + `，最近 ${pageInfo.pageviews_offset} 天共 <a target="_blank" href="${pageviewsUrl}">${pageviewsText} 瀏覽數</a>。`;

		return `<span style="line-height:20px">${pageCreationText}${pageEditorsText}<a target="_blank" href="${pageinfoUrl}">檢視完整頁面統計</a>。</span>`.trim();
	} catch (error: unknown) {
		console.error('[Voter] Error fetching XTools data:', error);
		return '<span style="color: red; font-weight: bold;">無法獲取 XTools 頁面資訊。</span>';
	}
}

/**
 * 單次處理投票寫入並檢查衝突。
 * @param tracePage {string} 追蹤頁面
 * @param destPage {string} 目標頁面
 * @param sectionID {number} 章節編號
 * @param text {string} 投票內容
 * @param summary {string} 編輯摘要
 * @returns {Promise<boolean>} 是否發生衝突
 */
export async function voteAPI(tracePage: string, destPage: string, sectionID: number, text: string, summary: string): Promise<boolean> {
	const votedPageName = state.sectionTitles.find(x => x.data === sectionID)?.label || `section ${sectionID}`;
	mw.notify(`正在為「${votedPageName}」投出一票⋯⋯`);

	const res = await state.getApi().get({
		action: 'query',
		titles: destPage,
		prop: 'revisions|info',
		rvslots: '*',
		rvprop: 'content',
		rvsection: sectionID,
		indexpageids: 1,
	}) as VotePageQueryResponse;

	const firstPageId = res.query.pageids[0];
	const page = res.query.pages[firstPageId];
	const firstRevision = page?.revisions?.[0];
	const sectionText = firstRevision?.slots.main['*'];

	if (sectionText === undefined || sectionText === '') {
		console.log(`[Voter] 無法取得「${votedPageName}」的投票區段內容。區段ID：${sectionID}。API 回傳：`, res);
		mw.notify(`無法取得「${votedPageName}」的投票區段內容，請刷新後重試。`);
		return true;
	}

	if (!textMatchTitleVariants(sectionText, votedPageName)) {
		console.log(`[Voter] 在「${votedPageName}」的投票區段中找不到該條目。區段文本：`, sectionText);
		mw.notify(`在該章節找不到名為「${votedPageName}」的提名，請刷新後重試。`);
		return true;
	}

	// 處理內部有小標題的情況（例如獨立的評審章節）。
	let innerHeadings: RegExpMatchArray | null;
	if (tracePage === 'Wikipedia:新条目推荐/候选') {
		innerHeadings = sectionText.match(/=====.+?=====/g);
	} else {
		innerHeadings = sectionText.match(/===.+?===/g);
	}

	const targetSection = innerHeadings ? sectionID + 1 : sectionID;
	const editParams: UnknownApiParams = {
		action: 'edit',
		title: destPage,
		section: targetSection,
		summary,
		token: mw.user.tokens.get('csrfToken'),
	};

	if (innerHeadings) {
		editParams.prependtext = `${text}\n`;
	} else {
		editParams.appendtext = `\n${text}`;
	}

	await state.getApi().post(editParams);
	mw.notify(`「${votedPageName}」已完成投票。`);
	return false;
}
