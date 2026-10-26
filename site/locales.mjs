export const chinese = {
  subtitle:'世界历史工作台', source:'源码', eyebrow:'分支 · 状态 · 证据', title:'从一个个有据可查的状态，探索历史。', lead:'沿着历史路径逐步深入，检出一个版本，比较记录中的变化。史料依据和建模取舍，都有迹可循。', development:'桌面预览版已提供（未签名），也可从源码运行。', preview:'下载桌面预览版 ↗', run:'从源码运行', requirements:'阅读产品需求 ↗', example:'加洛林王朝的继承与分裂', shared:'共同历史', west:'西法兰克', middle:'中法兰克', east:'东法兰克', diagramNote:'仅示部分记录和状态继承关系；节点间距不表示时间长短。', follow:'沿分支探索', followBody:'先选择地区和时期。从共同的加洛林历史进入凡尔登分割后的三条路径，再追踪其中一支的后续变化。', checkout:'检出一个状态', checkoutBody:'查看某个版本记录的统治者、宫廷驻地与领地。分清继承的字段，并追溯每项信息记录于何处。', compare:'比较两个版本', compareBody:'比较前后状态、同源分支或独立路径。值相同、存在差异和证据缺失，是不同的结果。', localTitle:'本地工作台', localBody:'桌面方案将探索、编辑和数据库保留在本机。新增并审核的记录进入同一套图谱和命令流程。核心工作不需要公网服务器。', architecture:'架构与数据工作流 ↗', evidenceTitle:'证据与边界', evidenceBody:'初始记录是精选语料，不是完整世界史。字段继承只代表模型中的延续；引用可以支持论断，但不等于获得原文的再分发许可。', evidence:'历史来源与建模说明 ↗', notices:'字体许可', exampleYears:'公元751–870年', issues:'问题追踪',
};
export const releaseCopy = {
  en: {
    status: release => `macOS ${release.architecture} · ${release.tag} · ${release.signing === 'unsigned' ? 'Unsigned' : 'Signed and notarized'}`,
    download: 'Download for macOS', install: 'Install and verify',
    instructions: 'Open the DMG, drag GitWorld into Applications, then launch the app. The runtime and starting data are included; Node and a development server are not required.',
    unsigned: 'This build has no Developer ID signature or Apple notarization. macOS may block launch. Check the source and SHA-256 before opening; do not disable system security to bypass a warning.',
    acceptance: 'Read this build’s installation checks ↗',
    graphTitle: 'A shared Carolingian path branches into West, Middle and East Francia at Verdun in 843.', operations: 'Three exploration operations',
  },
  'zh-CN': {
    status: release => `macOS ${release.architecture} · ${release.tag} · ${release.signing === 'unsigned' ? '未签名' : '已签名并公证'}`,
    download: '下载 macOS 安装包', install: '安装与校验',
    instructions: '打开 DMG，将 GitWorld 拖入 Applications，然后启动应用。运行时与初始数据已包含在安装包中，不需要安装 Node 或开发服务器。',
    unsigned: '此版本未使用 Developer ID 签名，也未经 Apple 公证。macOS 可能拦截启动。请先核对来源和 SHA-256；不要关闭系统安全保护来绕过提示。',
    acceptance: '查看此版本的安装验收记录 ↗',
    graphTitle: '加洛林共同历史在843年凡尔登分割后形成西、中、东法兰克三条路径。', operations: '三个核心探索操作',
  },
};
