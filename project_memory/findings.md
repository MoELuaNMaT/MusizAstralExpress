# 发现记录（初始化）

## 2026-04-05
- Git 工作区处于脏状态：大量已修改与未跟踪文件。
- 当前分支：`feat/mobile-android-bootstrap`（相对远端 ahead 2）。
- 本地 `main`：相对远端 ahead 15。
- 风险：在未明确“要合并哪些提交/文件”前直接 push 到 `main`，可能把临时或未验证内容带入主分支。

## 2026-04-05（分支合并执行）
- 已将 `feat/mobile-android-bootstrap` 通过 merge commit 合并到本地 `main`。
- 合并提交：`81d109b`。
- 冲突文件：`src/services/auth.service.ts`、`src/stores/auth.store.ts`，已按“保留 main 鉴权修复 + 接入新配置路径”原则解决。
- 推送状态：`git push origin main` 两次超时（网络连接 GitHub 443 超时），当前本地 `main` 相对 `origin/main` ahead 17。
- 代码检查：`npm run build` 通过（tsc + vite）。
- 审查风险：仓库已纳入大量 `.tmp/`、`dist-portable/`、`artifacts/` 大文件，存在仓库膨胀与泄露调试信息风险。

## 2026-04-05（清理提交）
- 已从 Git 跟踪中清理 `.tmp/`、`dist-portable/`、`artifacts/`、`.codex_sdk_list.txt`（仅移除索引，不删除本地文件）。
- 已在 `.gitignore` 增加对应忽略规则，避免二进制与调试文件再次入库。
- 已移除 `src/services/auth.service.ts` 中二维码登录调试 `console.log`。
- 清理后跟踪文件数：`296`（清理前 `933`）。
- 构建验证：`npm run build` 通过。

## 2026-04-09（启动链路与网易云扫码排查）
- `src/hooks/useAppEventListeners.ts` 会把任意 `_ready` 阶段当成全局 ready，导致只要单个本地服务端口可连通，就会提前分发 `LOCAL_API_READY_EVENT` 并开始隐藏启动遮罩。
- `src/hooks/useLocalApiBootstrap.ts` 在 `ensure_local_api_services` 返回后还会固定 650ms 关闭遮罩，ready 判定与真实可用状态脱钩。
- `src/pages/Login.tsx` 在本地 API 未 ready 时仍允许触发二维码/账号登录，请求会直接撞上启动竞态窗口。
- `src/services/auth.service.ts` 的网易云二维码确认分支直接轮询 `/user/account`，没有先基于最新 cookie 校验 `/login/status`，且用户信息解析只兼容顶层 `profile`，未覆盖 `data.profile`/`data.account` 结构。

## 2026-04-09（目录清理 Phase 1）
- 已执行低风险目录清理：删除 `.tmp/`、`artifacts/`、`dist/`、`release/`、`research_add_time/`、`.codex_sdk_list.txt`。
- `dist-portable/` 采用保守策略，仅删除历史 `r2` 版本，保留最新 `ALLMusic-0.1.0-portable-win64/` 与对应 zip。
- 本轮约释放磁盘空间 `1691.5 MB`。
- 未触碰 `.worktrees/`、`.gradle-android/`、`.cargo-home/`、`.vendor/`，避免影响并行开发与后续构建缓存。

## 2026-04-09（目录清理 Phase 2 筛查）
- `.worktrees/` 之外的主要空间占用来自本地构建缓存与运行环境：`.gradle-android/` 约 `1637.87 MB`、`.cargo-home/` 约 `427.48 MB`、`.vendor/qq-adapter-venv` 约 `38.79 MB`。
- 这些目录均未被 Git 跟踪，删除不会影响仓库内容，但会显著增加下次 Android / Tauri / QQ 适配器的冷启动成本。
- `.project-memory/` 为旧记忆目录，体积很小但与 `project_memory/` 职责重复，可在后续人工确认后移除。

## 2026-04-09（Windows 便携版重新打包）
- 已基于当前修复后的代码重新执行 Windows 打包。
- `scripts/build-portable.ps1` 仍存在 PowerShell 下调用 `npm` 被误解析为 `pm` 的问题，已通过 `npx tauri build` + 手动 `npm.cmd ci --omit=dev` 的方式完成便携包组装。
- 新便携包路径：`dist-portable/ALLMusic-0.1.0-portable-win64.zip`，已补齐生产依赖后的 `node_modules`（约 `63.53 MB`）。

## 2026-04-09（登录入口收口与失效弹窗）
- `src/pages/Login.tsx` 与 `public/v4-glam/*` 原先同时保留了扫码、手机号/邮箱、Cookie 等多条登录入口；即使新 UI 收口，旧主题仍会继续暴露旧登录方式。
- 原登录失效检测只存在于 `src/hooks/useHomeData.ts`，检查频率为 `20` 分钟，且只写页面文案，不会立即弹窗；在旧 iframe 主题下该 hook 也不构成全局约束。
- 桥接层对外暴露了 `neteaseCellphoneLogin` / `qqCookieLogin`，旧主题脚本可以直接调用这些接口，因此要真正下线旧方式，必须同时收口桥接类型与实现。

## 2026-04-09（复古车机播放器验证版）
- `src/components/player/player-bar.tsx` 原实现同时承载歌词详情、队列、播放模式、音量弹层与错误交互，UI 重构时很容易把“换皮”做成“重写播放器”。
- 当前真实播放链路已经稳定落在 `usePlayerStore + useAudioPlayer + player.service.ts`，播放器视觉改造可只消费现有状态与控制函数，无需增加新接口。
- `src/index.css` 才是当前 React 入口样式文件；`src/styles.css` 未在主入口导入，新增播放器样式必须落在 `src/index.css` 才会生效。
- VFD 信息区如果继续把音量放在顶部，会和实体旋钮形成重复信息；更符合直觉的映射是“歌名 -> 歌手 -> 歌词”，音量只保留在旋钮区域。
- 当前右侧频谱仍是程序动画，不是基于真实音频采样的 FFT；如果需要真实波谱，下一步应在 `useAudioPlayer` 上接 `AudioContext + AnalyserNode`。
- 新增歌词模式旋钮后，VFD 两行歌词不再只有单一语义：原文 / 中文档显示“当前句 + 下一句”，双语档显示“当前句原文 + 当前句中文”，两种模式必须分开计算，不能复用同一对歌词文本。
- 中部控制区如果保持“运输按钮一列 + 功能键一列”的双列布局，歌词模式旋钮永远无法和显示屏、底部进度区的最右边界对齐；要满足右侧对齐，运输区必须改成整行铺满。
- 仅把运输按钮组贴左、旋钮贴右的纯弹性布局仍然不符合视觉稿；中间必须保留独立的留白面板，形成“左按钮组 / 中间空面板 / 右旋钮”三段式同排结构。
- 上一条里的“中间空面板”判断是错的：视觉稿中的中段实际承载 6 个白色功能键，不是纯占位。正确结构应为“左播放键 / 中间功能键 / 右歌词旋钮”同排三段。
- 歌词模式旋钮的三颗状态灯如果直接贴容器边缘，会和标签挤在一起，视觉上也不会围绕旋钮中心。正确做法是扩大旋钮工作区，并按旋钮中心做等距三点布局，再把旋钮本体适当下移给顶部灯位留空间。
- 如果只旋转中心指针，旋钮仍然会被感知成“无极音量旋钮”；要做出三档拨位感，应该改成“整个旋钮头离散旋转”，再用多层 `conic-gradient + radial-gradient + box-shadow` 叠加出金属壳、拨档手柄和玻璃灯罩。
- 上一版“拨档手柄”方向依然偏离参考图；更贴近车机语义的做法是使用“黑色圆柱旋钮 + 金属底座环 + 顶部短白刻线”的组合，让控件首先被识别为旋钮，再通过三档离散旋转表达状态。
- 旋钮的侧裙滚花如果直接裁在整张圆面上，会出现“银色楔形 + 黑色条纹糊在一起”的错误观感。正确结构必须分成底座环、内圈阴影、圆柱侧裙和顶部圆盖四层，滚花只出现在侧裙。
- 如果底座和旋钮头还共用同一层旋转面，透视关系仍然会错，表现成“黑球坐在银色陀螺上”。要先把静态底座和可旋转转子拆成独立 DOM/图层，再分别画圆柱侧裙和顶盖。
- 当前项目里已经有一个视觉成立的旋钮，就是音量旋钮。对字幕模式旋钮继续自定义造型的收益很低，直接复用音量旋钮的结构和材质，再叠加三档角度与灯位，是更稳的最短路径。
- 字幕旋钮复用音量旋钮后，环形发光会和上方 `ORIG / CN / A+B` 文字竞争视觉层级；当前更合理的处理是去掉环灯，并通过增大容器高度把旋钮整体下移，保留指针角度和选项灯位的对应关系不变。
- 白色功能键如果通过整体 `translateY` 下移来表示“按下”，会导致灯和按钮一起移动，且底边错位，不符合实体按键体验。更合理的做法是保持按钮底边和灯位静止，只通过减少底边厚度与阴影变化表达“按下”。
- 白色功能键的机械演出不能让“按下”和“点亮”同时发生，否则反馈会显得太网页化。更接近实体按键的节奏是：默认厚底 `8px` 压到 `1px`，短暂停顿，随后灯和图标点亮，再回弹到激活稳态厚度 `3px`。
- 白色功能键的标签如果继续留在按钮面内，会削弱机械感并挤压图标。更符合面板层级的做法是：上方小灯、灯下白字、下方按钮面只保留放大的图标。
- 音量旋钮如果继续显示完整一圈环槽，会传达“可 360 度旋转”的错误语义。当前旋钮只有有限角度范围，所以外圈槽必须收敛为与最小/最大角度一致的弧形槽，底部不可旋转区不应再显示。
- 上一轮只改动外圈发光层还不够，因为音量旋钮的完整圆形底座本身也在传达 360 度槽。要真正改成 270 度槽，必须把 volume 旋钮的 shell 从完整圆底座切换成弧形槽底座，发光层只作为辅助。
- 单一 270 度弧槽虽然语义正确，但还不足以表达音量分档。当前更合理的表达是 10 格扇形刻度：左 3 绿、中 4 黄、右 3 红，每 `10%` 点亮一格，未亮状态保留对应色系的暗色版本。
- 10 格扇形如果直接用全局绝对角度去画，超过 `360deg` 的部分会导致只显示半圈；正确做法是让每格使用相对于 `270deg` 总弧段的局部角度，再统一从 `225deg` 起始角展开。环带厚度也必须同步放大，否则“分段”成立了但“槽宽”仍然不对。
- 仅把扇形刻度画粗仍然不够，因为用户需要看到的是“嵌在槽里的分段”。因此音量旋钮必须先有一个明确可见的 270 度黑色厚槽，再把 10 个彩色扇形格以内缩方式嵌入这个槽体，而不是直接把彩色扇形贴在背景上。
- 如果槽体盖住了扇形，说明层级顺序还是错的。正确顺序必须是：槽体在最下层、扇形刻度在中间层、旋钮本体在最上层；同时槽体环带要比扇形本身更厚，扇形只是嵌在槽里的一圈内层刻度。
- 这类小尺寸环形分段在纯 CSS `mask + conic-gradient` 下容易出现“看不见扇形”或层级判断失真。当前更稳的实现是直接用 SVG 路径绘制 270 度槽体和 10 个扇形段，几何、厚度和层级都更可控。
- 用户需要的不是“细刻度条”，而是“宽厚扇形块”。这要求扇形段的径向厚度显著增加，同时槽体的内外半径再向外扩一圈，形成“更大的槽里嵌着更厚的分段”的关系。
- 进度条如果把时间放在框外、红针按整框宽度移动，会同时破坏读数层级和机械轨迹。更符合当前车机面板语言的做法是：时间直接放进框内左右两端，删除 `0~100` 数字刻度，红针只在第一根和最后一根刻度线之间移动。
- 进度框上移不能追求“越贴越高”，否则会高过左侧音量弧槽。正确关系是只上提少量，与音量弧槽顶点大致齐平；框内层级也应固定为“上刻度、下时间”，而不是反过来。
- 当前进度红针如果继续用“上端尖三角 + 中段漂浮”的表现，会和复古表头背光语义冲突。更贴近参考图的做法是：用一根从槽底长出的细圆柱作指针，并在槽内叠一层只照亮下方约三分之二高度的柔和橙黄渐变光柱。
- 进度暖光层和红针不能共用同一参照系。暖光应该是整条槽内、从底部向上覆盖约三分之二高度的背光；红针则必须单独锚定在槽底，并且压在刻度上方，不能再被刻度遮挡。
- 进度暖光如果继续依赖 `blur` 做“雾状透光”，会偏离参考图的表头感。更接近目标的是一层覆盖整槽下方三分之二区域的纵向渐变光幕，再用底部遮罩把红针的下半段埋进槽底，让它看起来是从底板里伸出来的。
- 进度条如果没有独立的“刻度槽”容器，暖光和红针就只能对齐外框而不是槽体，红针也无法被正确裁切。要满足“对齐槽底 + 超出部分被槽遮住”，必须把槽体单独抽成一层，并让刻度、暖光和红针都挂在这层里。
- 用户所说的“刻度槽”不是上方那条刻度带，而是容纳刻度与时间的整块内凹深色面板。进度暖光、红针和时间都必须绑定到这整块槽体里；如果时间留在槽外，就会再次把参照系带偏。
- 进度槽底部的遮罩如果做得过厚，会把已经贴底的暖光和红针重新“盖出一条缝”。正确做法是让遮罩只承担裁切作用而不是再制造明显高度，暖光和红针则继续保持 `bottom: 0` 贴底。
- 在当前进度槽里，额外的底部遮罩层反而容易制造“离底部还有一截”的错觉。更稳定的做法是让 `dial-track` 自己通过 `overflow: hidden` 完成裁切，灯和针直接延伸到槽底，再由槽体边界自然截断。
- 进度暖光层如果渐变语法失效，视觉上会像“整层灯消失”，容易被误判成层级问题。当前外层槽底部背光必须使用有效的纵向渐变，并压在最底层背景位，不能再和红针竞争前景层级。
- “为什么一直找不到外层槽”的根因不是参数，而是 DOM 里根本没有独立的内层槽。只有一个 `dial-track` 时，所谓内层槽只是视觉假象，背光、刻度和红针都被迫共享同一个定位上下文。要真正分离外层背光和内层红针，必须新增显式的 `dial-scale-slot`。
- 上一条里的“必须新增 `dial-scale-slot`”结论是错的，因为当前 UI 里真实存在的只有两层槽：外层黑槽 `dial` 和中层内容槽 `dial-track`。再新增一个显式内槽只会制造第三层视觉。正确修复是让底部背光回到 `dial`，刻度和红针留在 `dial-track`。
- 即便把背光挂回了 `dial`，只要 `dial-track` 继续占满同一块底部区域，背光仍然会被中层槽的实色背景完全盖住。要让外层背光重新可见，必须给 `dial` 底部留出一条真实的可见带，而不是只调整背光自己的渐变。
- 外层背光即使挂在 `dial`，只要它继续使用与 `dial-track` 相同的左右 inset，看起来仍然会像“中层槽底边发光”。要让它被感知为最外层黑槽的背光，几何边界必须对齐 `dial` 的内边界，而不是对齐 `dial-track`。
- 当用户确认最外层黑槽才是最终参照系后，红针也不能继续锚在 `dial-track`。正确做法是让红针回到 `dial`，只保留横向位置与刻度区对齐，这样纵向基准和背光层级才一致。
- 在当前外层槽方案里，红针长度和背光高度不再通过新增容器控制，而是直接按外层槽比例调参：红针可见长度约为槽高的三分之二，背光高度约为槽高的一半。
- 如果用户不希望视觉上看出“双槽”，`dial-track` 只能继续作为定位容器存在，不能再保留独立背景和内阴影；否则即便结构正确，人眼仍会把它读成第二层槽。
- 外层背光如果完全静止，会显得像死板的色块。当前更合适的处理是给它加低频呼吸和轻微横向扫光，保持复古仪表的“通电感”，但不能变成高频霓虹动画。
- 底部大刻度槽的整体垂直位置仍由 `dial-wrap` 控制。只要这里保留负 `margin-top`，整块进度槽就会持续被上提，和左侧音量旋钮中线难以对齐；对齐问题应优先在这一层修，而不是去动内部槽体。
- 外层背光即使有了动态，如果顶部只有主渐变本体，仍然容易出现一条硬切线。更自然的做法是在灯带顶部再叠一层向上扩散的模糊柔光，让亮区边缘从“截断”变成“消散”。
- 背光动画如果只做单向扫光，首尾会因为 `background-position` 回跳而显得突兀。更平滑的做法是在同一轮关键帧里回到起点，形成往返式循环，而不是在循环边界瞬间重置。
- 音量读数如果继续拆成 `VOL + 数字` 两行，小尺寸下视觉重心会过低且信息重复。当前更合理的表达是只保留单一大数字，让读数本身占据原来两行文字的高度。
- 音量读数进一步收敛后不需要 `%` 单位；当前面板语义更接近硬件数码管，显示层直接输出 `00~99` 两位数字即可，`100` 也封顶显示为 `99`。
- 音量数字的最终垂直位置不能只停留在旋钮下方文字区，而应进一步抬到上方弧槽空缺里。这个位移应继续在 `knob-caption` 层完成，不需要改动旋钮本体或弧槽几何。
- 右下角平台拨动开关不能只读登录态，否则无法区分“已登录但本地服务挂了”。正确状态必须是“登录态 AND 本地 API 服务态都正常”才算 on；任一平台 cookie/user 丢失或 `serviceState !== ready` 都应显示 off。
- 底部 `STATUS` 说明条在当前复古车机布局里没有独立价值，只会制造一层不该存在的面板和空白。删除后应直接把平台开关挂到播放器主体右下角，并让开关自己承担状态表达。

## 2026-04-10（复古车机播放器单文件导出）
- 已新增 `design/player_2.html`，用于承接当前“复古车机播放器”调整后的单文件设计稿。
- 该页面已用本地静态服务 + 浏览器快照验证，页面可正常渲染，控制台无报错。

## 2026-04-10（player_4 新 UI 接入实现）
- `src/App.tsx` 当前对 current UI 的真实入口已经切换到 `src/components/retro/retro-shell.tsx`；`HomePage` / `LoginPage` 仍在仓库中，但 current UI 默认路径不再直达这两个页面。
- `src/components/player/player-bar.tsx` 仍然是唯一真实播放器展示层，播放链路没有变化；本轮只新增了 `EJECT` 回调和平台拨杆点击语义，没有引入第二套播放状态。
- 新增的 `src/components/retro/retro-library-view.tsx` 不是一套新业务层，而是把 `useHomeData / useHomeHandlers` 现有数据与动作重新排进 `player_4` 风格的库视图；歌单、搜索、每日、历史依然落在原有业务函数上。
- 新增的 `src/components/retro/retro-auth-overlay.tsx` 直接复用 `authService.neteaseQRCodeLogin / qqQRCodeLogin`；扫码成功后调用 `useAuthStore.setUser` 回写状态，不再依赖 `LoginPage` 里的局部状态机。
- 构建验证已通过：`npm run build` 成功。当前尚未做运行时视觉回归和实际扫码手测，因此剩余风险主要在交互细节与样式对齐，而不是类型或打包层。

## 2026-04-10（player_4 真正 1:1 运行时接入）
- 前一版问题的根因不是功能没接上，而是仍然沿用了 `src/index.css` 里的 `am-retro-player__*` 视觉体系，只借了 `design/player_4.html` 的层级关系；这会导致运行时看起来像“简化模仿版”而不是设计稿本体。
- 当前运行时已经改为由 `src/components/retro/retro-shell.tsx + src/components/retro/player4.css` 直接承接 `design/player_4.html` 的 DOM 分段、类名语义、视觉 token 和关键动画；旧 `am-retro-player` 视觉层不再参与 current UI 渲染。
- `deck-view` 已完成真实接入：磁带仓、VFD 屏、16 列频谱、模式键、歌词旋钮、环形音量盘、表头式进度槽、QQ/NCM 摇臂开关都已经切到 `player_4` 风格，而底层播放状态仍继续只读 `usePlayerStore + useAudioPlayer`。
- `playlist-view` 已改为固定 6 盒磁带：`mixed / daily / search / qq-liked / netease-liked / history`。QQ 与网易云都只展示各自“我喜欢”；搜索磁带会把右侧头部切换成搜索控制台，而不是普通歌单头图。
- `osc-overlay` 已切到示波器 UI：当前扫码流程仍复用 `authService`，但运行时弹层已经是 `player_4` 的 CRT 外壳、双 LED 和 `MATCH / SUCCESS / FAILED` 节奏，不再是普通对话框。
- 本轮视觉冒烟已完成：本地开发页抓图确认 deck、playlist、osc overlay 三个主视图都已经渲染为 `player_4` 体系，而不是旧 retro shell。截图文件位于 `artifacts/player4-smoke.png`、`artifacts/player4-playlist-smoke.png`、`artifacts/player4-overlay-smoke.png`。
- 新发现的 UX 漏口是：资料库页原先只能靠“点歌播放”回到 deck，空列表场景没有返回路径。现已在 `playlist-view` 头部补上 `Insert Deck` 动作，并复用既有插带动画闭环。
- 旧的 `src/components/retro/retro-library-view.tsx` 与 `src/components/retro/retro-auth-overlay.tsx` 已确认没有任何运行时引用，现已删除，避免仓库继续保留两套并行 UI 壳。

## 2026-04-10（player_4 细节修正）
- 示波器弹层的根因不是动画素材，而是状态机把“扫码确认”与“资料同步完成”混成了一个成功事件。当前已拆成：`QR 等待 -> sync 波形匹配 -> 资料同步 -> success 关闭`。只有登录成功且“我喜欢 / 今日推荐”两个任务都完成后，两个 LED 才会逐个点亮并关闭弹层。
- `useHomeData.loadPlaylists()` 与 `useHomeData.loadDailyRecommendations()` 现在都会返回显式 `success` 标志，供 `retro-shell` 的扫码状态机判断同步任务是否真的完成，而不是只靠动画时间推进。
- 字幕旋钮的三个状态标记已经重新定位：`CN` 固定在顶部中间，`ORIG / A+B` 分别移到旋钮左右上方，避免和旋钮本体互相重叠。
- 字幕旋钮后续又补了一次修正：旋钮本体不再用不对称 `inset` 摆位，而是改为中心定位，避免视觉上“歪着挂”在右下角。
- 播放控制键与功能键的图标对齐问题是按钮内部布局缺少居中容器所致；当前 `transport-btn` 与 `mode-btn` 都改为 flex 居中，图标不再贴左。
- 歌单页返回入口已明确收敛成 `← 返回 Deck`，不再用弱语义的 `Insert Deck` 文案。
- “歌词模式颜色”最终分成两层语义：旋钮周围档位字母/指示灯是一层，VFD 显示区里的字幕文本是另一层。当前 `original / translated / bilingual` 三种模式都已经通过 `lyric-view` 模式类分别控制 VFD 文本颜色，不再只有双语档着色。
- 歌词模式的另一个真实问题是“单轨歌词会把双语模式一起拖死”。当前已增加歌曲开始时的一次性歌词可用性检查：若只有原文，则自动切到 `original`；若只有翻译，则自动切到 `translated`；若双语都存在，则保持当前模式不动。
- 共享音频链路现在已经接入 `AnalyserNode`，可从单例 `HTMLAudioElement` 直接读取真实频谱数据，不需要新增后端接口。
- `player_4` 的 VFD 右上角已增加平台 logo 区与频谱模式切换区：当前歌曲来自 QQ / 网易云时，会显示对应小 logo；频谱支持 `REAL / SIM` 切换，便于与旧循环动画直接对比。

## 2026-04-10（缩略图封面报错与真实频谱静默）
- 控制台里反复出现的 `Failed to set thumbnail cover: HRESULT(0x80070057)` 根因在 Windows 缩略图窗口属性未完整声明。当前已在 `src-tauri/src/desktop.rs` 的 `setup_thumbnail_toolbar()` 中补上 `DWMWA_FORCE_ICONIC_REPRESENTATION` 与 `DWMWA_HAS_ICONIC_BITMAP`，让 `DwmSetIconicThumbnail` 的参数前置条件成立。
- 真实频谱不动的高概率根因不是 UI 渲染，而是共享音频的 `AudioContext` 处于 `suspended`。当前已在 `src/hooks/useAudioPlayer.ts` 中增加 `resumeSharedAnalyserContext()`，在实际播放启动和 `playing` 事件时主动恢复分析器上下文。

## 2026-04-10（真实频谱导致静音播放）
- 上一条关于“只要恢复 `AudioContext` 就够了”的判断不成立。真实根因是 `src/hooks/useAudioPlayer.ts` 在接入真实频谱时使用了 `createMediaElementSource(audio) -> analyser -> destination`，把共享音频元素的输出链接管进了 Web Audio。
- 一旦该 `AudioContext` 没有稳定恢复，播放器就会出现“时间和歌词在走，但没有声音，频谱也不动”的症状，因为媒体元素已经不再直接走默认音频输出。
- 当前已改为通过 `audio.captureStream()` / `createMediaStreamSource()` 做旁路采样：频谱分析只读取音频流，不再承担声音输出职责，因此真实频谱失效也不会再把播放器静音。
- Windows 缩略图封面报错的另一层根因也已确认：当前代码是主动调用 `DwmSetIconicThumbnail`，不符合这个 API 的典型使用时机。现已改成“缓存封面 -> `DwmInvalidateIconicBitmaps` -> 在 `WM_DWMSENDICONICTHUMBNAIL` 消息中按系统请求尺寸渲染”，避免继续用错误时机直接设置缩略图。
- `captureStream()` 在媒体元素尚未输出有效音轨时会返回“无音频轨”的 `MediaStream`。如果此时直接执行 `createMediaStreamSource()`，浏览器会抛 `MediaStream has no audio track`。当前已在 `ensureSharedAnalyser()` 中显式检查 `stream.getAudioTracks().length`，只有拿到真实音轨后才创建分析源。
- 上一条关于“改成响应式渲染缩略图即可稳定”的判断也不成立。实测表明，只要在 Tauri 主窗口上继续驱动 DWM 封面位图链路，播放时就可能伴随主窗口内容消失。当前已彻底移除缩略图封面位图更新，只保留缩略图工具栏按钮。
- 当前远端播放链接会被浏览器视为跨域媒体数据，因此 `HTMLMediaElement.captureStream()` 会抛 `Cannot capture from element with cross-origin data`。这不是频谱算法问题，而是浏览器安全限制。
- 当前已将真实频谱链路改为“能抓则抓，抓不到就立即判定当前曲源不支持 REAL，并自动退回 SIM”，同时在共享 `audio` 上提前设置 `crossOrigin='anonymous'`，只为那些本身支持 CORS 的音源保留真实频谱的可能性。
- QQ 本地服务现已新增 `/song/stream?target=...` 代理流端点：服务端向上游音频 URL 发起请求并透传字节流，保留 `Range / Content-Range / Content-Type` 等播放关键头。这样前端实际播放的是 `localhost:3001` 资源，不再直接播放第三方 CDN 地址。
- `player.service.ts` 现已把 QQ 播放 URL 统一包装为本地 `/song/stream` 地址；因此在 QQ 曲源上，`REAL` 频谱终于具备成立的前提条件。网易云仍然走远端 URL，暂时继续受跨域限制。

## 2026-04-11（真实频谱隔首生效根因）
- `src/hooks/useAudioPlayer.ts` 里共享分析器原先只在 `MediaStream.id` 变化时重建 `MediaStreamAudioSourceNode`，但浏览器切歌时可能复用同一个 `MediaStream`，仅替换底层音轨。
- 在这种情况下，频谱采样链会继续挂在上一首的捕获图上，表现成“这首有、下一首没有、再下一首又恢复”的隔首异常。
- 切歌过渡期里 `audio.currentSrc` 可能仍指向上一首；如果分析器继续优先读取它，就会把错误的歌曲边界带进重绑判定。
- 当前 REAL 频谱实现本身并没有按平台做限制，实际判定条件只有“当前 `audio` 源能否被浏览器捕获”。因此 QQ 打通本地代理后，网易云只要返回的链接本身满足捕获前提，也会一起出现真实频谱。

## 2026-04-11（真实频谱演出化）
- 当前 `player_4` 的 REAL 频谱已不再是“FFT 均分 + 直接亮段”，而是改为 20 根 Mel/对数感知频带，频率范围固定在 `32Hz ~ 16kHz`。
- `useAudioSpectrum()` 已从 `getByteFrequencyData()` 切到 `getFloatFrequencyData()`，并固定 `fftSize=1024`、`minDecibels=-92`、`maxDecibels=-18`、`smoothingTimeConstant=0.55`。
- 每根柱子当前都维护了独立的 `displayLevel + peakLevel + peakHoldUntil`，实现 attack/release 平滑和 peak hold 小帽子；暂停或无信号时不会瞬间清零，而是自然回落。
- `RetroShell` 的 REAL / SIM 现在统一复用同一套 20 列 DOM 和峰值帽渲染层，切换模式不会再触发频谱区版式跳变。

## 2026-04-11（真实频谱动态窗口增强）
- 当前视觉上“左侧常年顶格、整体只抖 2~3 格”的根因不是平滑太重，而是所有频带本质上仍在使用接近统一的映射尺度，长期强能量频带缺乏独立波动空间。
- `useAudioSpectrum()` 现已为每个频带增加独立 `adaptiveFloor / adaptiveCeiling / previousNormalized` 状态：每根柱子都按自己的近期低位和高位做归一化，而不是继续用同一把静态尺子。
- 低频前 5 根现在额外经过顶部软压缩，避免持续高能量时长期焊死在顶格。
- 当前显示值已改成“当前能量 + 正向变化增强”混合，因此不只表现“现在多大”，也会强调“刚刚是不是往上冲了”，让整块频谱更会跳。

## 2026-04-11（真实频谱拖尾与区间再分配）
- 当前 peak hold 的下降速度已减半，视觉上改成更轻、更慢的“飘落”，不再像前一版那样回收偏快。
- 频谱柱体当前已从“整列同亮度常亮”改成“亮头 + 暗尾”语义：每列只有最顶的当前状态格最亮，下方已激活段会按距离快速变灰，但不会完全熄灭。
- 当前显示区间新增了一层 piecewise remap：底部低值区被进一步压缩，高敏感中段被扩展，给真正有起伏的区域多腾出了约两格视觉空间。

## 2026-04-11（真实频谱主体回落与冲高增强）
- 当前主体柱体的 release 已从 `260ms` 放慢到 `420ms`，使其回落速度明显慢于上冲，但仍然快于 peak hold 的帽子回收。
- 当前多数柱子只能停在半腰的一个原因，是 `gain + 动态窗口 + display remap` 共同把上半区压得过紧。现已同步上调各频段增益、降低动态窗口的 floor/headroom、并重新开放高位映射区。
- `changeBoost` 权重也已上调，高潮和瞬态增强时更容易把柱体推入上半区，从视觉上拉开前奏与高潮的差距。

## 2026-04-11（真实频谱 PCEN / flux 混合）
- 继续只靠 `pow`、全局增益和静态窗口手调，频谱会更容易出现“鼓点很明显，但持续性人声/和声/铺底不够动”的失衡；问题根因是显示值仍然过度依赖瞬时绝对幅度。
- 当前 `useAudioSpectrum()` 已改为三路混合：`absoluteEnergy` 表达绝对响度，`PCEN-like energy` 表达相对近期平均值的抬升，`fluxEnergy` 表达当前是否正在发生明显变化。
- 每个频带现在都额外维护 `pcenSmoothingRef + previousEnergyRef + fluxLevelsRef`，分别用于自动增益平滑、相邻帧变化检测和变化能量包络；这样频谱不只看“现在多高”，也看“这一带刚刚有没有冲起来”。
- 低频顶格问题本轮不再主要靠硬压顶部解决，而是先通过更低的 `floorRatio`、更大的 `headroom/minWindow` 重新打开动态空间，再只对最左前 4 根做轻度顶部软压缩。

## 2026-04-11（频谱红色高亮）
- 频谱顶部红色原先偏粉橘，亮度有但“刺目感”不够，尤其在黄段上方容易显得发奶、发糊。
- 当前频谱专用红色已改成更高饱和度的霓虹朱红，同时同步增强了 red head / crest / cap 的双层 glow，目标是让顶部红段先被读成“警报式热峰值”，而不是温和暖色过渡。

## 2026-04-11（VFD 位图宋体试接）
- `player_4` 显示屏区域当前已试接本地字体 `front/WenQuanYi.Bitmap.Song.12px.ttf`，应用范围只收敛在 `vfd` 屏及右上角数显控件，不影响磁带标签和其他操作区。
- 位图字体接入后，标题粗细已从 `700` 收回 `400`，并对行高/字距做了轻调，避免假粗体导致发糊。
- 构建产物显示这份字体被完整打包进前端资源，体积约 `6.4 MB`；如果最终确认采用，后续需要考虑子集化或更轻量的格式，否则对包体不友好。

## 2026-04-11（DSEG 数码读数试接）
- 底部音量数字与播放进度时间数字当前已切到 `front/DSEG7Classic-Bold.ttf`，只作用于 `.knob-caption` 和 `.dial-time`，不影响歌单时长等普通文本。
- 这类七段数码字体更适合固定宽度数字读数，因此当前同步增加了 `tabular-nums` 和轻微字距控制，避免 `00`、`12:34` 这类内容在切换时抖宽。
- `DSEG7Classic-Bold.ttf` 打包后体积仅约 `23 KB`，适合作为局部数码字体长期保留。

## 2026-04-11（歌单区重构与网易云喜欢修复）
- 当前“网易云我喜欢显示本地 API 未启动/端口不可达”的根因不是 3000 端口真的没起；`npm run smoke:services` 已确认 `/login/status` 与 `/user/playlist` 正常。真实问题在于 liked 详情链路会在回退时继续使用可能为 `0` 或过期的 `playlist.originalId` 去请求 `/playlist/track/all` / `/playlist/detail`。
- `src/services/library.service.ts` 现已把网易云 liked 详情链路收紧为“先解当前用户 ID，再重解官方 liked playlist id，再决定回退 endpoint”；错误文案也改为优先保留真实请求路径和原因，只在真正的连接失败时才提示本地 API 不可达。
- `src/components/retro/retro-shell.tsx` 的 `playlist-view` 现已从 6 盒独立磁带改为 4 个入口：喜欢叠放、每日叠放、搜索、历史；喜欢组和每日组都通过重复点击同一叠放磁带循环切换子源。
- `src/components/retro/player4.css` 现已移除歌单头部的 tag 行，把返回 Deck 收口为库视图左上角统一按钮，并把歌曲数量挪到 `Play Tape` 右侧的小计数胶囊；头部 padding 和封面尺寸同步压缩，给曲目列表腾出更多高度。
- `src/hooks/useHomeHandlers.ts` 的滚轮处理不再直接照搬浏览器原始 `deltaY`；当前会先统一 `deltaMode` 单位，再按虚拟列表测得的 `itemHeight` 累加并量化为固定步长，实现“一次滚动移动一首歌”。

## 2026-04-11（网易云喜欢仍无法加载的根因）
- 当前桌面端持久化的网易云 `userId` 可能不是网易云账号真实 `userId`，而是手机号样式的旧值；实测本机存储里是 `17505726888`，但 `/user/account` 返回的真实账号 `id/userId` 是 `345573175`。
- `src/services/library.service.ts` 里的 `resolveNeteaseUserId()` 之前会优先信任这个本地状态值，导致 `/user/playlist`、liked playlist 识别和详情链路在“cookie 有效但本地 userId 脏”的情况下走歪。
- 当前已改为“优先用 cookie 对应的 `/user/account` 实时账号 ID，只有实时接口取不到时才回退到本地状态”，并补齐 `data.profile / data.account` 返回结构解析。

## 2026-04-11（本地 API 掉线后 UI 状态滞后）
- 当前桌面端本地 API 只会在应用启动时尝试拉起一次；之后如果 3000/3001 端口上的子进程退出，前端 `serviceState` 仍会保留 `ready`，因为它只依赖启动阶段事件，不做持续健康检查。
- 实测本轮排查时 `Get-NetTCPConnection` 已确认 3000/3001 无监听，但 UI 仍能进入歌单详情流程，最终在请求 `/user/playlist` 时才以“本地 API 不可达”失败。
- 当前已在 `src/App.tsx` 增加桌面端健康检查与自动恢复：周期探测 `127.0.0.1:3000/login/status` 和 `127.0.0.1:3001/health`，一旦掉线就重新调用 `ensure_local_api_services`。

## 2026-04-11（网易云喜欢报 `/user/playlist` 不可达 的最终根因）
- 实测确认：项目中实际使用的网易云 API 当前可用，`npm run smoke:services` 通过；带当前持久化 cookie 直连 `http://127.0.0.1:3000/user/account` 与 `http://127.0.0.1:3000/user/playlist` 也都返回 `code=200`，说明服务和登录态本身成立。
- 项目当前前端与本地服务脚本都已切到 `127.0.0.1:3000/3001`，但 `src-tauri/tauri.conf.json` 的 CSP 仍只放行 `localhost` 与 `10.0.2.2`，未放行 `127.0.0.1`。
- 在 Tauri WebView 中，这会把对 `127.0.0.1` 的 `fetch` 拦成网络错误；`library.service.ts` 又会把这类 `fetch failed` 统一映射成“本地 API 服务未启动或端口不可达”，于是表面看像服务挂了，真实根因其实是桌面端 CSP 白名单不一致。

## 2026-04-11（搜索结果被提示文案覆盖）
- `src/components/retro/retro-shell.tsx` 的搜索页状态判定此前把 `searchWarnings.length > 0` 直接视为阻断态，优先渲染 `warn-list`，导致歌曲列表完全不渲染。
- 但 `src/services/library.service.ts` 的 `searchUnifiedSongs()` 中，`warnings` 不只承载失败信息，也会承载信息性提示，例如“跨平台去重了多少首歌”；这类提示在搜索成功时本来就可能出现。
- 结果是：只要搜索命中跨平台重复歌曲，哪怕 `result.songs` 已经正常返回，搜索歌单区仍会被提示块覆盖，看起来像“搜索结果没有正确展示”。

## 2026-04-11（滚轮一次跳两行）
- 歌单区滚轮此前不是“步长算大了”，而是同一个容器同时绑定了 `onWheel` 和 `onWheelCapture`，并且两者都调用同一个 `handleScrollableWheel()`。
- 由于当前处理器里已经 `preventDefault + stopPropagation` 并手动按 `itemHeight` 推进滚动，双绑定会让同一轮鼠标滚动被处理两次，结果表现成“每次滚动两行”。
- 当前修复方式是删除列表容器上的 `onWheelCapture`，统一只保留一个 `onWheel` 入口；这样不改业务逻辑，也不引入额外事件去重状态。

## 2026-04-13（Tauri 桌面开发启动卡在 Waiting）
- 当前 `feat/ui-optimization` 与 `codex/newUI` 在提交层面是同一个 commit；问题来自工作区改动与本地启动配置的组合，不是新的分支提交历史。
- `npm run tauri:dev` 实际能够拉起 `beforeDevCommand`，日志可见 `vite` 已输出 `ready in ... ms`，但 Tauri 会持续打印 `Warn Waiting for your frontend dev server to start on http://localhost:1420/...`。
- 进一步 A/B 验证确认根因在 `vite.config.ts`：当前 `server` 只固定了 `port/strictPort`，未显式指定 `host`。在本机环境下，默认 `vite` 会监听到 `::1:1420`，但 `http://localhost:1420` 与 Tauri 的就绪探测都无法真正连通。
- 同一套代码下，手动以 `npm run dev -- --host 127.0.0.1` 启动后，`curl http://127.0.0.1:1420` 与 `curl http://localhost:1420` 都立即返回 `200`，说明问题不在 React 编译或页面代码，而在监听地址。
- 考虑到项目还存在 `src-tauri/tauri.android.conf.json -> http://10.0.2.2:1420` 的移动端调试链路，最终修复不能把 host 永久写死为单一地址；更稳妥的做法是“桌面默认 `127.0.0.1`，若 Tauri CLI 注入 `TAURI_DEV_HOST` 则优先使用该值”。
- `npm run dev:all` 本身只会并发启动网易云 API、QQ 适配器和 Vite，不包含 Tauri 窗口或浏览器打开动作；它不是 `tauri:dev` 的等价替代，所以“不会弹出前端界面”是脚本语义问题，不是前端页面渲染问题。
