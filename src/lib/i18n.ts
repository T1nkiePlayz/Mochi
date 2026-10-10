import { useCallback } from "react";
import { useAppSelector } from "../state/AppContext";
import { navLabel } from "./nav";
import { normalizeLanguage } from "./languages";

/**
 * Shared UI message catalogue. Keys are stable English source strings so missing
 * translations safely fall back to English instead of displaying a blank label.
 * Keep dynamic values outside the catalogue and interpolate them at the call site.
 */
const messages: Record<string, Record<string, string>> = {
  "Loading…": {
    ar: "جارٍ التحميل…", bg: "Зареждане…", "zh-Hans": "正在加载…", "zh-Hant": "載入中…", cs: "Načítání…", da: "Indlæser…", nl: "Laden…", fi: "Ladataan…", fr: "Chargement…", de: "Wird geladen…", el: "Φόρτωση…", hu: "Betöltés…", id: "Memuat…", it: "Caricamento…", ja: "読み込み中…", ko: "불러오는 중…", no: "Laster…", pl: "Ładowanie…", pt: "A carregar…", "pt-BR": "Carregando…", ro: "Se încarcă…", ru: "Загрузка…", es: "Cargando…", sv: "Läser in…", th: "กำลังโหลด…", tr: "Yükleniyor…", uk: "Завантаження…", vi: "Đang tải…",
  },
  "Not found.": {
    ar: "غير موجود.", bg: "Не е намерено.", "zh-Hans": "未找到。", "zh-Hant": "找不到。", cs: "Nenalezeno.", da: "Ikke fundet.", nl: "Niet gevonden.", fi: "Ei löytynyt.", fr: "Introuvable.", de: "Nicht gefunden.", el: "Δεν βρέθηκε.", hu: "Nem található.", id: "Tidak ditemukan.", it: "Non trovato.", ja: "見つかりません。", ko: "찾을 수 없습니다.", no: "Ikke funnet.", pl: "Nie znaleziono.", pt: "Não encontrado.", "pt-BR": "Não encontrado.", ro: "Nu a fost găsit.", ru: "Не найдено.", es: "No encontrado.", sv: "Hittades inte.", th: "ไม่พบ", tr: "Bulunamadı.", uk: "Не знайдено.", vi: "Không tìm thấy.",
  },
  "Get started": {
    ar: "ابدأ", bg: "Започнете", "zh-Hans": "开始使用", "zh-Hant": "開始使用", cs: "Začít", da: "Kom godt i gang", nl: "Aan de slag", fi: "Aloita", fr: "Commencer", de: "Loslegen", el: "Ξεκινήστε", hu: "Kezdés", id: "Mulai", it: "Inizia", ja: "始める", ko: "시작하기", no: "Kom i gang", pl: "Rozpocznij", pt: "Começar", "pt-BR": "Começar", ro: "Începe", ru: "Начать", es: "Comenzar", sv: "Kom igång", th: "เริ่มต้น", tr: "Başlayın", uk: "Почати", vi: "Bắt đầu",
  },
  "Back": {
    ar: "رجوع", bg: "Назад", "zh-Hans": "返回", "zh-Hant": "返回", cs: "Zpět", da: "Tilbage", nl: "Terug", fi: "Takaisin", fr: "Retour", de: "Zurück", el: "Πίσω", hu: "Vissza", id: "Kembali", it: "Indietro", ja: "戻る", ko: "뒤로", no: "Tilbake", pl: "Wstecz", pt: "Voltar", "pt-BR": "Voltar", ro: "Înapoi", ru: "Назад", es: "Atrás", sv: "Tillbaka", th: "ย้อนกลับ", tr: "Geri", uk: "Назад", vi: "Quay lại",
  },
  "Skip": {
    ar: "تخطّي", bg: "Пропускане", "zh-Hans": "跳过", "zh-Hant": "略過", cs: "Přeskočit", da: "Spring over", nl: "Overslaan", fi: "Ohita", fr: "Ignorer", de: "Überspringen", el: "Παράλειψη", hu: "Kihagyás", id: "Lewati", it: "Salta", ja: "スキップ", ko: "건너뛰기", no: "Hopp over", pl: "Pomiń", pt: "Ignorar", "pt-BR": "Pular", ro: "Omite", ru: "Пропустить", es: "Omitir", sv: "Hoppa över", th: "ข้าม", tr: "Atla", uk: "Пропустити", vi: "Bỏ qua",
  },
  "Next": {
    ar: "التالي", bg: "Напред", "zh-Hans": "下一步", "zh-Hant": "下一步", cs: "Další", da: "Næste", nl: "Volgende", fi: "Seuraava", fr: "Suivant", de: "Weiter", el: "Επόμενο", hu: "Tovább", id: "Berikutnya", it: "Avanti", ja: "次へ", ko: "다음", no: "Neste", pl: "Dalej", pt: "Seguinte", "pt-BR": "Próximo", ro: "Următorul", ru: "Далее", es: "Siguiente", sv: "Nästa", th: "ถัดไป", tr: "İleri", uk: "Далі", vi: "Tiếp",
  },
  "Finish": {
    ar: "إنهاء", bg: "Завършване", "zh-Hans": "完成", "zh-Hant": "完成", cs: "Dokončit", da: "Afslut", nl: "Voltooien", fi: "Valmis", fr: "Terminer", de: "Fertigstellen", el: "Ολοκλήρωση", hu: "Befejezés", id: "Selesai", it: "Fine", ja: "完了", ko: "완료", no: "Fullfør", pl: "Zakończ", pt: "Concluir", "pt-BR": "Concluir", ro: "Finalizare", ru: "Завершить", es: "Finalizar", sv: "Slutför", th: "เสร็จสิ้น", tr: "Bitir", uk: "Завершити", vi: "Hoàn tất",
  },
  "Language": {
    ar: "اللغة", bg: "Език", "zh-Hans": "语言", "zh-Hant": "語言", cs: "Jazyk", da: "Sprog", nl: "Taal", fi: "Kieli", fr: "Langue", de: "Sprache", el: "Γλώσσα", hu: "Nyelv", id: "Bahasa", it: "Lingua", ja: "言語", ko: "언어", no: "Språk", pl: "Język", pt: "Idioma", "pt-BR": "Idioma", ro: "Limbă", ru: "Язык", es: "Idioma", sv: "Språk", th: "ภาษา", tr: "Dil", uk: "Мова", vi: "Ngôn ngữ",
  },
  "Theme": {
    ar: "السمة", bg: "Тема", "zh-Hans": "主题", "zh-Hant": "主題", cs: "Motiv", da: "Tema", nl: "Thema", fi: "Teema", fr: "Thème", de: "Design", el: "Θέμα", hu: "Téma", id: "Tema", it: "Tema", ja: "テーマ", ko: "테마", no: "Tema", pl: "Motyw", pt: "Tema", "pt-BR": "Tema", ro: "Temă", ru: "Тема", es: "Tema", sv: "Tema", th: "ธีม", tr: "Tema", uk: "Тема", vi: "Giao diện",
  },
  "Accessibility": {
    ar: "إمكانية الوصول", bg: "Достъпност", "zh-Hans": "无障碍", "zh-Hant": "無障礙", cs: "Přístupnost", da: "Tilgængelighed", nl: "Toegankelijkheid", fi: "Esteettömyys", fr: "Accessibilité", de: "Barrierefreiheit", el: "Προσβασιμότητα", hu: "Akadálymentesség", id: "Aksesibilitas", it: "Accessibilità", ja: "アクセシビリティ", ko: "접근성", no: "Tilgjengelighet", pl: "Ułatwienia dostępu", pt: "Acessibilidade", "pt-BR": "Acessibilidade", ro: "Accesibilitate", ru: "Специальные возможности", es: "Accesibilidad", sv: "Tillgänglighet", th: "การช่วยการเข้าถึง", tr: "Erişilebilirlik", uk: "Доступність", vi: "Trợ năng",
  },
  "Account": {
    ar: "الحساب", bg: "Акаунт", "zh-Hans": "账户", "zh-Hant": "帳戶", cs: "Účet", da: "Konto", nl: "Account", fi: "Tili", fr: "Compte", de: "Konto", el: "Λογαριασμός", hu: "Fiók", id: "Akun", it: "Account", ja: "アカウント", ko: "계정", no: "Konto", pl: "Konto", pt: "Conta", "pt-BR": "Conta", ro: "Cont", ru: "Аккаунт", es: "Cuenta", sv: "Konto", th: "บัญชี", tr: "Hesap", uk: "Обліковий запис", vi: "Tài khoản",
  },
  "Sign in": {
    ar: "تسجيل الدخول", bg: "Вход", "zh-Hans": "登录", "zh-Hant": "登入", cs: "Přihlásit se", da: "Log ind", nl: "Inloggen", fi: "Kirjaudu sisään", fr: "Se connecter", de: "Anmelden", el: "Σύνδεση", hu: "Bejelentkezés", id: "Masuk", it: "Accedi", ja: "サインイン", ko: "로그인", no: "Logg inn", pl: "Zaloguj się", pt: "Iniciar sessão", "pt-BR": "Entrar", ro: "Autentificare", ru: "Войти", es: "Iniciar sesión", sv: "Logga in", th: "เข้าสู่ระบบ", tr: "Giriş yap", uk: "Увійти", vi: "Đăng nhập",
  },
  "Sign out": {
    ar: "تسجيل الخروج", bg: "Изход", "zh-Hans": "退出登录", "zh-Hant": "登出", cs: "Odhlásit se", da: "Log ud", nl: "Uitloggen", fi: "Kirjaudu ulos", fr: "Se déconnecter", de: "Abmelden", el: "Αποσύνδεση", hu: "Kijelentkezés", id: "Keluar", it: "Esci", ja: "サインアウト", ko: "로그아웃", no: "Logg ut", pl: "Wyloguj się", pt: "Terminar sessão", "pt-BR": "Sair", ro: "Deconectare", ru: "Выйти", es: "Cerrar sesión", sv: "Logga ut", th: "ออกจากระบบ", tr: "Çıkış yap", uk: "Вийти", vi: "Đăng xuất",
  },
  "Settings": {
    ar: "الإعدادات", bg: "Настройки", "zh-Hans": "设置", "zh-Hant": "設定", cs: "Nastavení", da: "Indstillinger", nl: "Instellingen", fi: "Asetukset", fr: "Paramètres", de: "Einstellungen", el: "Ρυθμίσεις", hu: "Beállítások", id: "Pengaturan", it: "Impostazioni", ja: "設定", ko: "설정", no: "Innstillinger", pl: "Ustawienia", pt: "Definições", "pt-BR": "Configurações", ro: "Setări", ru: "Настройки", es: "Ajustes", sv: "Inställningar", th: "การตั้งค่า", tr: "Ayarlar", uk: "Налаштування", vi: "Cài đặt",
  },
  "General": {
    ar: "عام", bg: "Общи", "zh-Hans": "常规", "zh-Hant": "一般", cs: "Obecné", da: "Generelt", nl: "Algemeen", fi: "Yleiset", fr: "Général", de: "Allgemein", el: "Γενικά", hu: "Általános", id: "Umum", it: "Generale", ja: "一般", ko: "일반", no: "Generelt", pl: "Ogólne", pt: "Geral", "pt-BR": "Geral", ro: "Generale", ru: "Общие", es: "General", sv: "Allmänt", th: "ทั่วไป", tr: "Genel", uk: "Загальні", vi: "Chung",
  },
  "Activity": {
    ar: "النشاط", bg: "Активност", "zh-Hans": "活动", "zh-Hant": "活動", cs: "Aktivita", da: "Aktivitet", nl: "Activiteit", fi: "Toiminta", fr: "Activité", de: "Aktivität", el: "Δραστηριότητα", hu: "Tevékenység", id: "Aktivitas", it: "Attività", ja: "アクティビティ", ko: "활동", no: "Aktivitet", pl: "Aktywność", pt: "Atividade", "pt-BR": "Atividade", ro: "Activitate", ru: "Активность", es: "Actividad", sv: "Aktivitet", th: "กิจกรรม", tr: "Etkinlik", uk: "Активність", vi: "Hoạt động",
  },
  "No active downloads": {
    ar: "لا توجد تنزيلات نشطة", bg: "Няма активни изтегляния", "zh-Hans": "没有正在进行的下载", "zh-Hant": "沒有進行中的下載", cs: "Žádná aktivní stahování", da: "Ingen aktive downloads", nl: "Geen actieve downloads", fi: "Ei aktiivisia latauksia", fr: "Aucun téléchargement actif", de: "Keine aktiven Downloads", el: "Δεν υπάρχουν ενεργές λήψεις", hu: "Nincsenek aktív letöltések", id: "Tidak ada unduhan aktif", it: "Nessun download attivo", ja: "アクティブなダウンロードはありません", ko: "활성 다운로드 없음", no: "Ingen aktive nedlastinger", pl: "Brak aktywnych pobrań", pt: "Sem transferências ativas", "pt-BR": "Nenhum download ativo", ro: "Nu există descărcări active", ru: "Нет активных загрузок", es: "No hay descargas activas", sv: "Inga aktiva nedladdningar", th: "ไม่มีการดาวน์โหลดที่กำลังดำเนินอยู่", tr: "Etkin indirme yok", uk: "Немає активних завантажень", vi: "Không có lượt tải xuống đang hoạt động",
  },
  "Nothing is downloading right now.": {
    ar: "لا يتم تنزيل أي شيء الآن.", bg: "В момента няма нищо за изтегляне.", "zh-Hans": "目前没有正在下载的内容。", "zh-Hant": "目前沒有正在下載的內容。", cs: "Momentálně se nic nestahuje.", da: "Der downloades ikke noget lige nu.", nl: "Er wordt momenteel niets gedownload.", fi: "Mitään ei ladata juuri nyt.", fr: "Aucun téléchargement en cours.", de: "Momentan wird nichts heruntergeladen.", el: "Δεν γίνεται λήψη αυτήν τη στιγμή.", hu: "Jelenleg nincs folyamatban letöltés.", id: "Tidak ada yang sedang diunduh saat ini.", it: "Al momento non è in corso alcun download.", ja: "現在ダウンロード中のものはありません。", ko: "현재 다운로드 중인 항목이 없습니다.", no: "Ingenting lastes ned akkurat nå.", pl: "W tej chwili nic się nie pobiera.", pt: "Não há nada a transferir neste momento.", "pt-BR": "Nada está sendo baixado no momento.", ro: "Nu se descarcă nimic acum.", ru: "Сейчас ничего не скачивается.", es: "No se está descargando nada ahora.", sv: "Ingenting laddas ned just nu.", th: "ขณะนี้ไม่มีการดาวน์โหลด", tr: "Şu anda hiçbir şey indirilmiyor.", uk: "Зараз нічого не завантажується.", vi: "Hiện không có nội dung nào đang tải xuống.",
  },
};

export function translate(message: string, language: unknown = "en"): string {
  const normalized = normalizeLanguage(language);
  const navigation = navLabel(message, normalized);
  if (navigation !== message) return navigation;
  return messages[message]?.[normalized] ?? message;
}

/** Read the current launcher language and keep translated controls reactive to settings changes. */
export function useTranslation() {
  const language = useAppSelector((app) => app.behavior.language);
  return useCallback((message: string) => translate(message, language), [language]);
}
