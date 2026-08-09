# WorldTrace

一張只記錄你**真的走過**的地方的戰爭迷霧地圖。

App 開起來，整個世界是一片黑。走路會把腳下的迷霧擦開，被擦開的那塊就是紀錄本身 ——
不是你打卡過的清單，不是你搜尋過的地址，是你的鞋底實際壓過的地面。

目前只有 Android。

---

## 這個 App 唯一站得住腳的規則：只有真的 GPS 算數

被系統標記為模擬（mocked）的定位一律拒絕，永遠不會變成軌跡。

等級、成就、面積數字 —— 這些東西在「可以作弊」的那一刻就全部歸零，所以這條規則從來
不會為了方便而妥協。同樣地，**GPX 匯入是刻意不做的**：一個檔案沒辦法證明你去過哪裡。

拒絕的定位會連同原因一起存下來，但**不存座標**。這個 App 從不編造位置。

---

## 功能

四個分頁：

| 分頁 | 內容 |
|---|---|
| **地圖** | 迷霧地圖本體。錄製開關、即時位置、當前面積。北方永遠朝上 —— 會轉的迷霧地圖非常難讀。 |
| **探索** | 等級、十項三階成就、走過的國家與城市、總距離、總面積、佔地球表面的比例。 |
| **時間軸** | 每一次外出（segment）的紀錄，可以點開看那一趟的軌跡。 |
| **備份** | Google Drive 自動備份、還原，以及 GPX／資料庫快照匯出。 |

介面文字是繁體中文。面積與距離一律用公里與平方公里，不會中途換單位；佔地球的比例讀作
「88 億分之一」這種中文分母，不用科學記號。

---

## 迷霧是怎麼算的

固定在 Web Mercator z16 的網格上，每個 tile 帶一張 128×128 的 bitmap。一個 bit 在赤道
大約覆蓋 4.8 公尺，在台灣的緯度大約 4.3 公尺。

- 一個定位點不是只擦掉一格，而是擦開一個**半徑 30 公尺的圓盤**。
- 連續兩個定位點之間會擦開整條**走廊**，所以走路不會留下一串斷掉的圓點。
- 所有計算都在 global bit space 裡做 —— Mercator 是保角的，圓在那裡才會保持是圓。

**面積永遠來自 bitmap，不是從點算出來的。** 地圖畫的和數字說的必須是同一件事。

原始定位點另外完整保存，所以筆刷半徑或內插規則改變時，整張迷霧可以從頭重算
（`src/store/rebuild.ts`）。

---

## 守門員（gatekeeper）

平台交過來的每一個定位都先經過 `src/gatekeeper/`。這個模組刻意沒有任何 I/O 與平台
API —— 規則會反覆調整，而調整規則不應該需要拿著手機出門。

拒絕的理由只有這幾種：

| 理由 | 條件 |
|---|---|
| `MOCK_PROVIDER` | 這一筆定位自己帶著 `mocked` 旗標 |
| `LOW_ACCURACY` | 精度差於 100 公尺，或平台根本說不出精度 |
| `TIME_ANOMALY` | 時間往回走 |
| `TELEPORT` | 速度超過 350 m/s（客機巡航約 250） |
| `IMPOSSIBLE_ACCEL` | 連續超過 3 筆加速度大於 10 m/s²（單一筆狂跳只是 GPS 雜訊） |

兩個刻意的決定：

- **只看每一筆定位自己的 `mocked` 旗標，不看裝置層級的「允許模擬位置」設定。**
  那個設定是裝置全域的，跟這一筆定位是不是假的無關 —— 有人為了別的 App 一直開著模擬
  定位程式，用它來擋會讓那個人永遠錄不到任何真實軌跡。`refuseWhenMockAppEnabled` 存在，
  而且刻意是 `false`。
- **靜默超過 30 分鐘就開新的 segment，而不是指控使用者瞬間移動。** 手機可能關機、在
  地下、在飛機上；那段時間之間發生什麼事無從推論，速度檢查也就沒有意義。

`mocked` 只會在 Android 出現。iOS 不提供這個旗標，因為未越獄的裝置本來就餵不了假定位給
第三方 App；那邊的防線就是上面這些物理檢查。

---

## 架構

```
src/fog/         z16 tiling、128×128 bit bitmap、painting、GeoJSON、面積
src/gatekeeper/  接受或拒絕一筆定位。純函式、有狀態、零 I/O
src/store/       SqlDriver port 後面的 SQLite；tracker、summary、milestones
src/capture/     背景定位任務 —— 軌跡唯一的寫入者
src/cloud/       Google Drive 備份：授權、REST、排程、還原驗證
src/export/      GPX 與資料庫快照
src/progress/    等級與三階成就
src/places/      反向地理編碼，每次啟動處理幾個 tile
src/ui/          畫面、格式化、App 自己的對話框
```

兩個規則撐起其他所有東西：

**背景任務是軌跡唯一的寫入者。** `src/capture/backgroundTask.ts` 擁有它。多一個寫入者
就是多一個守門員、重複的點，以及互相切斷的 segment。

**ports pattern 是這個專案測得動的原因。** `SqlDriver`（`store/driver.ts`）在手機上由
expo-sqlite 實作，在測試裡由 Node 內建的 `node:sqlite` 實作 —— 所以 `npm test` 跑的是
真正的 SQL，不是 mock。`DriveTransport`（`cloud/drive.ts`）對 HTTP 做同一件事。

原則是：當某段程式非要一支手機不可，就把所有「決定」推出去，只留下真的無法測試的那一
小塊。`resolvePlaces.ts`、`expoDriveTransport.ts`、`expoLocationSource.ts` 都是這樣被削到
剩下骨頭的。

---

## 開發

```bash
npm install
npm test          # 345 個測試，約 1 秒
npm run typecheck
```

測試不需要手機、不需要模擬器、不需要網路。

跑起來看：

```bash
npx expo prebuild --platform android   # 第一次 clone 才需要
npm run android                        # expo run:android
npm run android:install                # 只裝 debug build
```

`android/` 不在版控裡，由 prebuild 產生。Debug build 到這裡就結束了；**要出 release
build 的話，prebuild 之後還得手動補兩件事**，見下面。

Release build：

```bash
cd android && JAVA_HOME=$HOME/.jdks/jdk-17.0.20+8/Contents/Home \
  ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleRelease
```

### 幾個會咬人的地方

- **JDK 必須剛好是 17。** Android Studio 內建 JDK 25；AGP 只支援到 21，而 JDK 24+ 限制了
  `System.load`，CMake 那一步會直接爛掉。
- **`expo prebuild` 會摧毀 release 簽章設定，每一次都會。** 權限不用擔心 —— 它們的來源是
  `app.json`，prebuild 會照著產生。但簽章設定不是任何 config plugin 產得出來的，所以
  prebuild 之後必須手動把 `android/app/build.gradle` 改回讀專案外的 keystore：

  ```gradle
  // 檔案開頭，projectRoot 定義之後
  def credentialsDir = file("$projectRoot/credentials")
  def keystorePropertiesFile = new File(credentialsDir, "keystore.properties")
  def keystoreProperties = new Properties()
  if (keystorePropertiesFile.exists()) {
      keystorePropertiesFile.withInputStream { keystoreProperties.load(it) }
  }

  // signingConfigs 裡，debug 那組旁邊
  release {
      if (keystoreProperties['storeFile']) {
          storeFile new File(credentialsDir, keystoreProperties['storeFile'])
          storePassword keystoreProperties['storePassword']
          keyAlias keystoreProperties['keyAlias']
          keyPassword keystoreProperties['keyPassword']
      }
  }

  // buildTypes.release 裡
  if (!keystoreProperties['storeFile']) {
      throw new GradleException("credentials/keystore.properties is missing — cannot sign a release build")
  }
  signingConfig signingConfigs.release
  ```

  改 `app.json` 的 permissions 在下一次 prebuild 之前不會有任何效果。急著測的話直接改
  manifest，但一定要同步回 `app.json`，否則下次 prebuild 就沒了。
- **那個 `throw` 是刻意的 —— 沒有簽章材料就讓 build 直接失敗**，不退回 debug 簽章。裝過
  debug 簽章的版本之後就只能移除重裝，而移除會帶走資料庫和每一公尺擦開的迷霧。
  `credentials/` 不在版控裡，也刻意放在 `android/` 外面，讓 prebuild 刪不到它。

### Google Drive 備份需要你自己的 OAuth 用戶端

雲端備份傳到**使用者自己的** Google Drive，只要求 `drive.appdata` 這一個範圍 —— 一個對
使用者隱藏、其他 App 也讀不到的私有資料夾。WorldTrace 看不到你雲端硬碟裡的其他任何檔案。

OAuth 用戶端 ID 綁定「套件名稱 + 簽章指紋」，所以 fork 之後必須自己建一組：

1. 在 [Google Cloud Console](https://console.cloud.google.com/projectcreate) 建專案，
   啟用 [Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)。
2. 設定 OAuth 同意畫面，並在 **Scopes** 頁面登錄
   `https://www.googleapis.com/auth/drive.appdata`。**這步不能跳過** —— 請求一個沒登錄過
   的範圍會被擋成 `403: access_denied`，而錯誤訊息看起來像是測試使用者沒加。
3. 建立 **Android** 用戶端（套件名稱 + 你的 release keystore SHA-1）。
4. 再建立一組 **Web** 用戶端，把它的 ID 放進 `.env.local`（複製 `.env.example`）：

   ```
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...apps.googleusercontent.com
   ```

   `.env.local` 不進版控。Metro 會在打包時把 `EXPO_PUBLIC_*` 直接內嵌進 bundle，所以
   改了它要重新建置，reload 不算。

第 4 步是最容易錯的：兩種用戶端 ID 的字串格式一模一樣，肉眼和程式都分不出來。填成
Android 那一筆的話，登入會失敗在 `DEVELOPER_ERROR`，而那個訊息看起來像是簽章對不上。
Android App 需要 Web 用戶端 ID，是因為 Android 用戶端型別不核發 secret、不能當作 token
交換的對象；它的角色是用套件名稱與簽章證明「這支 App 是真的」。

用戶端 ID 可以公開 —— 任何人反編譯 APK 都看得到，Google 的安全模型靠的是簽章比對。
**client secret 則絕對不要放進專案**；這裡用的是 PKCE，本來就不需要。

沒有設定的話，備份頁的雲端區塊會顯示「尚未設定」，本機匯出照常可用。

---

## 資料放在哪

全部在你的手機上，一個 SQLite 資料庫裡。沒有伺服器，沒有帳號，沒有遙測。

唯一離開裝置的路徑是你自己按下去的：Google Drive 備份（進你自己的 appDataFolder），
或是 GPX／資料庫快照匯出到系統分享選單。

備份會在 App 回到前景時嘗試，最快六小時一次，而且資料庫沒有變化就不上傳。失敗的話它
保持安靜 —— 備份沒成功不值得打斷別人散步，備份頁隨時看得到真實狀態。

還原永遠先驗證下載回來的檔案真的是一個 SQLite 資料庫，才碰現有的資料。

---

## 已知的缺口

- iOS 從來沒有建置或執行過。
- 背景錄製仍然得自己活過 Android 的電源管理。App 內沒有相關引導（做過，後來應要求移除）。
  長距離散步時迷霧沒有繼續打開的話，先檢查電池最佳化，以及 Samsung 的「休眠應用程式」清單。
- 成就的解鎖時間沒有持久化，每次讀取都重算。
- 時間軸沒有「當天新開的面積」—— bitmap 不帶每日出處。
- 沒有權限被拒絕時的引導畫面，沒有磁碟空間檢查。

---

## 技術棧

React Native 0.86.2 · Expo SDK 57 · TypeScript 6 · Hermes · New Architecture
（bridgeless）· MapLibre · vitest

寫任何 Expo API 之前請讀 [對應版本的文件](https://docs.expo.dev/versions/v57.0.0/)。
SDK 變得很快，通用文件對這個版本來說是錯的。

---

## License

MIT。見 [LICENSE](LICENSE)。
