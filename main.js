// Main page: [[User:SuperGrey/gadgets/voter]]

const Voter = {
    /**
     * 頁面名稱
     * @type {string}
     */
    pageName: null,

    /**
     * 頁面標題
     * @type {string}
     */
    sectionTitles: [],

    /**
     * 有效投票模板
     * @type {string[]}
     */
    validVoteTemplates: [],

    /**
     * 無效投票模板
     * @type {string[]}
     */
    invalidVoteTemplates: [],

    /**
     * 視窗管理器
     * @type {OO.ui.WindowManager}
     */
    windowManager: null,

    /**
     * 投票對話框
     * @type {OO.ui.ProcessDialog}
     */
    voteDialog: null,

    /**
     * 版本號
     */
    version: '4.1.0',

    /**
     * Wikipedia API
     * @type {mw.Api}
     */
    api: new mw.Api({userAgent: `Voter/${this.version}`}),

    /**
     * 程式入口。
     */
    init: function () {
        this.pageName = mw.config.get('wgPageName');
        if (!this.validatePage()) {
            console.log("[Voter] " + this.pageName + " 不是投票頁面，小工具終止。");
            return;
        }
        console.log(`[Voter] 已載入，當前頁面為 ${this.pageName}。`);

        this.windowManager = new OO.ui.WindowManager();
        $(document.body).append(this.windowManager.$element);

        this.setupDialog();
        this.voteDialog = new this.VoteDialog();
        this.windowManager.addWindows([this.voteDialog]);

        mw.hook('wikipage.content').add(function () {
            setTimeout(() => Voter.addVoteButtons(), 200);  // 等待編輯按鈕載入
        });
    },

    /**
     * 獲取XTools頁面資訊。無法獲取時按下不表，返回空字串。
     * @param pageName
     * @returns {Promise<string>} XTools頁面資訊。
     */
    getXToolsInfo: async function (pageName) {
        function safeToLocaleString(num) {
            if (typeof num === 'number' && !isNaN(num)) {
                return num.toLocaleString();
            }
            return '0';
        }

        try {
            const pageInfo = await $.get('https://xtools.wmcloud.org/api/page/pageinfo/' + mw.config.get('wgServerName') + '/' + pageName.replace(/["?%&+\\]/g, escape));

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
        } catch (error) {
            console.error('[Voter] Error fetching XTools data:', error);
            return '<span style="color: red; font-weight: bold;">無法獲取 XTools 頁面資訊。</span>';
        }
    },

    /**
     * 初始化對話框類別。
     */
    setupDialog: function () {
        let VoteDialog = this.VoteDialog = function (config) {
            Voter.VoteDialog.super.call(this, config);
        };

        OO.inheritClass(VoteDialog, OO.ui.ProcessDialog);
        VoteDialog.static.name = 'voteDialog';
        VoteDialog.static.title = `投票助手 (Voter v${this.version})`;
        VoteDialog.static.actions = [
            {flags: ['primary', 'progressive'], label: '儲存投票', action: 'save'}, {flags: 'safe', label: '取消'},
        ];

        VoteDialog.prototype.initialize = function () {
            VoteDialog.super.prototype.initialize.call(this);

            this.panel = new OO.ui.PanelLayout({padded: true, expanded: false});
            this.content = new OO.ui.FieldsetLayout();

            this.entrySelection = new OO.ui.MenuTagMultiselectWidget();
            this.fieldEntrySelection = new OO.ui.FieldLayout(this.entrySelection, {
                label: '投票條目', align: 'top',
            });

            this.entrySelectionInfo = $('<div>');
            this.entrySelectionInfoLabel = new OO.ui.LabelWidget({
                label: this.entrySelectionInfo,
            });
            this.entrySelectionInfoLabel.$element.css({
                'font-size': '0.9em',
            });

            this.templateSelection = new OO.ui.MenuTagMultiselectWidget();
            this.fieldTemplateSelection = new OO.ui.FieldLayout(this.templateSelection, {
                label: '投票模板', align: 'top',
            });

            this.voteMessageInput = new OO.ui.MultilineTextInputWidget({autosize: true, rows: 3, maxRows: 10});
            this.fieldVoteMessageInput = new OO.ui.FieldLayout(this.voteMessageInput, {
                label: '投票理由（可不填；無須簽名）', align: 'top',
            });

            this.useBulletedCheckbox = new OO.ui.CheckboxInputWidget({
                selected: true,
            });
            this.fieldUseBulletedCheckbox = new OO.ui.FieldLayout(this.useBulletedCheckbox, {
                label: $('<span>使用 <code>*</code> 縮進</span>'), align: 'inline',
            });

            this.content.addItems([
                this.fieldEntrySelection,
                this.entrySelectionInfoLabel,
                this.fieldTemplateSelection,
                this.fieldVoteMessageInput,
                this.fieldUseBulletedCheckbox,
            ]);
            this.panel.$element.append(this.content.$element);
            this.$body.append(this.panel.$element);

            this.entrySelection.connect(this, {change: 'onEntrySelectionChange'});
            this.entrySelection.getMenu().connect(this, {toggle: 'onInputResize'});
            this.templateSelection.connect(this, {change: 'onInputResize'});
            this.templateSelection.getMenu().connect(this, {toggle: 'onInputResize'});
            this.voteMessageInput.connect(this, {resize: 'onInputResize'});
        };

        VoteDialog.prototype.onEntrySelectionChange = async function () {
            let selectedEntries = this.entrySelection.getValue();
            console.log("[Voter] 投票條目選擇變更：", selectedEntries);

            this.entrySelectionInfo.text('');
            for (let entryID of selectedEntries) {
                let entryName = Voter.sectionTitles.find(x => x.data === entryID)?.label;
                const info = await Voter.getXToolsInfo(entryName);
                this.entrySelectionInfo.append($('<div>').html(info).css({'margin-top': '0.5em'}));
                setTimeout(() => this.updateSize(), 100);
                setTimeout(() => this.updateSize(), 300);
            }
        };

        VoteDialog.prototype.onInputResize = function () {
            setTimeout(() => this.updateSize(), 100);  // 等待輸入框大小變更後調整對話框大小
        };

        VoteDialog.prototype.getBodyHeight = function () {
            return this.panel.$element.outerHeight(true);
        };

        VoteDialog.prototype.getSetupProcess = function (data) {
            return VoteDialog.super.prototype.getSetupProcess.call(this, data).next(function () {
                this.entrySelection.getMenu().clearItems();
                this.entrySelection.addOptions(Voter.sectionTitles);
                this.entrySelection.setValue([
                    Voter.sectionTitles.find(x => x.data === data.sectionID),
                ]);

                this.templateSelection.getMenu().clearItems();
                this.templateSelection.addOptions(Voter.validVoteTemplates.concat(Voter.invalidVoteTemplates));
                this.templateSelection.setValue([Voter.validVoteTemplates[0]?.data]);
            }, this);
        };

        VoteDialog.prototype.getActionProcess = function (action) {
            if (action === 'save') {
                if (this.entrySelection.getValue().length && this.templateSelection.getValue().length) {
                    let dialog = this;
                    return new OO.ui.Process(async function () {
                        console.log("[Voter] 投票：", {
                            entries: dialog.entrySelection.getValue(),
                            templates: dialog.templateSelection.getValue(),
                            reason: dialog.voteMessageInput.getValue(),
                        });
                        await Voter.vote(dialog.entrySelection.getValue(), dialog.templateSelection.getValue(), dialog.voteMessageInput.getValue(), dialog.useBulletedCheckbox.isSelected());
                        dialog.close({action: 'save'});
                    });
                }
            }
            return VoteDialog.super.prototype.getActionProcess.call(this, action);
        };

        VoteDialog.prototype.getTeardownProcess = function (data) {
            return VoteDialog.super.prototype.getTeardownProcess.call(this, data).first(() => {
            }, this);
        };
    },

    /**
     * 驗證是否為投票頁面，並設置投票模板。
     * @returns {boolean} 是否為有效的投票頁面
     */
    validatePage: function () {
        let validPages = [
            {
                name: 'Wikipedia:新条目推荐/候选',
                templates: [
                    {data: '支持', label: '支持'},
                    {data: '反對', label: '反對'},
                    {data: '不合要求', label: '不合要求'},
                    {data: '問題不當', label: '問題不當'},
                ],
            }, {
                name: 'Wikipedia:優良條目評選',
                templates: [
                    {data: 'yesGA', label: '符合優良條目標準'},
                    {data: 'noGA', label: '不符合優良條目標準'},
                ],
            }, {
                name: 'Wikipedia:典范条目评选',
                templates: [
                    {data: 'yesFA', label: '符合典範條目標準'},
                    {data: 'noFA', label: '不符合典範條目標準'},
                ],
            }, {
                name: 'Wikipedia:特色列表评选',
                templates: [
                    {data: 'yesFL', label: '符合特色列表標準'},
                    {data: 'noFL', label: '不符合特色列表標準'},
                ],
            },
        ];

        for (let page of validPages) {
            if (this.pageName === page.name || new RegExp(`^${page.name}/`, 'i').test(this.pageName)) {
                this.validVoteTemplates = page.templates;
                this.invalidVoteTemplates = [
                    '中立', '意見', '建議', '疑問', '同上', '提醒'
                ].map(template => ({
                    data: template, label: template,
                }));
                return true;
            }
        }
        return false;
    },

    /**
     * 為每個投票區段添加投票按鈕。
     */
    addVoteButtons: function () {
        if (document.querySelector('#voter-finished-loading')) {
            return;
        }

        this.sectionTitles = [];

        let headingSelector;
        if (this.pageName === 'Wikipedia:新条目推荐/候选') {
            headingSelector = 'div.mw-heading.mw-heading4';
        } else {
            headingSelector = 'div.mw-heading.mw-heading2';
        }

        $(headingSelector).each((index, element) => {
            let $element = $(element);
            let anchor;
            if (this.pageName === 'Wikipedia:新条目推荐/候选') {
                anchor = $element.nextUntil(headingSelector, 'ul').find('li .anchor').attr('id');
            } else {
                anchor = $element.find('h2').attr('id');
            }

            if (anchor) {
                let sectionID = this.getSectionID(index + 1);
                $('<span class="mw-editsection-bracket">|</span> <a onclick="Voter.showVoteDialog(' + sectionID + ')">投票</a>').insertAfter($element.find('span.mw-editsection > a').first());

                this.sectionTitles.push({data: sectionID, label: anchor.replace(/_/g, ' ')});
            }
        });
        console.log(`[Voter] 已識別可投票事項共 ${this.sectionTitles.length} 項。`);

        let finishedLoading = document.createElement('div');
        finishedLoading.id = 'voter-finished-loading';
        finishedLoading.style.display = 'none';
        document.querySelector('#mw-content-text .mw-parser-output').appendChild(finishedLoading);
    },

    /**
     * 打開投票對話框。
     * @param sectionID {number} 章節編號
     */
    showVoteDialog: function (sectionID) {
        event.preventDefault();
        this.windowManager.openWindow(this.voteDialog, {sectionID});
    },

    /**
     * 取得特定章節編輯編號（支援不同參數位置）。
     * @param childid {number} 章節編號
     * @returns {number} 編輯編號
     */
    getSectionID: function (childid) {
        try {
            let $heading;
            if (this.pageName === 'Wikipedia:新条目推荐/候选') {
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
    },

    /**
     * 比對標題與文本內容。
     * @param title {string} 標題
     * @returns {string[]} 標題變體
     */
    titleVariants: function (title) {
        let us = title.replace(/ /g, '_');
        let sp = title.replace(/_/g, ' ');
        return [title, us, sp, us.charAt(0).toUpperCase() + us.slice(1), sp.charAt(0).toUpperCase() + sp.slice(1)];
    },

    /**
     * 比對文本與標題變體。
     * @param text {string} 文本內容
     * @param title {string} 標題
     * @returns {boolean} 是否包含標題變體
     */
    textMatchTitleVariants: function (text, title) {
        return this.titleVariants(title).some(variant => text.includes(variant));
    },

    /**
     * 將文字加上縮排。
     * @param text {string} 文字內容
     * @param indent {string} 縮排字串
     * @returns {string} 加上縮排的文字
     */
    addIndent: function (text, indent) {
        return text.replace(/^/gm, indent);
    },

    /**
     * 刷新頁面內容。
     * @param entryName {string} 章節名稱
     */
    refreshPage: function (entryName) {
        // Voter.api.get({
        //     action: 'parse',
        //     page: mw.config.get('wgPageName'),
        //     prop: ['text']
        // }).then((r) => {
        //     const content = $('#mw-content-text');
        //     content.find('.mw-parser-output').replaceWith(r.parse.text['*']);
        //     mw.hook('wikipage.content').fire(content);
        // });
        location.href = mw.util.getUrl(this.pageName + '#' + entryName);  // 先跳轉到投票章節，這樣重載後就不會跳到最上面了
        location.reload();
    },

    /**
     * 單次處理投票寫入並檢查衝突。
     * @param tracePage {string} 追蹤頁面
     * @param destPage {string} 目標頁面
     * @param sectionID {number} 章節編號
     * @param text {string} 投票內容
     * @param summary {string} 編輯摘要
     * @returns {Promise<boolean>} 是否發生衝突
     */
    voteAPI: async function (tracePage, destPage, sectionID, text, summary) {
        let votedPageName = this.sectionTitles.find(x => x.data === sectionID)?.label || `section ${sectionID}`;
        mw.notify(`正在為「${votedPageName}」投出一票⋯⋯`);

        let res = await Voter.api.get({
            action: 'query',
            titles: destPage,
            prop: 'revisions|info',
            rvslots: '*',
            rvprop: 'content',
            rvsection: sectionID,
            indexpageids: 1,
        });

        let page = res.query.pages[res.query.pageids[0]];
        let sectionText = page.revisions[0].slots.main['*'];

        if (sectionText === undefined || sectionText === '') {
            console.log(`[Voter] 無法取得「${votedPageName}」的投票區段內容。區段ID：${sectionID}。API 回傳：`, res);
            mw.notify(`無法取得「${votedPageName}」的投票區段內容，請刷新後重試。`);
            return true;
        }

        if (!this.textMatchTitleVariants(sectionText, votedPageName)) {
            console.log(`[Voter] 在「${votedPageName}」的投票區段中找不到該條目。區段文本：`, sectionText);
            mw.notify(`在該章節找不到名為「${votedPageName}」的提名，請刷新後重試。`);
            return true;
        }

        let mod = {
            action: 'edit',
            title: destPage,
            section: sectionID,
            summary: summary,
            token: mw.user.tokens.get('csrfToken'),
        };

        // 處理內部有小標題的情況（例如獨立的評審章節）。
        let innerHeadings;
        if (tracePage === 'Wikipedia:新条目推荐/候选') {
            innerHeadings = sectionText.match(/=====.+?=====/g);
        } else {
            innerHeadings = sectionText.match(/===.+?===/g);
        }
        if (innerHeadings) {
            // 在下一個章節號（即小標題）前面插入投票內容。
            mod.section += 1;
            mod.prependtext = text + '\n';
        } else {
            // 內部沒有標題，則直接附在最後面。
            mod.appendtext = '\n' + text;
        }

        await Voter.api.post(mod);
        mw.notify(`「${votedPageName}」已完成投票。`);
        return false;
    },

    /**
     * 投票動作的完整實現。
     * @param voteIDs {string[]} 投票ID
     * @param templates {string[]} 投票模板
     * @param message {string} 投票理由
     * @param useBulleted {boolean} 是否使用 * 縮進
     * @returns {Promise<boolean>} 是否發生衝突
     */
    vote: async function (voteIDs, templates, message, useBulleted) {
        // event.preventDefault();
        let VTReason = templates.map(str => `{{${str}}}`).join('；');
        message = message.trim();
        VTReason += message ? '：' + message : '。';
        VTReason += '--~~' + '~~';

        for (const id of voteIDs) {
            let votedPageName = this.sectionTitles.find(x => x.data === id)?.label || `section ${id}`;
            let indent = useBulleted ? '* ' : ': ';
            let destPage = this.pageName;

            if (this.pageName === 'Wikipedia:新条目推荐/候选') {
                indent = useBulleted ? '** ' : '*: ';
            } else if (this.pageName === 'Wikipedia:優良條目評選') {
                destPage += '/提名區';
            } else if (/^Wikipedia:(典范条目评选|特色列表评选)$/i.test(this.pageName)) {
                destPage += '/提名区';
            }

            let text = this.addIndent(VTReason, indent);
            let summary = `/* ${votedPageName} */ `;
            summary += templates.join('、');
            summary += ' ([[User:SuperGrey/gadgets/voter|Voter]])';

            if (await this.voteAPI(this.pageName, destPage, id, text, summary)) return true;
        }

        // 投票完成，等待1秒鐘後刷新頁面。
        setTimeout(() => this.refreshPage(this.sectionTitles.find(x => x.data === voteIDs[0])?.label), 1000);
        return false;
    },
};

// 等待1秒後執行初始化（避免頁面尚未完全載入）。
setTimeout(() => Voter.init(), 1000);
