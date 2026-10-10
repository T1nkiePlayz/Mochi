/** Main navigation labels translated where a bundled UI translation is available. Unknown languages safely fall back to English. */
const english: Record<string, string> = {
  Library: "Library", Installed: "Mods & Content", Discover: "Discover", Downloads: "Downloads", Stats: "Stats", Deals: "Deals", Settings: "Settings",
};

const translations: Record<string, Record<string, string>> = {
  es: { Library: "Biblioteca", Installed: "Mods y contenido", Discover: "Descubrir", Downloads: "Descargas", Stats: "Estadísticas", Deals: "Ofertas", Settings: "Ajustes" },
  fr: { Library: "Bibliothèque", Installed: "Mods et contenu", Discover: "Découvrir", Downloads: "Téléchargements", Stats: "Statistiques", Deals: "Offres", Settings: "Paramètres" },
  de: { Library: "Bibliothek", Installed: "Mods & Inhalte", Discover: "Entdecken", Downloads: "Downloads", Stats: "Statistiken", Deals: "Angebote", Settings: "Einstellungen" },
  it: { Library: "Libreria", Installed: "Mod e contenuti", Discover: "Scopri", Downloads: "Download", Stats: "Statistiche", Deals: "Offerte", Settings: "Impostazioni" },
  pt: { Library: "Biblioteca", Installed: "Mods e conteúdo", Discover: "Descobrir", Downloads: "Transferências", Stats: "Estatísticas", Deals: "Ofertas", Settings: "Definições" },
  "pt-BR": { Library: "Biblioteca", Installed: "Mods e conteúdo", Discover: "Descobrir", Downloads: "Downloads", Stats: "Estatísticas", Deals: "Ofertas", Settings: "Configurações" },
  ja: { Library: "ライブラリ", Installed: "Mod・コンテンツ", Discover: "見つける", Downloads: "ダウンロード", Stats: "統計", Deals: "セール", Settings: "設定" },
  ko: { Library: "라이브러리", Installed: "모드 및 콘텐츠", Discover: "검색", Downloads: "다운로드", Stats: "통계", Deals: "할인", Settings: "설정" },
  "zh-Hans": { Library: "游戏库", Installed: "模组与内容", Discover: "发现", Downloads: "下载", Stats: "统计", Deals: "优惠", Settings: "设置" },
  "zh-Hant": { Library: "遊戲庫", Installed: "模組與內容", Discover: "探索", Downloads: "下載", Stats: "統計", Deals: "優惠", Settings: "設定" },
};

export const navLabel = (id: string, language = "en"): string => translations[language]?.[id] ?? translations[language.split("-")[0]]?.[id] ?? english[id] ?? id;
