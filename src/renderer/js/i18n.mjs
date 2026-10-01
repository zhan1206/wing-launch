// S2 轻量国际化：中文为默认完整语言；其他语言仅覆盖外壳层，缺失回退中文并提示"部分内容尚未翻译"
export const LOCALES = {
  'zh-CN': { name: '简体中文', complete: true, strings: {} },
  'zh-TW': { name: '繁體中文', complete: false, strings: { '主页': '主頁', '实例': '實例', '下载中心': '下載中心', '账户': '帳戶', '皮肤库': '皮膚庫', '联机': '連線', '资源管理器': '資源管理器', '工具集': '工具集', '设置': '設定', '帮助': '幫助', '启动游戏': '啟動遊戲', '新建实例': '新建實例', '保存': '儲存', '删除': '刪除', '取消': '取消', '确定': '確定' } },
  'en': { name: 'English', complete: false, strings: { '主页': 'Home', '实例': 'Instances', '下载中心': 'Downloads', '账户': 'Accounts', '皮肤库': 'Skins', '联机': 'Multiplayer', '资源管理器': 'Resources', '工具集': 'Tools', '设置': 'Settings', '帮助': 'Help', '启动游戏': 'Play', '新建实例': 'New Instance', '保存': 'Save', '删除': 'Delete', '取消': 'Cancel', '确定': 'OK' } },
  'ja': { name: '日本語', complete: false, strings: { '主页': 'ホーム', '实例': 'インスタンス', '下载中心': 'ダウンロード', '账户': 'アカウント', '皮肤库': 'スキン', '联机': 'マルチプレイ', '资源管理器': 'リソース', '工具集': 'ツール', '设置': '設定', '帮助': 'ヘルプ', '启动游戏': 'プレイ', '新建实例': '新規インスタンス', '保存': '保存', '删除': '削除', '取消': 'キャンセル', '确定': 'OK' } },
  'ko': { name: '한국어', complete: false, strings: { '主页': '홈', '实例': '인스턴스', '下载中心': '다운로드', '账户': '계정', '皮肤库': '스킨', '联机': '멀티플레이', '资源管理器': '리소스', '工具集': '도구', '设置': '설정', '帮助': '도움말', '启动游戏': '실행', '新建实例': '새 인스턴스', '保存': '저장', '删除': '삭제', '取消': '취소', '确定': '확인' } },
  'es': { name: 'Español', complete: false, strings: { '主页': 'Inicio', '实例': 'Instancias', '下载中心': 'Descargas', '账户': 'Cuentas', '皮肤库': 'Skins', '联机': 'Multijugador', '资源管理器': 'Recursos', '工具集': 'Herramientas', '设置': 'Ajustes', '帮助': 'Ayuda', '启动游戏': 'Jugar', '新建实例': 'Nueva instancia', '保存': 'Guardar', '删除': 'Eliminar', '取消': 'Cancelar', '确定': 'OK' } },
};
export function translate(text, lang) {
  const loc = LOCALES[lang];
  if (!loc || lang === 'zh-CN') return { text, partial: false };
  return { text: loc.strings[text] || text, partial: !loc.complete && !!loc.strings[text] };
}
