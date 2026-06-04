import state, { type VoterUserConfig } from "./state";
import type { ApiParams } from "types-mediawiki-api";

interface ConfigPageRevisionSlot {
	main: Record<string, string>;
}

interface ConfigPageRevision {
	slots: ConfigPageRevisionSlot;
}

interface ConfigPage {
	missing?: string;
	revisions?: ConfigPageRevision[];
}

interface ConfigPageQueryResponse {
	query: {
		pageids: string[];
		pages: Record<string, ConfigPage>;
	};
}

/**
 * 從使用者 JSON 設定頁讀取 Voter 設定。
 * @returns {Promise<void>} 讀取完成後 resolve
 */
export async function loadUserConfig(): Promise<void> {
	try {
		const res = await state.getApi().get({
			action: "query",
			titles: state.configPageTitle,
			prop: "revisions|info",
			rvslots: "main",
			rvprop: "content",
			indexpageids: 1,
		}) as ConfigPageQueryResponse;

		const firstPageId = res.query.pageids[0];
		const page = res.query.pages[firstPageId];
		const rawContent = page?.revisions?.[0]?.slots?.main?.["*"];
		if (!rawContent) {
			state.applyUserConfig({});
			return;
		}

		state.applyUserConfig(JSON.parse(rawContent));
	} catch (error: unknown) {
		console.warn("[Voter] Failed to load user config:", error);
		state.applyUserConfig({});
	}
}

/**
 * 保存 Voter 設定到使用者 JSON 設定頁。
 * @param {VoterUserConfig} config 要保存的設定
 * @returns {Promise<void>} 保存完成後 resolve
 */
export async function saveUserConfig(config: VoterUserConfig): Promise<void> {
	const serializableConfig = state.getSerializableUserConfig(config);
	const editParams: ApiParams = {
		action: "edit",
		title: state.configPageTitle,
		text: JSON.stringify(serializableConfig, null, 2),
		summary: "更新 Voter 設定 ([[User:SuperGrey/gadgets/voter|Voter]])",
		token: mw.user.tokens.get("csrfToken"),
		contentmodel: "json",
	};

	await state.getApi().post(editParams);
}
