# 波点音乐桌面接入

波点使用独立的 `bodian` provider。普通前端调用通过 Omni，`bodianTransport` 仅向 Electron 的
`bodian-api-request` 发送已登记的操作。主进程负责平台请求、签名、设备标识和会话加密。
Web 端显示为运行环境不可用；没有默认外部代理服务。

## 当前实现与验收状态

| 能力 | 状态 |
| --- | --- |
| 平台入口、IPC 搜索、歌曲详情 | 已实现；Windows Electron 搜索已实测 |
| 公开歌单、专辑、歌手、推荐 | 已实现；对应原生读取接口已实测 |
| 逐字歌词 | 已实现；真实响应解码与合成时间样例测试通过 |
| 扫码登录 | **已停用**：验收发现返回身份与用户扫码账号不一致，交换协议未验证 |
| 会话恢复、个人歌单、我喜欢、收藏专辑 | **已停用**：不能把身份不符会话的响应计入验收 |
| 播放权限与音频地址 | 已实现；已验证试听和额外权限状态，完整音频播放尚待账号验收 |
| 喜欢/取消喜欢、歌单收藏及歌曲增删 | **未实现，`mutations` 保持关闭** |
| Web、短信登录 | 本期不包含 |

这份实现尚未达到“完整平台接入”的验收标准。不要把单元测试中的账号样例当作真实曲库验收。
后续必须使用用户新扫码建立的会话，不读取官方客户端已有凭据。

## 已核对的协议

API 主站为 `https://bd-api.kuwo.cn`。桌面头包含 `plat=win`、`channel=W1`、`ver=1.1.7`、
`svrver=13`、`devid`、`qimei36`。缺少必要头时搜索可能返回业务码 `402`。

| 操作 | 路径/重要参数 |
| --- | --- |
| 搜索 | `/api/search/music/list`，`keyword/pn/rn`；页号从 0 开始 |
| 单曲 | `/api/service/music/info`，`musicId` |
| 创建二维码 | `/api/ucenter/login/qrCode`，响应 `data.qrCode` |
| 扫码轮询 | `/api/ucenter/login/qrCodeStatus`，`qrCode`；已观察 1 等待、2 过期、3 已扫码确认 |
| 换取新会话（未验证） | POST `/api/ucenter/users/login`，JSON `{authType: 9, qrCode}` 曾返回身份不符的数据；禁止按成功登录使用 |
| 播放权限 | `/api/play/music/v2/checkRight`，`musicId/freeSign`，签名与 JSON body |
| 音频地址 | `/api/play/music/v2/audioUrl`，`devId/musicId/format/br/freeSign`，签名与 JSON body |
| 公开歌单详情 | `/api/service/playlist/info/{id}`，保留 `source` |
| 歌单曲目 | `/api/service/playlist/{id}/musicList`，`source/pn/rn`；页号从 1 开始 |
| 我喜欢的歌单 | `/api/service/playlist/fond`，`userId`；曲目来源为 5 |
| 自建歌单 | `/api/service/playlist/userCreate`，`userId` |
| 收藏歌单 | `/api/service/collect/4/list`，`userId/fromUid/pn/rn` |
| 收藏专辑 | `/api/service/collect/6/list`；待新会话验证。7 的真实返回是 `artistList`，不能用作专辑 |
| 专辑及曲目 | `/api/service/album/{id}`、`/api/service/album/music/{id}` |
| 歌手及曲目/专辑 | `/api/service/artist/{id}`、`/api/service/artist/music/{id}`、`/api/service/artist/album/{id}` |
| 推荐 | `/api/service/finds/playlist`、`/api/service/music/recommendList` |

二维码内容必须为：

```text
https://bodian-oia.kuwo.cn/bodian/download.html?pageName=login_pc&pt=3&id=<qrCode>
```

二维码标识本身、`login_pc?qrCode=...` 都不能作为扫码内容。联调截图应使用不同文件名，避免展示端缓存旧图片。

2026-09-20 撤回“扫码认证类型 9 已验证成功”的结论。HTTP/业务成功与返回 token 不证明扫码身份绑定。
`userCreate` 在匿名对照请求中同样返回空列表，不能作为登录有效性检查；公开资料也不能证明认证。
身份错配根因尚未确定，不把它归咎于用户账号或上游漏洞。需要核实扫码结果与交换参数的真实关联。
主进程现已阻止扫码及账号读取，初始化时移除旧加密会话，公开目录请求保持匿名。
本地验收进程已停止，隔离测试配置内的不可信会话已删除；未调用远端退出或撤销接口。

## 歌词、音频与缓存

- 歌词来自 `https://mlyric.kuwo.cn/mobi.s?f=bodian`；参数 `q` 为歌词请求的 Base64，响应 `data.content`
  也是 Base64。`[kuwo:...]` 的八进制数编码逐字时间系数，先还原，再交给现有 `parseAwlrc`。
- 已验证 `[kuwo:127]` 对应系数 8、7：标记 `<a,b>` 的偏移为 `abs((a+b)/16)`，时长为 `abs((a-b)/14)`。
  系数从文件读取，不固定写死；无有效逐字轨时回退到行歌词。
- 权限状态 3 返回试听信息；7 表示当前请求还缺少播放权限。试听不会写入完整歌曲的音频缓存，界面显示对应提示。
- 音质映射为 128k MP3、320k MP3、FLAC。Hi-Res 请求暂降至普通 FLAC，并返回实际选择的质量标识。
- 歌曲身份保留 `online:bodian:<id>`。歌单的 `source` 保留在 `providerData` 中；不以 `hasNextPage=false`
  单独判断结束，因为真实歌单响应中的 PageHelper 标志可能不正确。
- 凭据只在主进程持有，并通过 Electron `safeStorage` 加密。系统加密不可用时，仅保留本次运行的会话。

## 验证方式与剩余工作

使用 Node 24 以上和项目锁文件安装依赖。执行类型检查、`test/unit/onlineMusic/`、
`test/unit/lyrics/bodianLyrics.test.ts`、`test/unit/electron/bodianApiBridge.test.ts` 以及相关播放回归测试。

只读原生接口探针：`node test/manual/bodian-probe.cjs search`（另支持 detail、album、artist、lyric 等操作）。
桌面冒烟测试先启动 `npm run dev`，再运行 `node test/manual/bodian-desktop-smoke.cjs`。
它使用 `test-results/bodian-desktop-profile`，不修改用户正常的 Folia 配置。

人工账号联调入口 `test/manual/bodian-acceptance.cjs` 当前受主进程禁用保护，不应继续扫码或使用 `--resume`。
本地清理工具 `test/manual/bodian-clear-unverified-session.cjs` 只删除隔离配置中的会话键，不解密、不联网。

剩余验收顺序：新扫码登录 → 重启恢复 → 私人/公开/空歌单及大歌单分页 → 收藏专辑 → 真实完整音频播放
→ 核对歌单写入协议 → 在专用测试歌单实现并验证收藏、增删及失败后的缓存一致性。未核对写入协议之前，
保持写入能力关闭。
