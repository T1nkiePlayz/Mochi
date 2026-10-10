/** Stable navigation ids stay in English for routing; only the visible labels are localized. */
const english: Record<string, string> = {
  Library: "Library", Installed: "Mods & Content", Discover: "Discover", Downloads: "Downloads", Stats: "Stats", Deals: "Deals", Settings: "Settings",
};

const translations: Record<string, Record<string, string>> = {
  ar: { Library: "المكتبة", Installed: "التعديلات والمحتوى", Discover: "اكتشف", Downloads: "التنزيلات", Stats: "الإحصائيات", Deals: "العروض", Settings: "الإعدادات" },
  bg: { Library: "Библиотека", Installed: "Модове и съдържание", Discover: "Откриване", Downloads: "Изтегляния", Stats: "Статистика", Deals: "Оферти", Settings: "Настройки" },
  "zh-Hans": { Library: "游戏库", Installed: "模组与内容", Discover: "发现", Downloads: "下载", Stats: "统计", Deals: "优惠", Settings: "设置" },
  "zh-Hant": { Library: "遊戲庫", Installed: "模組與內容", Discover: "探索", Downloads: "下載", Stats: "統計", Deals: "優惠", Settings: "設定" },
  cs: { Library: "Knihovna", Installed: "Mody a obsah", Discover: "Objevovat", Downloads: "Stahování", Stats: "Statistiky", Deals: "Nabídky", Settings: "Nastavení" },
  da: { Library: "Bibliotek", Installed: "Mods og indhold", Discover: "Udforsk", Downloads: "Downloads", Stats: "Statistik", Deals: "Tilbud", Settings: "Indstillinger" },
  nl: { Library: "Bibliotheek", Installed: "Mods en inhoud", Discover: "Ontdekken", Downloads: "Downloads", Stats: "Statistieken", Deals: "Aanbiedingen", Settings: "Instellingen" },
  en: english,
  fi: { Library: "Kirjasto", Installed: "Modit ja sisältö", Discover: "Tutustu", Downloads: "Lataukset", Stats: "Tilastot", Deals: "Tarjoukset", Settings: "Asetukset" },
  fr: { Library: "Bibliothèque", Installed: "Mods et contenu", Discover: "Découvrir", Downloads: "Téléchargements", Stats: "Statistiques", Deals: "Offres", Settings: "Paramètres" },
  de: { Library: "Bibliothek", Installed: "Mods & Inhalte", Discover: "Entdecken", Downloads: "Downloads", Stats: "Statistiken", Deals: "Angebote", Settings: "Einstellungen" },
  el: { Library: "Βιβλιοθήκη", Installed: "Mods και περιεχόμενο", Discover: "Ανακάλυψη", Downloads: "Λήψεις", Stats: "Στατιστικά", Deals: "Προσφορές", Settings: "Ρυθμίσεις" },
  hu: { Library: "Könyvtár", Installed: "Modok és tartalom", Discover: "Felfedezés", Downloads: "Letöltések", Stats: "Statisztikák", Deals: "Ajánlatok", Settings: "Beállítások" },
  id: { Library: "Perpustakaan", Installed: "Mod dan Konten", Discover: "Jelajahi", Downloads: "Unduhan", Stats: "Statistik", Deals: "Promo", Settings: "Pengaturan" },
  it: { Library: "Libreria", Installed: "Mod e contenuti", Discover: "Scopri", Downloads: "Download", Stats: "Statistiche", Deals: "Offerte", Settings: "Impostazioni" },
  ja: { Library: "ライブラリ", Installed: "Mod・コンテンツ", Discover: "見つける", Downloads: "ダウンロード", Stats: "統計", Deals: "セール", Settings: "設定" },
  ko: { Library: "라이브러리", Installed: "모드 및 콘텐츠", Discover: "검색", Downloads: "다운로드", Stats: "통계", Deals: "할인", Settings: "설정" },
  no: { Library: "Bibliotek", Installed: "Mods og innhold", Discover: "Utforsk", Downloads: "Nedlastinger", Stats: "Statistikk", Deals: "Tilbud", Settings: "Innstillinger" },
  pl: { Library: "Biblioteka", Installed: "Mody i zawartość", Discover: "Odkrywaj", Downloads: "Pobrane", Stats: "Statystyki", Deals: "Okazje", Settings: "Ustawienia" },
  pt: { Library: "Biblioteca", Installed: "Mods e conteúdo", Discover: "Descobrir", Downloads: "Transferências", Stats: "Estatísticas", Deals: "Ofertas", Settings: "Definições" },
  "pt-BR": { Library: "Biblioteca", Installed: "Mods e conteúdo", Discover: "Descobrir", Downloads: "Downloads", Stats: "Estatísticas", Deals: "Ofertas", Settings: "Configurações" },
  ro: { Library: "Bibliotecă", Installed: "Moduri și conținut", Discover: "Descoperă", Downloads: "Descărcări", Stats: "Statistici", Deals: "Oferte", Settings: "Setări" },
  ru: { Library: "Библиотека", Installed: "Моды и контент", Discover: "Обзор", Downloads: "Загрузки", Stats: "Статистика", Deals: "Скидки", Settings: "Настройки" },
  es: { Library: "Biblioteca", Installed: "Mods y contenido", Discover: "Descubrir", Downloads: "Descargas", Stats: "Estadísticas", Deals: "Ofertas", Settings: "Ajustes" },
  sv: { Library: "Bibliotek", Installed: "Mods och innehåll", Discover: "Upptäck", Downloads: "Nedladdningar", Stats: "Statistik", Deals: "Erbjudanden", Settings: "Inställningar" },
  th: { Library: "คลังเกม", Installed: "ม็อดและเนื้อหา", Discover: "ค้นพบ", Downloads: "ดาวน์โหลด", Stats: "สถิติ", Deals: "ข้อเสนอ", Settings: "การตั้งค่า" },
  tr: { Library: "Kütüphane", Installed: "Modlar ve İçerik", Discover: "Keşfet", Downloads: "İndirmeler", Stats: "İstatistikler", Deals: "Fırsatlar", Settings: "Ayarlar" },
  uk: { Library: "Бібліотека", Installed: "Моди та вміст", Discover: "Огляд", Downloads: "Завантаження", Stats: "Статистика", Deals: "Пропозиції", Settings: "Налаштування" },
  vi: { Library: "Thư viện", Installed: "Mod và nội dung", Discover: "Khám phá", Downloads: "Tải xuống", Stats: "Thống kê", Deals: "Ưu đãi", Settings: "Cài đặt" },
};

export const navLabel = (id: string, language = "en"): string =>
  translations[language]?.[id] ?? translations[language.split("-")[0]]?.[id] ?? english[id] ?? id;
