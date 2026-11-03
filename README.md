# 小柯機器人接龍遊戲 https://achir1015.github.io/xiaoke-freecell/online/

3D 新接龍（FreeCell）同局比快遊戲。遊戲開發：吳玉柱 先生 與 Claude AI Opus 5.5。

## 功能
- **四種玩法**：A 真人對 AI、B 遠端真人對真人（PeerJS 房號＋語音、文字聊天、AI 補位、觀戰）、C AI 對 AI、D 單人練習
- **比賽規則**：雙方拿同一局牌（與 Windows 新接龍相同的 1～1,000,000 號牌局）同時開始，先把 52 張全部送上回收座的人贏；放棄或時間到時比回收座張數
- **AI 軍師**：提示下一步、解說局面（有 Anthropic API 金鑰時由 Claude 白話解說）、接手主位、比賽中換軍師
- **速算解算器**：加權最佳優先搜尋，1000 局平均每局約 10 毫秒；多核心工作池每秒約 200 局
- **牌譜庫**：每局自動累積，記住每個牌局號碼的最短解（AI 大師與軍師會直接使用），重播、AI 解答、匯入匯出
- **教學**：8 課動畫＋語音接龍教學、練習題；7 課系統說明
- 20 位男性、20 位女性半身照與 30 位 AI 軍師；20 首原創背景音樂（每首 3 分多鐘），直立音量滑桿
- 版本更新：開啟時自動檢查 GitHub Release

## 開發
```
npm install
npm start          # 開發版
npm test           # 單元測試
node e2e/smoke.mjs # 單機端對端測試
node e2e/net.mjs   # 遠端對戰測試
npm run dist:win   # 建立 Windows 安裝檔與免安裝版
```

## 參考
規則與介面構想參考 [shuyang0129/woe-freecell](https://github.com/shuyang0129/woe-freecell)、[sampot/pg-freecell](https://github.com/sampot/pg-freecell)；本程式碼、牌面、音樂、半身照皆為原創。
