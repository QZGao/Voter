type WrapperFlags = {
	areThereTagsAroundMultipleLines: boolean;
	areThereTagsAroundListMarkup: boolean;
};

type ListLineNode = {
	type: string;
	text: string;
};

type ListContainerNode = {
	type?: string;
	items: ListNode[];
};

type ListNode = ListLineNode | ListContainerNode;

function isListLineNode(node: ListNode): node is ListLineNode {
	return (node as ListLineNode).text !== undefined;
}

const SPACE_AFTER_INDENTATION_CHARS = true;
const PARAGRAPH_TEMPLATES: string[] = [];
const FILE_PREFIX_PATTERN = '(?:File|Image)';
const MASK_PREFIX = '<<VOTER_MASK_';
const MASK_SUFFIX = '_VOTER>>';
const MASK_ANY_REGEXP = /<<VOTER_MASK_(\d+)(?:_\w+(?:_\d+)?)?_VOTER>>/g;
const POPULAR_NOT_INLINE_ELEMENTS = [
	'BLOCKQUOTE',
	'CAPTION',
	'CENTER',
	'DD',
	'DIV',
	'DL',
	'DT',
	'FIGURE',
	'FIGCAPTION',
	'FORM',
	'H1',
	'H2',
	'H3',
	'H4',
	'H5',
	'H6',
	'HR',
	'INPUT',
	'LI',
	'LINK',
	'OL',
	'P',
	'PRE',
	'SECTION',
	'STYLE',
	'TABLE',
	'TBODY',
	'TD',
	'TFOOT',
	'TH',
	'THEAD',
	'TR',
	'UL',
];

const PNIE_PATTERN = `(?:${POPULAR_NOT_INLINE_ELEMENTS.join('|')})`;
const FILE_PATTERN_END = `\\[\\[${FILE_PREFIX_PATTERN}:.+\\]\\]$`;
const GALLERY_REGEXP = /^<<VOTER_MASK_\d+_gallery_VOTER>>$/m;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


/**
 * 生成匹配指定標籤的正規表達式。
 * @param {string[]} tags 標籤名稱列表
 * @returns {RegExp} 匹配指定標籤的正規表達式
 */
function generateTagsRegexp(tags: string[]): RegExp {
	const tagsJoined = tags.join('|');
	return new RegExp(`(<(${tagsJoined})(?: [\\w ]+(?:=[^<>]+?)?| *)>)([^]*?)(</\\2>)`, 'ig');
}

class TextMasker {
	text: string;
	maskedTexts: string[];

	constructor(text: string, maskedTexts?: string[]) {
		this.text = text;
		this.maskedTexts = maskedTexts || [];
	}

	/**
	 * 使用指定的正則表達式和類型對文本進行遮罩處理，將匹配的文本替換為特殊標記並存儲原始文本。
	 * @param {RegExp} regexp 用於匹配要遮罩的文本的正則表達式
	 * @param {string} [type] 遮罩類型，用於生成不同的標記
	 * @param {boolean} [useGroups=false] 是否使用正則表達式的捕獲組來分割前綴文本和要遮罩的文本
	 * @returns {this} 返回當前 TextMasker 實例以支持鏈式調用
	 */
	mask(regexp: RegExp, type?: string, useGroups = false): this {
		this.text = this.text.replace(regexp, (s: string, preText: string, textToMask: string) => {
			if (!useGroups) {
				preText = '';
				textToMask = s;
			}

			const masked = textToMask || s;
			const id = this.maskedTexts.push(masked);
			const typeSuffix = type ? `_${type}` : '';

			return `${preText || ''}${MASK_PREFIX}${id}${typeSuffix}${MASK_SUFFIX}`;
		});
		return this;
	}

	/**
	 * 根據指定的類型對文本進行解遮罩處理，將特殊標記替換回原始文本。
	 * @param {string} text 要解遮罩的文本
	 * @param {string} [type] 遮罩類型，用於匹配對應的標記
	 * @returns {string} 解遮罩後的文本
	 */
	unmaskText(text: string, type?: string): string {
		const regexp = type ?
			new RegExp(
				`${escapeRegExp(MASK_PREFIX)}(\\d+)(?:_${escapeRegExp(type)}(?:_\\d+)?)?${escapeRegExp(MASK_SUFFIX)}`,
				'g'
			) :
			MASK_ANY_REGEXP;

		while (regexp.test(text)) {
			text = text.replace(regexp, (_s, num) => this.maskedTexts[Number(num) - 1]);
		}

		return text;
	}

	/**
	 * 對文本進行解遮罩處理，將所有特殊標記替換回原始文本。
	 * @param {string} [type] 遮罩類型，用於匹配對應的標記
	 * @returns {this} 返回當前 TextMasker 實例以支持鏈式調用
	 */
	unmask(type?: string): this {
		this.text = this.unmaskText(this.text, type);
		return this;
	}

	/**
	 * 遞歸地遮罩文本中的模板，將匹配的模板替換為特殊標記並存儲原始模板文本。
	 * @param {(templateCode: string) => string} [handler] 可選的處理函數，用於在遮罩前對模板文本進行修改
	 * @param {boolean} [addLengths=false] 是否在標記中添加原始模板文本的長度信息
	 * @returns {this} 返回當前 TextMasker 實例以支持鏈式調用
	 */
	maskTemplatesRecursively(handler?: (templateCode: string) => string, addLengths = false): this {
		let pos = 0;
		const stack: number[] = [];

		while (true) {
			let left = this.text.indexOf('{{', pos);
			let right = this.text.indexOf('}}', pos);

			if (left !== -1 && left < right) {
				stack.push(left);
				pos = left + 2;
			} else {
				if (!stack.length) break;

				left = stack.pop() as number;
				if (typeof left === 'undefined') {
					if (right === -1) {
						pos += 2;
						continue;
					} else {
						left = 0;
					}
				}
				if (right === -1) {
					right = this.text.length;
				}

				right += 2;
				let template = this.text.substring(left, right);
				if (handler) {
					template = handler(template);
				}

				const lengthOrNot = addLengths ?
					(
						'_' +
						template.replace(
							new RegExp(
								`${escapeRegExp(MASK_PREFIX)}\\d+_template_(\\d+)${escapeRegExp(MASK_SUFFIX)}`,
								'g'
							),
							(_m, n) => new Array(Number(n) + 1).join(' ')
						).length
					) :
					'';

				this.text = (
					this.text.substring(0, left) +
					MASK_PREFIX +
					this.maskedTexts.push(template) +
					'_template' +
					lengthOrNot +
					MASK_SUFFIX +
					this.text.slice(right)
				);

				pos = right - template.length;
			}
		}

		return this;
	}

	/**
	 * 對文本中的指定標籤進行遮罩處理，將匹配的標籤替換為特殊標記並存儲原始標籤文本。
	 * @param {string[]} tags 標籤名稱列表
	 * @param {string} type 遮罩類型，用於生成不同的標記
	 * @returns {this} 返回當前 TextMasker 實例以支持鏈式調用
	 */
	maskTags(tags: string[], type: string): this {
		return this.mask(generateTagsRegexp(tags), type);
	}

	/**
	 * 對敏感代碼區塊進行遮罩處理（block/gallery/nowiki/template/table）。
	 * @param {(templateCode: string) => string} [templateHandler] 可選的處理函數，用於在遮罩前對模板文本進行修改
	 * @returns {this} 返回當前 TextMasker 實例以支持鏈式調用
	 */
	maskSensitiveCode(templateHandler?: (templateCode: string) => string): this {
		return this
			.maskTags(['pre', 'source', 'syntaxhighlight'], 'block')
			.maskTags(['gallery', 'poem'], 'gallery')
			.maskTags(['nowiki'], 'inline')
			.maskTemplatesRecursively(templateHandler)
			.mask(/^(:* *)(\{\|[^]*?\n\|\})/gm, 'table', true)
			.mask(/^(:* *)(\{\|[^]*\n\|)/gm, 'table', true);
	}
}

/**
 * 在行首添加縮排字串，並根據需要在縮排字串和行文本之間添加空格。
 * @param {string} indentation 縮排字串
 * @param {string} line 行文本
 * @returns {string} 添加縮排後的行文本
 */
function prependIndentationToLine(indentation: string, line: string): string {
	return (
		indentation +
		(indentation && SPACE_AFTER_INDENTATION_CHARS && !/^[:*#;]/.test(line) ? ' ' : '') +
		line
	);
}

/**
 * 將行物件整理為列表樹狀結構（非 HTML 字串）。
 * @param {ListNode[]} lines 行對象數組
 * @param {boolean} [isNested=false] 是否為嵌套層
 * @returns {ListNode[]} 轉換後的行對象數組
 */
function linesToLists(lines: ListNode[], isNested = false): ListNode[] {
	const listTags: Record<string, string> = { ':': 'dl', ';': 'dl', '*': 'ul', '#': 'ol' };
	const itemTags: Record<string, string> = { ':': 'dd', ';': 'dt', '*': 'li', '#': 'li' };

	let list: ListContainerNode = { items: [] };

	for (let i = 0; i <= lines.length; i++) {
		if (i === lines.length) {
			if (list.type) {
				lineToList(lines, i, list, isNested);
			}
		} else {
			const node = lines[i];
			const text = isListLineNode(node) ? node.text : '';
			const firstChar = text[0] || '';
			const listType = listTags[firstChar];

			if (list.type && listType !== list.type) {
				const itemsCount = list.items.length;
				lineToList(lines, i, list, isNested);
				i -= itemsCount - 1;
				list = { items: [] };
			}

			if (listType) {
				list.type = listType;
				list.items.push({
					type: itemTags[firstChar],
					text: text.slice(1),
				});
			}
		}
	}

	return lines;
}

/**
 * 將一段連續列表行合併/提升為列表結構節點。
 * @param {ListNode[]} lines 行對象數組
 * @param {number} i 當前行索引
 * @param {ListContainerNode} list 當前列表對象
 * @param {boolean} [isNested=false] 是否為嵌套列表
 */
function lineToList(
	lines: ListNode[],
	i: number,
	list: ListContainerNode,
	isNested = false
): void {
	if (isNested) {
		const previousItemIndex = i - list.items.length - 1;
		if (previousItemIndex >= 0) {
			const item = {
				type: lines[previousItemIndex].type,
				items: [lines[previousItemIndex], list],
			};
			lines.splice(previousItemIndex, list.items.length + 1, item);
		} else {
			const item = {
				type: lines[0].type,
				items: [list],
			};
			lines.splice(i - list.items.length, list.items.length, item);
		}
	} else {
		lines.splice(i - list.items.length, list.items.length, list);
	}

	linesToLists(list.items, true);
}

/**
 * 將行對象數組中的列表標記轉換為對應的HTML標籤字符串，支持嵌套列表。
 * @param {ListNode[]} lines 行對象數組
 * @param {boolean} [isNested=false] 是否為嵌套列表
 * @returns {string} 轉換後的HTML標籤字符串
 */
function listToTags(lines: ListNode[], isNested = false): string {
	let text = '';

	lines.forEach((line, i) => {
		if (!isListLineNode(line)) {
			const itemsText = (line.items || [])
				.map((item) => {
					const itemText = !isListLineNode(item) ?
						listToTags(item.items || [], true) :
						String(item.text).trim();
					return item.type ? `<${item.type}>${itemText}</${item.type}>` : itemText;
				})
				.join('');
			text += `<${line.type}>${itemsText}</${line.type}>`;
		} else {
			text += isNested ? String(line.text).trim() : String(line.text);
		}

		if (i !== lines.length - 1) {
			text += '\n';
		}
	});

	return text;
}

/**
 * 將文本中的列表標記轉換為對應的HTML標籤字符串，支持嵌套列表。
 * @param {string} code 包含列表標記的文本
 * @returns {string} 轉換後的HTML標籤字符串
 */
function listMarkupToTags(code: string): string {
	const lineObjects = code.split('\n').map((line) => ({ type: '', text: line }));
	return listToTags(linesToLists(lineObjects));
}

/**
 * 分析文本中的縮排，並檢測是否存在跨多行的標籤或列表標記。
 * @param {string} text 要分析的文本
 * @param {string} indentation 縮排字串
 * @returns {WrapperFlags} 包含分析結果的對象，指示是否存在跨多行的標籤或列表標記
 */
function findWrapperFlags(text: string, indentation: string): WrapperFlags {
	if (!indentation) {
		return {
			areThereTagsAroundMultipleLines: false,
			areThereTagsAroundListMarkup: false,
		};
	}

	const tagMatches: string[] = text.match(generateTagsRegexp(['[a-z]+'])) || [];

	const quoteMatches: string[] = text.match(
		/(<(?:blockquote|q)(?: [\w ]+(?:=[^<>]+?)?| *)>)([^]*?)(<\/(?:blockquote|q)>)/ig
	) || [];

	const matches = tagMatches.concat(quoteMatches);

	return {
		areThereTagsAroundMultipleLines: matches.some((match) => match.indexOf('\n') !== -1),
		areThereTagsAroundListMarkup: matches.some((match) => /\n[:*#;]/.test(match)),
	};
}

/**
 * 處理帶有縮排的評論文本，將列表標記轉換為HTML標籤，並根據縮排和標籤情況調整換行和縮排。
 * @param {string} code 包含評論內容的文本
 * @param {string} indentation 縮排字串
 * @param {string} restLinesIndentation 後續行的縮排字串
 * @param {boolean} isWrapped 是否為包裹在模板中的評論
 * @param {boolean} isInTemplate 是否在模板內部
 * @param {WrapperFlags} flags 包含分析結果的對象，指示是否存在跨多行的標籤或列表標記
 * @returns {string} 處理後的評論文本
 */
function handleIndentedComment(
	code: string,
	indentation: string,
	restLinesIndentation: string,
	isWrapped: boolean,
	isInTemplate: boolean,
	flags: WrapperFlags
): string {
	if (!indentation) {
		return code;
	}

	code = code.replace(/^ +/gm, '');

	if (/^[:*#;]/m.test(code) && (isWrapped || restLinesIndentation === '#')) {
		if (isInTemplate) {
			code = code.replace(/\|(?:[^|=}]*=)?(?=[:*#;])/, '$&\n');
		}
		code = listMarkupToTags(code);
	}

	code = code.replace(
		new RegExp(`(\\n+)([:*#;]|${escapeRegExp(MASK_PREFIX)}\\d+_table${escapeRegExp(MASK_SUFFIX)}|${FILE_PATTERN_END})`, 'gmi'),
		(_s, newlines: string, nextLine: string) => (
			(newlines.length > 1 ? '\n\n\n' : '\n') +
			prependIndentationToLine(restLinesIndentation, nextLine)
		)
	);

	code = code
		.replace(/(^|[^\n])(<<VOTER_MASK_\d+_gallery_VOTER>>)/g, (_s, before: string, marker: string) => `${before}\n${marker}`)
		.replace(/<<VOTER_MASK_\d+_gallery_VOTER>>(?=(?:$|[^\n]))/g, (marker) => `${marker}\n`);

	if (restLinesIndentation.indexOf('#') !== -1 && /<<VOTER_MASK_\d+_table_VOTER>>/.test(code)) {
		throw new Error('numberedList-table');
	}

	if (restLinesIndentation === '#' && GALLERY_REGEXP.test(code)) {
		throw new Error('numberedList');
	}

	code = code.replace(
		/^((?:[:*#;].+|<<VOTER_MASK_\d+_(?:table|gallery)_VOTER>>))(\n+)(?![:#])/mg,
		(_s, previousLine: string, newlines: string) => (
			previousLine +
			'\n' +
			prependIndentationToLine(restLinesIndentation, newlines.length > 1 ? '\n\n' : '')
		)
	);

	if (PARAGRAPH_TEMPLATES.length) {
		code = code.replace(/^(.*)\n\n+(?!:)/gm, `$1{{${PARAGRAPH_TEMPLATES[0]}}}\n`);
	} else if (flags.areThereTagsAroundMultipleLines) {
		code = code.replace(/^(.*)\n\n+(?!:)/gm, '$1<br> \n');
	} else {
		code = code.replace(
			/^(.*)\n\n+(?!:)/gm,
			(_s, m1: string) => `${m1}\n${prependIndentationToLine(restLinesIndentation, '')}`
		);
	}

	return code;
}

/**
 * 處理文本中的換行，根據縮排和標籤情況調整換行和縮排。
 * @param {string} code 包含評論內容的文本
 * @param {string} indentation 縮排字串
 * @param {boolean} [isInTemplate=false] 是否在模板內部
 * @returns {string} 處理後的評論文本
 */
function processNewlines(code: string, indentation: string, isInTemplate = false): string {
	const entireLineRegexp = /^<<VOTER_MASK_\d+_(block|template)(?:_\d+)?_VOTER>> *$/;
	const entireLineFromStartRegexp = /^(=+).*\1[ \t]*$|^----/;
	const fileRegexp = new RegExp(`^${FILE_PATTERN_END}`, 'i');

	let currentLineInTemplates = '';
	let nextLineInTemplates = '';
	if (isInTemplate) {
		currentLineInTemplates = '|=';
		nextLineInTemplates = '|\\||}}';
	}

	const paragraphTemplatePattern = PARAGRAPH_TEMPLATES.length ?
		mw.util.escapeRegExp(`{{${PARAGRAPH_TEMPLATES[0]}}}`) :
		'(?!)';

	const currentLineEndingRegexp = new RegExp(
		`(?:<${PNIE_PATTERN}(?: [\\w ]+?=[^<>]+?| ?\\/?)>|<\\/${PNIE_PATTERN}>|${escapeRegExp(MASK_PREFIX)}\\d+_block${escapeRegExp(MASK_SUFFIX)}|<br[ \\n]*\\/?>|${paragraphTemplatePattern}${currentLineInTemplates}) *$`,
		'i'
	);
	const nextLineBeginningRegexp = new RegExp(
		`^(?:<\\/${PNIE_PATTERN}>|<${PNIE_PATTERN}${nextLineInTemplates})`,
		'i'
	);

	const newlinesRegexp = indentation ?
		/^(.+)\n(?![:#])(?=(.*))/gm :
		new RegExp(
			`^((?![:*#; ]).+)\\n(?![\\n:*#; ]|${escapeRegExp(MASK_PREFIX)}\\d+_table${escapeRegExp(MASK_SUFFIX)})(?=(.*))`,
			'gm'
		);

	return code.replace(newlinesRegexp, (_s, currentLine: string, nextLine: string) => {
		const lineBreakOrNot = (
			entireLineRegexp.test(currentLine) ||
			entireLineRegexp.test(nextLine) ||
			(!indentation && (entireLineFromStartRegexp.test(currentLine) || entireLineFromStartRegexp.test(nextLine))) ||
			fileRegexp.test(currentLine) ||
			fileRegexp.test(nextLine) ||
			GALLERY_REGEXP.test(currentLine) ||
			GALLERY_REGEXP.test(nextLine) ||
			currentLineEndingRegexp.test(currentLine) ||
			nextLineBeginningRegexp.test(nextLine)
		) ?
			'' :
			`<br>${indentation ? ' ' : ''}`;

		const newlineOrNot = indentation && !GALLERY_REGEXP.test(nextLine) ? '' : '\n';

		return currentLine + lineBreakOrNot + newlineOrNot;
	});
}

/**
 * 處理評論文本，將列表標記轉換為HTML標籤，並根據縮排和標籤情況調整換行和縮排。
 * @param {string} code 包含評論內容的文本
 * @param {string} indentation 縮排字串
 * @param {string} restLinesIndentation 後續行的縮排字串
 * @param {WrapperFlags} flags 包含分析結果的對象，指示是否存在跨多行的標籤或列表標記
 * @param {boolean} isInTemplate 是否在模板內部
 * @returns {string} 處理後的評論文本
 */
function processCode(
	code: string,
	indentation: string,
	restLinesIndentation: string,
	flags: WrapperFlags,
	isInTemplate: boolean
): string {
	let result = handleIndentedComment(
		code,
		indentation,
		restLinesIndentation,
		isInTemplate || flags.areThereTagsAroundListMarkup,
		isInTemplate,
		flags
	);
	result = processNewlines(result, indentation, isInTemplate);
	return result;
}

/**
 * 建立評論的 wikitext，從原始輸入文本和縮排字串生成。
 *
 * 範例 `indent`:
 * - `':'`
 * - `'*'`
 * - `'::'`
 * - `'#'`
 * @param {string} text 文字內容
 * @param {string} indent 縮排字串
 * @returns {string} 處理後的 wikitext
 */
export function buildWikitext(text: string, indent: string): string {
	const indentation = indent || '';
	const restLinesIndentation = indentation ? indentation.replace(/\*/g, ':') : '';

	const masker = new TextMasker((text || '').trim());

	masker.maskSensitiveCode((templateCode) => (
		processCode(
			templateCode,
			indentation,
			restLinesIndentation,
			{
				areThereTagsAroundMultipleLines: false,
				areThereTagsAroundListMarkup: false,
			},
			true
		)
	));

	const flags = findWrapperFlags(masker.text, indentation);

	masker.text = processCode(masker.text, indentation, restLinesIndentation, flags, false);

	// Mirrors submit-time behavior (non-edit path): comment body ends with a newline.
	masker.text += '\n';

	let finalIndentation = indentation;
	if (finalIndentation && /^[*#;\x03]/.test(masker.text)) {
		finalIndentation = restLinesIndentation;
	}
	masker.text = prependIndentationToLine(finalIndentation, masker.text);

	masker.unmask();
	return masker.text;
}
