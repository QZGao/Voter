# Voter

專案頁面：[Voter](https://zh.wikipedia.org/wiki/User:SuperGrey/gadgets/voter)

更好看、功能更全面的快速投票器（多選一鍵投票、多票種組合投票）。介面採用新版樣式。 

## 使用方式
### 發行版本
将如下程式碼复制至 [User:你的用戶名/common.js](https://zh.wikipedia.org/wiki/Special:MyPage/common.js) 頁面：

```js
importScript('User:SuperGrey/gadgets/voter/main.js');  // Backlink: [[User:SuperGrey/gadgets/voter]]
```

### 從原始碼建構

1. **安裝 Node.js**
   - 請先安裝 [Node.js](https://nodejs.org/)。

2. **安裝依賴套件**
   - 在 Voter 目錄下執行：
     ```sh
     npm install
     ```

3. **建構 Bundled 版本**
   - 執行下列指令以產生 `dist/bundled.js`：
     ```sh
     npm run build
     ```
   - 若需持續監看檔案變動並自動重建，請執行：
     ```sh
     npm run watch
     ```

4. **安裝至維基**
   - 將 `dist/bundled.js` 上傳至你的維基用戶頁面，例如 [User:你的用戶名/Voter.js](https://zh.wikipedia.org/wiki/Special:MyPage/Voter.js)。
   - 在 [User:你的用戶名/common.js](https://zh.wikipedia.org/wiki/Special:MyPage/common.js) 頁面加入：
     ```js
     importScript('User:你的用戶名/Voter.js');  // 修改為你的用戶名
     ```

## 版權

- 本工具採用 [CC BY-SA 4.0](/LICENSE-CC-BY-SA) + [MIT License](/LICENSE) 授權。
- 上游：[Vote-Template](https://zh.wikipedia.org/wiki/User:小躍/Vote-Template)（[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.zh)）
  - 作者：[小躍](https://zh.wikipedia.org/wiki/User:小躍)
