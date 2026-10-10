import { navLabel } from "./nav";
import { getTranslationLocale } from "./translationLocale";
import { setupMessages } from "./i18nSetup";
import { setupCopyMessages } from "./i18nSetupCopy";
import { setupCopyExtraMessages } from "./i18nSetupCopyExtra";
import { cloudSetupMessages } from "./i18nCloudSetup";
import { accountSetupMessages } from "./i18nAccountSetup";
import { serviceSetupMessages } from "./i18nServiceSetup";
import { chromeMessages } from "./i18nChrome";
import { settingsMessages } from "./i18nSettings";
import { downloadMessages } from "./i18nDownloads";
import { dealMessages } from "./i18nDeals";
import { dealExtraMessages } from "./i18nDealsExtra";
import { libraryMessages } from "./i18nLibrary";
import { systemMessages } from "./i18nSystem";
import { libraryExtraMessages } from "./i18nLibraryExtra";
import { normalizeLanguage } from "./languages";
import { commonMessages } from "./i18nCommon";
import { settingsTitleMessages } from "./i18nSettingsTitles";
import { settingsTitleExtraMessages } from "./i18nSettingsTitlesExtra";
import { accessibilitySettingsCopy } from "./i18nAccessibilitySettings";
import { settingsSubtitleMessages } from "./i18nSettingsSubtitles";
import { settingsSubtitleExtraMessages } from "./i18nSettingsSubtitlesExtra";
import { accessibilityMessages } from "./i18nAccessibility";
import { bigPictureMessages } from "./i18nBigPicture";
import { commonExtraMessages } from "./i18nCoreExtra";
import { uiExtraMessages } from "./i18nUiExtra";

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


Object.assign(messages, {
  "Welcome": { ar: "مرحبًا", bg: "Добре дошли", "zh-Hans": "欢迎", "zh-Hant": "歡迎", cs: "Vítejte", da: "Velkommen", nl: "Welkom", fi: "Tervetuloa", fr: "Bienvenue", de: "Willkommen", el: "Καλώς ορίσατε", hu: "Üdvözöljük", id: "Selamat datang", it: "Benvenuto", ja: "ようこそ", ko: "환영합니다", no: "Velkommen", pl: "Witamy", pt: "Bem-vindo", "pt-BR": "Boas-vindas", ro: "Bun venit", ru: "Добро пожаловать", es: "Bienvenido", sv: "Välkommen", th: "ยินดีต้อนรับ", tr: "Hoş geldiniz", uk: "Вітаємо", vi: "Chào mừng" },
  "Mochi account": { ar: "حساب Mochi", bg: "Mochi акаунт", "zh-Hans": "Mochi 账户", "zh-Hant": "Mochi 帳戶", cs: "Účet Mochi", da: "Mochi-konto", nl: "Mochi-account", fi: "Mochi-tili", fr: "Compte Mochi", de: "Mochi-Konto", el: "Λογαριασμός Mochi", hu: "Mochi-fiók", id: "Akun Mochi", it: "Account Mochi", ja: "Mochi アカウント", ko: "Mochi 계정", no: "Mochi-konto", pl: "Konto Mochi", pt: "Conta Mochi", "pt-BR": "Conta Mochi", ro: "Cont Mochi", ru: "Аккаунт Mochi", es: "Cuenta de Mochi", sv: "Mochi-konto", th: "บัญชี Mochi", tr: "Mochi hesabı", uk: "Обліковий запис Mochi", vi: "Tài khoản Mochi" },
  "Sign in to Mochi": { ar: "تسجيل الدخول إلى Mochi", bg: "Вход в Mochi", "zh-Hans": "登录 Mochi", "zh-Hant": "登入 Mochi", cs: "Přihlásit se do Mochi", da: "Log ind på Mochi", nl: "Inloggen bij Mochi", fi: "Kirjaudu Mochiin", fr: "Se connecter à Mochi", de: "Bei Mochi anmelden", el: "Σύνδεση στο Mochi", hu: "Bejelentkezés a Mochi szolgáltatásba", id: "Masuk ke Mochi", it: "Accedi a Mochi", ja: "Mochi にサインイン", ko: "Mochi에 로그인", no: "Logg inn på Mochi", pl: "Zaloguj się do Mochi", pt: "Iniciar sessão no Mochi", "pt-BR": "Entrar no Mochi", ro: "Conectare la Mochi", ru: "Войти в Mochi", es: "Iniciar sesión en Mochi", sv: "Logga in på Mochi", th: "เข้าสู่ระบบ Mochi", tr: "Mochi'ye giriş yap", uk: "Увійти в Mochi", vi: "Đăng nhập Mochi" },
  "Add a Mochi account": { ar: "إضافة حساب Mochi", bg: "Добавяне на акаунт Mochi", "zh-Hans": "添加 Mochi 账户", "zh-Hant": "新增 Mochi 帳戶", cs: "Přidat účet Mochi", da: "Tilføj en Mochi-konto", nl: "Een Mochi-account toevoegen", fi: "Lisää Mochi-tili", fr: "Ajouter un compte Mochi", de: "Mochi-Konto hinzufügen", el: "Προσθήκη λογαριασμού Mochi", hu: "Mochi-fiók hozzáadása", id: "Tambahkan akun Mochi", it: "Aggiungi un account Mochi", ja: "Mochi アカウントを追加", ko: "Mochi 계정 추가", no: "Legg til en Mochi-konto", pl: "Dodaj konto Mochi", pt: "Adicionar uma conta Mochi", "pt-BR": "Adicionar uma conta Mochi", ro: "Adaugă un cont Mochi", ru: "Добавить аккаунт Mochi", es: "Añadir una cuenta de Mochi", sv: "Lägg till ett Mochi-konto", th: "เพิ่มบัญชี Mochi", tr: "Mochi hesabı ekle", uk: "Додати обліковий запис Mochi", vi: "Thêm tài khoản Mochi" },
  "Add User": { ar: "إضافة مستخدم", bg: "Добавяне на потребител", "zh-Hans": "添加用户", "zh-Hant": "新增使用者", cs: "Přidat uživatele", da: "Tilføj bruger", nl: "Gebruiker toevoegen", fi: "Lisää käyttäjä", fr: "Ajouter un utilisateur", de: "Benutzer hinzufügen", el: "Προσθήκη χρήστη", hu: "Felhasználó hozzáadása", id: "Tambah pengguna", it: "Aggiungi utente", ja: "ユーザーを追加", ko: "사용자 추가", no: "Legg til bruker", pl: "Dodaj użytkownika", pt: "Adicionar utilizador", "pt-BR": "Adicionar usuário", ro: "Adaugă utilizator", ru: "Добавить пользователя", es: "Añadir usuario", sv: "Lägg till användare", th: "เพิ่มผู้ใช้", tr: "Kullanıcı ekle", uk: "Додати користувача", vi: "Thêm người dùng" },
  "Sign in to another Mochi account": { ar: "تسجيل الدخول إلى حساب Mochi آخر", bg: "Вход в друг акаунт Mochi", "zh-Hans": "登录另一个 Mochi 账户", "zh-Hant": "登入另一個 Mochi 帳戶", cs: "Přihlásit se k jinému účtu Mochi", da: "Log ind på en anden Mochi-konto", nl: "Inloggen bij een ander Mochi-account", fi: "Kirjaudu toiselle Mochi-tilille", fr: "Se connecter à un autre compte Mochi", de: "Bei einem anderen Mochi-Konto anmelden", el: "Σύνδεση σε άλλον λογαριασμό Mochi", hu: "Bejelentkezés másik Mochi-fiókba", id: "Masuk ke akun Mochi lain", it: "Accedi a un altro account Mochi", ja: "別の Mochi アカウントにサインイン", ko: "다른 Mochi 계정으로 로그인", no: "Logg inn på en annen Mochi-konto", pl: "Zaloguj się na inne konto Mochi", pt: "Iniciar sessão noutra conta Mochi", "pt-BR": "Entrar em outra conta Mochi", ro: "Conectează-te la alt cont Mochi", ru: "Войти в другой аккаунт Mochi", es: "Iniciar sesión en otra cuenta de Mochi", sv: "Logga in på ett annat Mochi-konto", th: "เข้าสู่ระบบบัญชี Mochi อื่น", tr: "Başka bir Mochi hesabına giriş yap", uk: "Увійти в інший обліковий запис Mochi", vi: "Đăng nhập vào tài khoản Mochi khác" },
  "Keep local Mochi data": { ar: "الاحتفاظ ببيانات Mochi المحلية", bg: "Запазване на локалните данни на Mochi", "zh-Hans": "保留本地 Mochi 数据", "zh-Hant": "保留本機 Mochi 資料", cs: "Zachovat místní data Mochi", da: "Behold lokale Mochi-data", nl: "Lokale Mochi-gegevens behouden", fi: "Säilytä paikalliset Mochi-tiedot", fr: "Conserver les données locales de Mochi", de: "Lokale Mochi-Daten behalten", el: "Διατήρηση τοπικών δεδομένων Mochi", hu: "Helyi Mochi-adatok megtartása", id: "Simpan data Mochi lokal", it: "Mantieni i dati locali di Mochi", ja: "ローカルの Mochi データを保持", ko: "로컬 Mochi 데이터 유지", no: "Behold lokale Mochi-data", pl: "Zachowaj lokalne dane Mochi", pt: "Manter os dados locais do Mochi", "pt-BR": "Manter os dados locais do Mochi", ro: "Păstrează datele locale Mochi", ru: "Сохранить локальные данные Mochi", es: "Conservar los datos locales de Mochi", sv: "Behåll lokala Mochi-data", th: "เก็บข้อมูล Mochi ในเครื่อง", tr: "Yerel Mochi verilerini koru", uk: "Зберегти локальні дані Mochi", vi: "Giữ dữ liệu Mochi cục bộ" },
  "Skip to content": { ar: "انتقل إلى المحتوى", bg: "Към съдържанието", "zh-Hans": "跳转到内容", "zh-Hant": "跳至內容", cs: "Přejít na obsah", da: "Gå til indhold", nl: "Ga naar inhoud", fi: "Siirry sisältöön", fr: "Aller au contenu", de: "Zum Inhalt springen", el: "Μετάβαση στο περιεχόμενο", hu: "Ugrás a tartalomhoz", id: "Lewati ke konten", it: "Vai al contenuto", ja: "コンテンツへスキップ", ko: "콘텐츠로 건너뛰기", no: "Hopp til innhold", pl: "Przejdź do treści", pt: "Saltar para o conteúdo", "pt-BR": "Pular para o conteúdo", ro: "Salt la conținut", ru: "Перейти к содержимому", es: "Saltar al contenido", sv: "Hoppa till innehållet", th: "ข้ามไปยังเนื้อหา", tr: "İçeriğe atla", uk: "Перейти до вмісту", vi: "Chuyển đến nội dung" },
  "Welcome to Mochi setup": { ar: "مرحبًا بك في إعداد Mochi", bg: "Добре дошли в настройката на Mochi", "zh-Hans": "欢迎使用 Mochi 设置", "zh-Hant": "歡迎使用 Mochi 設定", cs: "Vítejte v nastavení Mochi", da: "Velkommen til opsætning af Mochi", nl: "Welkom bij de installatie van Mochi", fi: "Tervetuloa Mochin käyttöönottoon", fr: "Bienvenue dans la configuration de Mochi", de: "Willkommen bei der Mochi-Einrichtung", el: "Καλώς ορίσατε στη ρύθμιση του Mochi", hu: "Üdvözlünk a Mochi beállításában", id: "Selamat datang di penyiapan Mochi", it: "Benvenuto nella configurazione di Mochi", ja: "Mochi のセットアップへようこそ", ko: "Mochi 설정에 오신 것을 환영합니다", no: "Velkommen til oppsettet av Mochi", pl: "Witamy w konfiguracji Mochi", pt: "Bem-vindo à configuração do Mochi", "pt-BR": "Boas-vindas à configuração do Mochi", ro: "Bun venit la configurarea Mochi", ru: "Добро пожаловать в настройку Mochi", es: "Te damos la bienvenida a la configuración de Mochi", sv: "Välkommen till Mochis konfiguration", th: "ยินดีต้อนรับสู่การตั้งค่า Mochi", tr: "Mochi kurulumuna hoş geldiniz", uk: "Ласкаво просимо до налаштування Mochi", vi: "Chào mừng bạn đến với thiết lập Mochi" },
});

export function translate(message: string, language: unknown = getTranslationLocale()): string {
  const normalized = normalizeLanguage(language);
  const navigation = navLabel(message, normalized);
  if (navigation !== message) return navigation;
  return messages[message]?.[normalized] ?? setupMessages[message]?.[normalized] ?? setupCopyMessages[message]?.[normalized] ?? setupCopyExtraMessages[message]?.[normalized] ?? cloudSetupMessages[message]?.[normalized] ?? accountSetupMessages[message]?.[normalized] ?? serviceSetupMessages[message]?.[normalized] ?? chromeMessages[message]?.[normalized] ?? settingsMessages[message]?.[normalized] ?? downloadMessages[message]?.[normalized] ?? dealMessages[message]?.[normalized] ?? dealExtraMessages[message]?.[normalized] ?? libraryMessages[message]?.[normalized] ?? systemMessages[message]?.[normalized] ?? libraryExtraMessages[message]?.[normalized] ?? commonMessages[message]?.[normalized] ?? settingsTitleMessages[message]?.[normalized] ?? settingsTitleExtraMessages[message]?.[normalized] ?? accessibilitySettingsCopy[message]?.[normalized] ?? settingsSubtitleMessages[message]?.[normalized] ?? settingsSubtitleExtraMessages[message]?.[normalized] ?? accessibilityMessages[message]?.[normalized] ?? message;
}


/** Returns whether a source message has an explicit translation for a locale. */
export function hasTranslation(message: string, language: unknown): boolean {
  const normalized = normalizeLanguage(language);
  if (navLabel(message, normalized) !== message) return true;
  return Boolean(messages[message]?.[normalized] || setupMessages[message]?.[normalized] || setupCopyMessages[message]?.[normalized] || setupCopyExtraMessages[message]?.[normalized] || cloudSetupMessages[message]?.[normalized] || accountSetupMessages[message]?.[normalized] || serviceSetupMessages[message]?.[normalized] || chromeMessages[message]?.[normalized] || settingsMessages[message]?.[normalized] || downloadMessages[message]?.[normalized] || dealMessages[message]?.[normalized] || dealExtraMessages[message]?.[normalized] || libraryMessages[message]?.[normalized] || systemMessages[message]?.[normalized] || libraryExtraMessages[message]?.[normalized] || commonMessages[message]?.[normalized] || settingsTitleMessages[message]?.[normalized] || settingsTitleExtraMessages[message]?.[normalized] || accessibilitySettingsCopy[message]?.[normalized] || settingsSubtitleMessages[message]?.[normalized] || settingsSubtitleExtraMessages[message]?.[normalized] || accessibilityMessages[message]?.[normalized] || bigPictureMessages[message]?.[normalized] || commonExtraMessages[message]?.[normalized] || uiExtraMessages[message]?.[normalized]);
}

/** All explicitly catalogued messages, useful for coverage checks and tooling. */
export function getTranslationMessages(): string[] {
  const catalogs = [messages, setupMessages, setupCopyMessages, setupCopyExtraMessages, cloudSetupMessages, accountSetupMessages, serviceSetupMessages, chromeMessages, settingsMessages, downloadMessages, dealMessages, dealExtraMessages, libraryMessages, systemMessages, libraryExtraMessages, commonMessages, settingsTitleMessages, settingsTitleExtraMessages, accessibilitySettingsCopy, settingsSubtitleMessages, settingsSubtitleExtraMessages, accessibilityMessages, bigPictureMessages, commonExtraMessages, uiExtraMessages];
  return [...new Set(catalogs.flatMap((catalog) => Object.keys(catalog)))];
}
