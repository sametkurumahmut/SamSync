# SamSync

[English](README.md)

Dosyaları, klasörleri ve Git değişikliklerini birden çok makineye **aynı göreli yolla** gönderen; hedefleri karşılaştıran, eşitleyen, değişiklikleri kendiliğinden gönderen ve gerektiğinde eski hâline döndüren masaüstü uygulaması. Windows, macOS ve Linux'ta çalışır (Electron + React + TypeScript).

Eski PowerShell aracının ([`../legacy`](../legacy/README.tr.md)) yerini alır ve onun `config.json` dosyasını olduğu gibi okur.

Arayüz Türkçe, İngilizce, Almanca ve İspanyolcadır. Ayarlar → **Dil** altında bir dil seçilmedikçe bilgisayarın görüntü dilini izler: sistem bunlardan birini kullanıyorsa o dil, diğerlerinde İngilizce. Yardım içeriği (SSS, bu README) Türkçe ve İngilizcedir; Almanca ve İspanyolca arayüz İngilizcesini gösterir.

## Ekran görüntüleri

| | |
| --- | --- |
| ![Gönder](../docs/screenshots/tr-send.png) | ![Karşılaştır](../docs/screenshots/tr-compare.png) |
| ![Git](../docs/screenshots/tr-git.png) | ![Senkron](../docs/screenshots/tr-sync.png) |
| ![Otomasyon](../docs/screenshots/tr-automation.png) | ![Hedefler](../docs/screenshots/tr-targets.png) |
| ![Genel bakış](../docs/screenshots/tr-overview.png) | ![Geçmiş](../docs/screenshots/tr-history.png) |

## Kurulum

`npm run dist:win` üç dosya üretir (`release/<sürüm>/`):

| Dosya | Ne zaman |
| --- | --- |
| `SamSync-Setup-<sürüm>.exe` | Önerilen. Kullanıcı başına kurulur (yönetici yetkisi gerekmez), Başlat menüsü ve masaüstü kısayolu oluşturur, **otomatik güncellenir**. |
| `SamSync-<sürüm>-portable.exe` | Kurulumsuz, tek dosya. USB'den ya da paylaşımdan çalıştırılabilir. Her açılışta kendini yeniden açar ve kendini güncelleyemez. |
| `SamSync-<sürüm>-win.zip` | Kurulumsuz, açılmış uygulama: istediğiniz yere çıkarıp `SamSync.exe`'yi çalıştırın. Tek dosyalı sürümden hızlı açılır, kendini güncelleyemez. |

İki taşınabilir biçim de ayarlarını, geçmişini ve günlüğünü programın yanındaki `SamSync-data` klasöründe tutar; böylece programla birlikte taşınır ve sonraki açılışta yerinde olur. Bu klasöre yazılamıyorsa (salt okunur paylaşım) kurulu uygulamanın kullanıcı klasörü kullanılır.

**İndirileni doğrulamak.** Her sürümde her dosyanın SHA-256 özetini taşıyan bir `SHA256SUMS.txt` vardır: Windows'ta `Get-FileHash SamSync-Setup-<sürüm>.exe`, macOS ve Linux'ta `shasum -a 256 -c SHA256SUMS.txt`. `npm run winget` yayımlanmış bir sürümün [winget](https://learn.microsoft.com/windows/package-manager/) bildirimlerini yazar (`packaging/winget/<sürüm>/`, kimlik `SametKurumahmut.SamSync`); bunlar `microsoft/winget-pkgs` deposuna önerilir.

macOS (`.dmg`) ve Linux (`.AppImage`) paketleri kendi işletim sistemlerinde üretilir; GitHub Actions bunu üçü için birden yapar (aşağıda *Sürüm yayınlama*).

## İlk açılış

Yapılandırma yoksa karşılama ekranı dört yol sunar:

- **Kurulum sihirbazı** — üç adım: bu makine (ad, diğerlerinin ona ulaştığı adres, gönderdiği klasör, paylaşım kökü), ağda bulunan makineler (bu bilgisayarın alt ağlarındaki her adres dosya paylaşımı 445 ve SSH 22 kapılarından denenir; adları, Windows'ta paylaşımları ve zaten tanımlı olanlar görünür; hedefleri işaretleyin), son olarak kaydedilecek listeye bir bakış.
- **Mevcut config.json'ı kullan** — ağ paylaşımındaki ortak dosya ya da eski aracın `legacy/config.json` dosyası. Uygulama değişiklikleri o dosyaya yazar; eski aracın alanları (`version`, `menuTitle`, `notepadPlusPlusShortcuts`…) korunur, PowerShell aracı aynı dosyayla çalışmaya devam eder.
- **Kopyasını içe aktar** — makineleri bu bilgisayarın kendi yapılandırmasına kopyalar.
- **Elle ekle** — makineleri Hedefler sayfasından tek tek ekleyin. Oradaki **Ağı tara** yanıt veren makineleri bulur, seçtiğinizi düzenleyiciye dolu getirir.

Uygulama çalıştığı makineyi eski araçla aynı kurallarla tanır: `SAMSYNC_NODE_ID` ortam değişkeni, IP adresi, bilgisayar adı (`address` / `localNames`; yalın ad ya da etki alanında `<ad>.<USERDNSDOMAIN>`), birden çok eşleşmede yerel kökün varlığı. Hedefler sayfasından makine elle de sabitlenebilir.

Node kimlikleri ve grup adları yalnızca harf, rakam, nokta, alt çizgi ve tire içerebilir (`Lab-A`; boşluk yok). Çünkü komut satırlarında ve menülerde makine kimliği ve `group:<ad>` olarak kullanılırlar. Eski araçtaki gibi, bu kurala uymayan bir yapılandırma yüklenmez.

## Sayfalar

### Genel bakış
İlk sayfa (Ctrl 1): kutularda makineler (erişilen / toplam, erişilemeyenler), bugün aktarılan veri ve 14 günlük küçük grafik, haftanın hatalı gönderimleri, otomasyon, envanter ve varsa röle ile bekleyen güncelleme; altında son gönderimler, hızlı gönderimler, izlemeler ve zamanlanmış işler. **Ağ görünümü** bu bilgisayarı solda, grupları sağda çizer: her gruba giden çizgi kaç makinesinin yanıt verdiğine göre renkli, röle işaretli ve dağıttığı makinelere kesikli çizgiler. Bir makineye tıklamak onu gönderim hedefi yapar, başka bir grubun kutusuna sürüklemek grubunu değiştirir.

### Gönder
Dosya/klasörleri pencereye sürükleyin, seçin ya da yolu yapıştırın; hedefleri seçin (gruplar, arama, erişim noktası, profiller, “son çalıştırmada hatalılar”). **İncele ve gönder** her hedefte ne olacağını dosya dosya gösterir:

| İşaret | Anlamı |
| --- | --- |
| `+` | hedefte yok, yeni |
| `~` | güncellenecek |
| `!` | hedefteki dosya **daha yeni** (Üzerine yaz kipinde yazılır, Yalnızca yeni kipinde atlanır) |
| `−` | hedefte fazla (yalnızca Ayna kipinde silinir) / Git'te silinmiş |

İnceleme hazırlanırken pencere her makinenin ne yaptığını gösterir: erişimin denenmesi, hedefteki klasörlerin listelenmesi, kaç dosyanın karşılaştırıldığı ve içerik karşılaştırmasında ne kadar verinin okunduğu.

**Kök dışı kaynaklar.** Bu makinenin hiçbir yerel kökünün altında olmayan dosya ya da klasör *kök dışı* rozetiyle görünür. Varsayılan olarak kendi klasörü hedef kökünün yerine geçer: bir klasörün içindekiler doğrudan hedef köküne gider, bir dosya da oraya adıyla yazılır. Kaynağın altındaki listeden başka bir yer seçilebilir: üstündeki her klasör hedef kökünün yerine geçebilir, son seçenek de eski araçtaki gibi sürücü harfini klasör yapıp tam yolu korur. **Yerel kök yap** seçili klasörü bu makinenin yerel köklerine ekler; içindekiler bundan sonra kendiliğinden eşlenir. Seçim sekmede, hızlı gönderimde, izlemede ve geçmişteki **Yeniden gönder**de saklanır. Ayarlar › Kopyalama › *Kök dışı kaynakları tam yoluyla gönder* eski davranışı yeniden varsayılan yapar. Kaynakların hepsi bu makinenin yerel köklerinin dışındaysa (başka bir diskteki sürüm gibi) **bu makine** de hedef olabilir: dosyalar paylaşım yerine doğrudan ilk yerel köke, kendi diskine yazılır; hedef listesi ve inceleme bu kökü *bu makine* rozetiyle gösterir.

**Her kaynağın hedefteki yeri.** Her kaynağın altındaki satır, hedeflerde gidebileceği yerlerin listesidir: yerel köke göre yolu (varsayılan, öyle işaretli), üstündeki herhangi bir klasörün hedef kökü sayıldığı yerler, tam yol ya da hedef köküne göre bir yol yazmak için **Başka bir yol yaz…** (örneğin `Contents`). Varsayılanı yeniden seçmek seçimi kaldırır.

**Çakışan kaynaklar.** Aynı yere giden iki klasörün içerikleri birleştirilir; ikisinde de olan bir dosya listede önce gelenden alınır ve inceleme kaç tane olduğunu söyler. Başka bir kaynağın yerinin içine düşen kaynak hedeflerin o kısmını devralır: `Release` köke, `D:\icerik\Contents` de `Contents`'e gidiyorsa hedeflerdeki `Contents` yalnızca ikinciden gelir; birincisi orada ne karşılaştırır, ne yazar, ne siler. Böylece ayna kipinde `Contents` içinde yalnızca ikincide olmayanlar silinir. Diskte gönderilen bir klasörün içinde duran kaynak (`Release` ve `Release\Data`) zaten onun parçasıdır. Klasörün altındaki satır neyi başkalarına bıraktığını ("Contents/ hariç: orayı başka bir kaynak alıyor") ya da kiminle birleştirildiğini söyler.

**Kaynak listesi.** Tıklamak bir kaynağı seçer; Ctrl bir tane ekler, Shift aralık alır, Ctrl+A hepsini seçer. Üstteki çubuk seçilenleri etkinleştirir, devre dışı bırakır ya da çıkarır (Delete de çıkarır). Kaynağın önündeki onay kutusu onu listeden çıkarmadan kapatır: listede kalır ama gönderilmez, karşılaştırılmaz, pakete yazılmaz, izlenmez. Sağ tık **Explorer’da göster**, **Yolu kopyala**, etkinleştir/devre dışı bırak ve **Listeden çıkar** sunar; listenin altından başka dosya ya da klasör seçilir ya da yol yapıştırılır. Büyük bir klasör sayılırken satırı bunu yazar. Hedef listesinde sağ tık o makinede gönderimin vardığı klasörü (paylaşımı ya da bu makinenin kendi kökünü) açar, yolunu kopyalar ya da yalnızca o makineyi seçer; kırpılmış yol üzerine gelince tam görünür.

Gönderimden sonra hedefin kökünde `samsync-manifest.json` da durur: gönderilen klasörün altındaki her şey (ad, boyut, tarih), SamSync'in bıraktığı hâliyle. Sonraki plan hedefi ağ üzerinden gezmek yerine ondan başlar — önce kökün listesi ve 24 dosyalık bir örnek hedefle karşılaştırılır; biri bile tutmazsa (diskten kopyalanmış bir sürüm gibi) klasör eskisi gibi taranır. Ayarlar → Kopyalama → *Manifeste güven* (varsayılan 7 gün; 0 her seferinde gezer) süresinden eski manifest kullanılmaz; incelemede "manifestten" rozeti ve yanında **Tam tara** görünür, seçeneklerdeki **Hedefi baştan tara** bir gönderim için aynısını yapar; Karşılaştır sayfası her zaman doğrudan bakar. Gönderim bir makineye yazarken kökte `samsync-lock.json` bırakır (bilgisayar, kullanıcı, gönderimin adı, başlangıç); başkasının taze kilidi incelemede o makinede "X yazıyor" uyarısıyla görünür, çalıştırma günlüğüne de düşer (gönderim yine sürer). 30 dakikadan eski kilit yok sayılır. Liste varsayılan olarak **klasör ağacı** (her klasör satırında dalın sayıları ve boyutu, tek çocuklu zincirler tek satırda, ilk düzey açık; klasörün onay kutusu bütün dalı alır) ya da istenirse düz liste. Her satırın işareti kaldırılabilir, `⇄` ile kaynak–hedef satır farkı açılır, **Seçimi tüm hedeflere uygula** bir hedefte yapılan seçimi ötekilere taşır. **İzle** seçili kaynakları izlemeye alır (bkz. *Otomasyon*).

Seçenekler: kip (Üzerine yaz / Yalnızca yeni / Ayna), karşılaştırma (tarih+boyut / içerik / boyut), **yedek al** (eski hâller hedefte yedek klasörüne `<tarih>` altında taşınır), doğrulama (içerik özeti), hariç dosya/klasör kalıpları, eşzamanlı hedef sayısı, deneme çalıştırması, bitince bildirim, kopyalama sonrası komut ve **Hata olursa makineyi geri al** (ya hep ya hiç: gönderimi yarıda kalan makine, bu seçeneğin açtığı yedekten gönderim öncesi hâline döner; hiç ulaşılamayan makinede geri alınacak bir şey yoktur, bir rölenin ilettiği makineler buradan geri alınmaz).

**Tek makineye özel dosyalar.** Ayarlar › Kopyalama › *Makineye özel klasör* bir klasör adı alır (örneğin `_machines`); gönderilen klasörün en üstünde bu adda bir klasör varsa içindekiler tek tek makinelere gider: `_machines\PC-1\app.ini` yalnızca PC-1'e, ortak `app.ini` yerine; `_machines\Lab-A\…` Lab-A grubunun bütün makinelerine. Alt klasör makineyi kimliğiyle, adıyla (adres kısmıyla ya da onsuz) ya da adresiyle, grubu adıyla bulur; makinenin kendi klasörü grubununkinin üstüne gelir. Makineye özel klasörün kendisi hiç gönderilmez; inceleme bu dosyaları *bu makineye özel* diye işaretler, Karşılaştır sayfası ve ayna kipi onları makinenin alacaklarından sayar, paket de klasörü olduğu gibi taşır, böylece paket uygulandığı yerde de dosyalar doğru makinelere gider. Boş (varsayılan): kapalı.

**Hedefe özel ayar** (eski sihirbazın *Yedek al* / *Yalnızca yeni* / *Ayna* sütunları): makine satırının sonundaki ayar düğmesi o makineye kendi kipini ve yedeğini verir. Örneğin bir salonun sunucusu yedekli aynalanırken öteki makineler yalnızca yeni dosyaları alabilir.
- Satır istisnayı rozetle gösterir, alt çubuk sayar (*N hedefte özel ayar*), inceleme de her hedef kartında gösterir.
- **Seç → Hedefe özel ayarları temizle** bütün makineleri genel seçeneklere döndürür.
- Son gönderimle birlikte saklanır; `--to last` ve *Son ayarla gönder* bunları kullanır. Profil kendi makinelerinin istisnalarını saklar.

**Sekmeler.** Gönder sayfasında her biri kendi kaynaklarını ve hedeflerini tutan sekmeler var (**+** yeni sekme açar, çift tık yeniden adlandırır). Explorer'dan ya da Notepad++'tan gelen *İncele ve gönder* kendi sekmesinde açılır; menüden gelen öğeler elle hazırladığınız listeye hiç karışmaz. Bir sekme, seçenekler kartında **Bu listeye özel** seçilmedikçe **genel** seçenekleri kullanır; seçilince seçenekleri o sekmede kalır (küçük bir simge işaretler) ve liste hızlı gönderim olarak kaydedilince onunla saklanır, genel seçenekler değişmez. Hemen yanında **Genel seçeneklere göre sıfırla** ve **Varsayılanlara sıfırla** (Ayarlar › Kopyalama'daki değerler) var; komut satırından açılan bir hızlı gönderim ya da profil kendi seçenekleriyle ayrı bir sekmede gelir.

Yazma atomiktir: dosya önce geçici adla yazılır, boyutu (ve istenirse özeti) doğrulanır, sonra yerine konur. Yarım kalan kopya hedefi bozmaz. 8 MB ve üstü dosyalar sabit adlı bir geçici dosyaya yazılır; iptal, kopan bağlantı ya da kapanan uygulama yüzünden yarım kalan kopya bir sonraki gönderimde **kaldığı yerden sürer** (önce hedefteki parçanın kuyruğu kaynakla karşılaştırılır). İptal artık dosyanın bitmesini beklemez, kopyayı anında keser. Hedefte bir programın açık tuttuğu dosya değiştirilemez; ama dosya zaten yazılacak içeriğin aynısını taşıyorsa (daha önce tarihleri korumayan bir araçla kopyalanmış, bu yüzden tarih karşılaştırması onu hep seçiyorsa) yalnızca tarihi eşitlenir ve öğe tamamlanmış sayılır; sonraki gönderim ona dokunmaz. İptal ya da hata sonrasında çalıştırma paneli **Yeniden dene** sunar: aynı kaynaklar yeniden planlanır, iptalden sonra bütün makinelere (zaten gitmiş olanlar atlanır), hatadan sonra yalnızca hatalı biten makinelere; önce inceleme açılır. Görev çubuğundaki düğme süren gönderimlerin ve hazırlanan incelemenin ilerlemesini gösterir; pencere arka planda kalabilir. İnceleme, gönderimden önce değişecek dosyaların her makinede açık tutulup tutulmadığını dener ve o makinede adlarıyla uyarır. Ayarlar › Kopyalama › **Kopyalama öncesi komut**, her hedefe ilk dosya gitmeden önce bu bilgisayarda çalışır, sonrası komutla aynı yer tutucuları alır; sıfırdan farklı kodla biterse o makineye yazılmaz. Böylece oradaki programı durduran bir zamanlanmış görev önce çalışır, sonrası komut da yeniden başlatır.

**Paket dosyası.** **Paket yaz**, kaynakları (gönderimin dışlamaları ve ignore dosyalarıyla) makineler yerine tek bir sıkıştırılmış `.samsync-pack` dosyasına yazar — USB ile götürülen sürüm için. Alan makinede dosya Gönder listesine bir klasör gibi eklenir: plan içindekileri hedefle karşılaştırır, yalnızca farklı olanlar yazılır, ayna fazlalıkları siler, bitince ağ gönderimindeki gibi manifest kalır; sonraki ağ gönderimi yine hızlı başlar. Bütün kaynaklar paketse **bu makine** de hedef olabilir (kendi diskine, doğrudan). Kaynak satırında "paket" rozeti: etiket, dosya sayısı, boyut, kim yaptı, ne zaman. **Parolayla koru** seçilirse paket AES-256 ile şifrelenir (anahtar paroladan scrypt ile türetilir): parola olmadan ne dosyalar ne de listesi okunur. Alan makinede böyle bir paket "parolalı" rozeti ve **Parola…** düğmesiyle görünür; parola bir kez sorulur, uygulama kapanana dek hatırlanır. Kurulum `.samsync-pack` dosyalarını SamSync'e bağlar: çift tık paketi Gönder sayfasına getirir. **Paket yaz** **artımlı** paket de yazar: *önceki pakete göre* (makineye en son uygulanan paket) ya da *makinedeki sürüme göre* (manifesti; makine erişilebilir olmalı). Orada olduğu gibi duran dosyalar yalnızca liste olarak gider, paket yalnızca değişenleri taşır; alan makinedeki inceleme beklenen dosyalardan biri eksik ya da farklıysa söyler, onlar için tam paket gerekir.

### Karşılaştır
Gönder sayfasındaki kaynakları hedeflerle **hiçbir şey göndermeden** karşılaştırır. Makinedeki klasörler işletim sisteminin klasör sorgusuyla listelenir; bu sorgu bir klasörün bütün dosyalarını boyut ve tarihle tek seferde döndürür. Ağ paylaşımında bu, her dosyayı ayrı sormaktan kat kat hızlıdır; on binlerce dosyalık karşılaştırmanın dakikalar sürmesinin nedeni oydu. Dışlanan klasörler yine atlanır. Yerel klasörler düz gezintiyle kalır, diskte o daha hızlıdır. Her hedefin sayılarıyla bir sekmesi olur. Soldaki listede yeni, değişen, hedefte daha yeni ve fazla dosyalar süzgeç ve aramayla görünür; seçtiğiniz dosyanın satır farkı, Git sayfasındaki gibi sağda açılır. **Bu farkları gönder…** her zamanki incelemeyi açar.

**Makine ↔ makine** kipi aynı klasörü iki makinede karşılaştırır: yalnız birinde olanlar, farklı olanlar, hangisinin daha yeni olduğu ve seçilen dosyanın satır farkı — aynı olması gereken makineler (A ↔ B) için. Hiçbir şey yazılmaz; eşitlemek için Senkron sayfası.

### Git
Depo, yerel köklerden otomatik bulunur (ya da eklenir).

- **Yerel değişiklikler** — hazırlanmış, hazırlanmamış ve izlenmeyen dosyalar.
- **Commit'ler** — tıkla: tek commit; Ctrl+tıkla: ekle/çıkar; Shift+tıkla: aralık. Hızlı seçimler: *Son commit*, *Son 3*, *Push edilmemiş*. Mesaj veya SHA ile arama, tüm dallar.

Seçilen commit'lerin dosyaları tek listede birleşir; her dosyanın farkı sağda görünür. İçerik kaynağı seçilebilir: **diskteki hâli** ya da **commit'teki hâli**. Silinen ve taşınan dosyalar hedeften de kaldırılır (kapatılabilir). Commit içeriği hedefle git nesne özeti üzerinden karşılaştırıldığı için aynı olan dosya yeniden yazılmaz.

### Senkron
Klasör çiftleri (sol: bu makine ya da bir hedef, sağ: herhangi bir hedefin alt klasörü ya da yerel klasör) için:

- **İki yönlü** — son eşitlemenin durumunu hatırlar; bir tarafta silineni öbür tarafta da siler, iki tarafta değişeni **çakışma** olarak işaretler.
- **Ayna**, **Güncelle**, **Özel** (her durum için işlemi siz seçersiniz).
- Filtre: dahil/hariç kalıpları, boyut ve tarih sınırı. İki taraftan birinin kökündeki (ya da Gönder sayfasından gönderilen bir klasördeki) **`.samsyncignore`** dosyası kendi desenlerini ekler: satır başına bir desen, `#` açıklama, sonda `/` klasör demektir. Dosyanın kendisi hiç kopyalanmaz.
- Silinen ya da üzerine yazılan dosyalar üç yoldan birine gider:
  - **sürüm klasörüne**: sayıyla ve istenirse gün olarak yaşla sınırlanır;
  - **Geri Dönüşüm Kutusu'na**: yerel klasörlerde; diğer yerlerde sürüm klasörü kullanılır;
  - ya da kalıcı olarak silinir.
- **Dışa aktar / İçe aktar**, bir işi `.samsync-job.json` dosyası olarak kaydeder ve bu ya da başka bir makinede geri yükler.
- `SamSync.exe --sync <iş>`, bir işi pencere açmadan çalıştırır (ör. Windows Görev Zamanlayıcı'dan). Bir özet yazar ve her şey başarılıysa `0` ile çıkar.
- **Zamanla** — iş belirli aralıklarla ya da saatlerde kendiliğinden çalışır (bkz. *Otomasyon*).

Karşılaştırma sonucu ızgarada görünür; her satırın işlemi tıklanarak değiştirilir, çift tıklama satır farkını açar. İki yönlü karşılaştırma çakışma bulursa **n çakışmayı çöz…** onları iki tarafın boyutu ve tarihi, nedeni ve satır farkıyla listeler: her biri için sol kazansın, sağ kazansın, **ikisini de sakla** ya da atla; hepsine birden de (yeni olan kazansın, sol, sağ, ikisini de sakla). *İkisini de sakla* her dosyanın yanına öbür tarafın sürümünü `ad (sol).uzantı` / `ad (sağ).uzantı` olarak yazar, hiçbir şey silmez; iş, taraflardan biri yeniden değişene dek o dosyaya dokunmaz.

### Otomasyon
- **Canlı izleme** — bir değişiklikten sonra kısa bir sessizlik süresi (varsayılan 2 sn) bekler ve yalnızca değişenleri gönderir. Gönder sayfasındaki **İzle** düğmesiyle ya da bu sayfadan eklenir.
  - *Ne zaman:* dosya kaydedilince ya da **Git olaylarında**. Commit, amend, merge ya da pull'dan sonra (isteğe bağlı olarak rebase, cherry-pick, reset de) o commit'lerin değiştirdiği dosyalar diskteki hâlleriyle gönderilir. Deponun reflog'u okunduğu için Git kancası gerekmez; dal değiştirmek, siz istemedikçe bir şey göndermez.
  - *Nereye:* yapılandırmadaki makinelere ve/veya yapılandırma gerektirmeyen **düz klasörlere** (yerel, bağlı ya da `\\sunucu\paylaşım`). İzlenen her klasörün içeriği, kendi içindeki yollarıyla oraya yazılır. Göndermek yerine her değişiklikte **bir senkron işi de çalıştırılabilir** (canlı iki yönlü, ayna… senkron).
  - *Elle:* izleme kartındaki gönder düğmesi, izlenen yollarda hedeften farklı olanları beklemeden gönderir; izleme kapalıyken de çalışır. Senkron işi çalıştıran izlemede işi çalıştırır. Yalnızca farklar gider, hedefte bir şey silinmez.
  - *Ayrıca:* izleme başlarken mevcut farklar bir kez gönderilebilir. Geçici dosyalar (`~$…`, `.tmp`, `.swp`) ve `.git` yok sayılır; hedefte silme isteğe bağlıdır.
- **Zamanlanmış senkron** — senkron işleri her N dakikada bir ya da belirli saatlerde (örn. 09:00, 18:30) karşılaştırılıp önerilen işlemlerle eşitlenir; çakışmalara dokunulmaz. Yapılandırma bütün makinelerde ortak olduğu için her iş **tek bir makinede** çalışacak şekilde işaretlenir. Uygulama kapalıyken kaçırılan saat, açılınca çalıştırılır.
- **Zamanlanmış hızlı gönderim** — Gönder sayfasında kaydedilmiş bir hızlı gönderim belirli saatlerde ya da her N dakikada bir bu makinede kendi kendine gider, inceleme açılmadan (değişiklik yoksa bir şey olmaz). Çipteki kalem adı, kısayolu ve zamanlamayı düzenler; burada zamanlanmış işlerle birlikte listelenir, *Şimdi çalıştır* var.
- **Hepsini duraklat** — izleme ve zamanlamayı birlikte durdurur (tepsi menüsünden de).
- **Otomasyon ayarları** (bilgisayar başına):
  - erişilemeyen makinelere yeniden deneme: varsayılan olarak kapalı. Kapalıyken erişilemeyen makine o değişiklikleri almaz; açıkken değişiklikler saklanır ve N dakikada bir yeniden gönderilir;
  - bildirimler: hiç / yalnızca hatalarda / her gönderimde;
  - tek bir otomatik gönderimin en çok kaç dosya taşıyacağı (binlerce değişiklik gibi görünen bir dal değişikliği gönderilmez; varsayılan 1000, 0 = sınırsız);
  - uygulama kapalıyken kaçırılan zamanlamanın açılışta çalışıp çalışmayacağı.

Otomasyon uygulama açıkken çalışır. Ayarlar → *Arka plan ve başlangıç*: **Kapatınca sistem tepsisinde çalışmaya devam et** ve **Windows açılışında başlat** (tepside gizli başlar) ile sürekli çalışabilir. Otomatik çalışmalar da Geçmiş'e yazılır.

### Yardım
Uygulama hakkında sorular ve yanıtlar, bir de **yardım botu**. Başlık çubuğundaki bot düğmesi (ya da **F1**) bir sohbet açar: "nasıl gönderirim", "röle nedir", "sürümü USB ile götüreceğim" diye sorun; kırk maddelik iki dilli SSS'den ve bu README'den (uygulamayla gelir) yanıtlar, yanıtın geldiği maddeyi ya da README bölümünü söyler, ilgili sayfayı açar. Çevrimdışı çalışır: Türkçe ve İngilizce gövde bulma ve eş anlamlı sözlüğüyle küçük bir arama. Ayarlar › **Yardım botu**'na bir Claude API anahtarı girilirse (bu makinede işletim sisteminin şifreli deposunda saklanır) serbest sorular aynı belgelerle birlikte Claude'a gider; anahtar yokken ya da çağrı başarısız olunca çevrimdışı yanıt gösterilir. Yardım sayfasında arama kutusu, konu konu SSS ve eşleşen README bölümleri var.

### Hedefler, Yedekler, Geçmiş, Ayarlar
- **Röle** — bir gruptaki bir makine kartında grubun rölesi olarak işaretlenebilir. Röleyle birlikte grubun başka makinelerini de içeren bir gönderim yalnızca röleye yazar (kendi, çoğu zaman yavaş, bağlantınızdan — örn. Wi‑Fi — tek kopya); röledeki SamSync işi paylaşımındaki `_SamSyncRelay\jobs` klasöründen alır, dosyaları kendi diskinden grubun ağı üzerinden dağıtır ve sonucu yazar; inceleme, çalıştırma paneli ve geçmiş her makineyi "X üzerinden" olarak sonucuyla gösterir. Rölenin kendi değişiklikleri dosya dosya ağ kopyası yerine **tek bir sıkıştırılmış paket** olarak gider (`_SamSyncRelay\jobs\<id>.pack`, dosya başına gzip; zaten sıkışık biçimler olduğu gibi); oradaki SamSync paketi diskine uygular (yedek, kullanımdaki dosya denetimi ve doğrulama her zamanki gibi), sonra dağıtır. Bir DLL yaklaşık %40'a, bir PDB %23'e iner. Röle olarak işaretlenen makine, arkasında kimse olmasa da değişikliklerini paket olarak alır. Röledeki SamSync yarım dakikada bir kalp atışı yazar (`_SamSyncRelay\alive.json`): makine kartındaki rozet **röle açık / röle kapalı** der; kalp atışı eski ya da yoksa plan röleye ve arkasındakilere beklemeden doğrudan yazar. Kalp atışı taze olduğu hâlde röle 60 sn içinde işi almazsa paket geri alınır ve o makinelere, röle dahil, buradan doğrudan ayrı bir gönderim başlar. İş geldiğinde kapalı olan grup makinesi hata sayılmaz: röle işi `_SamSyncRelay\pending` altında saklar ve makine yanıt verince teslim eder (5 dakikada bir denenir, 7 gün sonra düşürülür; `copy.relayQueueMinutes`, 0 kuyruğu kapatır, ve `copy.relayQueueDays`). Çalıştırma paneli ve geçmiş böyle bir makineyi "kuyrukta" diye işaretler, rölenin kartı kuyruğunu listeler. Tek başına seçilen bir grup makinesine doğrudan yazılır; Karşılaştır sayfası ve `--check-only` her makineye doğrudan bakar. Rölenin ilk yerel kökü paylaşımının gösterdiği klasör olmalıdır; `copy.relayAckSeconds` ve `copy.relayTimeoutMinutes` bekleme sürelerini ayarlar.
- **Ajan** — SamSync çalışan her makine kendisine gönderileni sıkıştırılmış tek paket olarak alır ve kendisi uygular; rölenin kendi değişiklikleri için yaptığının aynısı. Ayarlar › **Ajan** bunu kapatır (varsayılan açık). SamSync kalp atışını yazar ve makinenin ilk yerel kökü altındaki `_SamSyncRelay` klasörünü izler (Windows'ta gizlidir, hiçbir gönderime girmez, ajan kapatılınca silinir); paylaşım o kökü göstermelidir, göstermiyorsa gönderen taraf eskisi gibi paylaşım üzerinden yazar. Makine kartı ve inceleme **ajan** rozeti gösterir. Alan makinede her paketin çevresinde bir **uygulamadan önce komut** (dosyaları açık tutan programı durdurmak için; sıfırdan farklı kodla biterse hiçbir şeye dokunulmaz) ve bir **uyguladıktan sonra komut** (programı yeniden başlatmak için, başarısızlıkta da) çalışır; masaüstü bildirimi kimin gönderdiğini ve kaç dosyanın geçtiğini söyler.
  - **Hedefte içerik karşılaştırması:** karşılaştırma içeriğe göre yapılırken hedefin dosyaları ağ üzerinden geri okunmaz. Gönderen taraf dosyaların listesini (yol, boyut, tarih) paylaşımdaki `_SamSyncRelay\hashes` klasörüne bırakır; oradaki SamSync bunları kendi diskinden okuyup SHA-256 özetlerini listenin yanına yazar, gönderen taraf da bunları kendi kopyalarının özetleriyle karşılaştırır. Boyutu ya da tarihi listedekinden farklı bir dosya gönderen tarafın kendi okumasına bırakılır. İnceleme kaç dosyanın orada özetlendiğini gösterir; listeyi birkaç saniye içinde almayan makine eskisi gibi ağ üzerinden okunur. Karşılaştır sayfası (makine ↔ makine de), senkron işleri ve `--check-only` da aynı yolla sorar; makine ↔ makine karşılaştırmasında yalnızca bir tarafta SamSync çalışıyorsa yalnızca öbür taraf okunur.
  - **Blok farkı:** ajanın diskinde zaten bulunan 8 MB ve üstü bir dosya yalnızca farklı bloklarıyla gider. Ajan kendi kopyasının 1 MB'lık bloklarını özetleriyle listeler, paket yalnızca değişen blokları taşır, ajan yeni dosyayı bunlardan ve kendi bloklarından kurar; bir şeyin yerine yazmadan önce bütün dosyanın SHA-256 özetini denetler, kendi kopyası bu arada değiştiyse reddeder.
  - **Kartta:** kalp atışı SamSync sürümünü, paylaşımın gösterdiği klasörü, son işi ve son hatayı da söyler. Kart **ajan 2.4.2** gösterir (bu kopyadan eskiyse sarı ve *eski*), oradaki SamSync haber vermeden yanıt vermez olduysa **ajan durmuş**, son hata varsa bir uyarı işareti. Makinenin kendisinde "Bu makine" kartı ve Ayarlar › Ajan, ilk yerel kök yoksa ya da paylaşım başka bir klasörü gösteriyorsa (rölede, ya da gönderenlerin paylaşım üzerinden zaten yazdığı yerde) uyarır: gönderenler oradaki SamSync'i göremez; **Düzelt** paylaşımın klasörünü ilk yerel kök yapar.
  - **Ağdan güncelleme:** o makinede Ayarlar › Ajan › *Ağdan güncellemeyi kabul et* açıksa (varsayılan kapalı: paylaşıma yazabilen herkes oraya kurulum bırakabilir), Hedefler sayfasındaki **Ajanları güncelle (n)** ya da karttaki ok, bu sürümün Windows kurulumunu makinedeki `_SamSyncRelay\update` klasörüne bırakır. Oradaki SamSync dosyayı SHA-512 özetiyle denetler, çalışan iş kalmayınca sessizce kurar ve yeni sürümle yeniden açılır; aynı ya da daha eski sürüm kurulmaz. Kurulum bu bilgisayarın sakladığı kopyadan, güncelleme klasöründen ya da bu derlemenin geldiği sürümden (bir kez indirilir, `latest.yml` ile denetlenir) gelir; hiçbiri yoksa bir SamSync-Setup dosyası seçilebilir. Güncelleme kabul eden bir rölenin arkasındaki makineler kurulumu röleden kendi ağları üzerinden alır; yavaş bağlantıdan bir kez geçer.
  - **Dosyayı tutan programlar:** bir gönderim bir programın açık tuttuğu dosyalarla bitince çalıştırma penceresi her makineye dosyaları hangi programların tuttuğunu sorar (Windows Restart Manager; bu makinede doğrudan, ötekilerde oradaki SamSync üzerinden) ve onları işlem numaraları ve dosyalarıyla listeler. **Kapat ve tekrar dene** bu programları kapatır (önce kapanmalarını ister, birkaç saniye sonra sonlandırır) ve kullanımdaki dosyaları yeniden yazar; başka bir makinede yalnızca orada Ayarlar › Ajan › *Gönderenler dosyayı tutan programı kapatabilsin* açıksa (varsayılan kapalı) ve yalnızca o an çalıştırmanın dosyalarından birini tutan programlar. Sistemin kendi programları ve Explorer hiç kapatılmaz.
  - Bunların hepsi için SamSync makinede çalışıyor olmalıdır: Ayarlar › *Arka plan ve başlangıç* onu tepside tutar ve oturum açılınca başlatır. Çalışmadığı yerde gönderimler her zamanki gibi paylaşım üzerinden gider.
- **Makine envanteri** — Hedefler sayfasında hangi makinede hangi sürüm olduğu: satırlar gönderilen klasörler, sütunlar makineler; hücrede SamSync'in bıraktığı manifestten etiket, zaman ve boyut. Bir klasörün en yeni hâli ölçüttür; ondan geride olanlar "geride", klasörü hiç almamış olanlar "eksik", erişilemeyen makine kırmızı. Her çalıştırmadan sonra ve istenince yenilenir; paketten uygulanan sürümler de burada görünür. **Sapma denetle** her makinenin gönderilmiş klasörlerini o manifestle karşılaştırır: son gönderimden sonra orada değişen, eklenen ya da silinen dosyalar (giden bir klasör bir kez sayılır), makine ve klasör başına. SamSync çalışan makine kendi diskine bakar; ötekiler paylaşım üzerinden gezilir. Kendiliğinden saatte bir, 6 saatte bir ya da günde bir de çalışabilir (varsayılan kapalı); bulduğu masaüstüne ve, ayarlıysa, ekip kanalına gider.
- **Hedefler** — makine kartlarında erişim durumu (45 sn'de bir yenilenir), son gönderimin hızı ve süresi, **hız sınaması** (3 MB yazılır, geri okunur, silinir: yazma/okuma MB/sn ve gecikme) ve rölede SamSync'in çalışıp çalışmadığı; "Bu makine" kartı rölenin kendi durumunu gösterir (alınan iş, son iş). Ekleme/düzenleme. **JSON olarak düzenle** bütün yapılandırma dosyasını metin olarak açar: Erişilebilen makine diskindeki boş alanı da gösterir (2 GB altında kırmızı), hedef listesinde de. Makinenin adının üstüne gelince adı, adresi, kimliği ve grubu görünür; yoluna tıklayınca Explorer'da açılır, sağ tıkta bu ve yolu kopyalama çıkar. Otomasyon kartlarındaki yollar da böyledir; bir izlemenin hedef satırının üstüne gelince bütün makineler listelenir. Makineye son gönderim bir sürüm noktası olarak adlandırıldıysa son gönderim satırında bu ad görünür. Kapalı bir makine, MAC adresi biliniyorsa (açıkken SamSync'in kalp atışından ya da bu bilgisayarın ARP tablosundan öğrenilir, ya da makine düzenleyicisine yazılır) **Uyandır** düğmesi gösterir; böyle birden çok makinesi olan grup **Kapalıları uyandır**. Wake-on-LAN paketi bu bilgisayarın bütün ağlarına gider; makinenin ağ kartında Wake-on-LAN açık olmalıdır.
  - siz yazarken denetler ve hatanın satırını ve sütununu gösterir; kaydederken yapılandırma olarak bir kez daha denetler;
  - metni yazdığınız gibi kaydeder, eski aracın alanları korunur;
  - başka bir dosyayı gözden geçirmek için düzenleyiciye yükleyebilir ve bir kopyasını dışa aktarabilir. Bağlantı türleri: Windows paylaşımı (SMB, `\\adres\networkRoot`), klasör/bağlı sürücü, **SFTP** (anahtar, agent ya da işletim sisteminin şifreli deposunda saklanan parola).
- **Yedekler** — bir öğenin hedeflerdeki yedeklerini bulur, tarih seçip geri yazar (önce şu anki hâli yedekleyerek). Hedef kökündeki eski yedek klasörleri de taranır (aşağıya bakın); onların sürümlerinde klasör adı görünür.
- **Geçmiş** — son 300 çalıştırma: hedef bazında sonuç, hatalar, günlük, CSV rapor, *yeniden gönder* / *hatalılara yeniden gönder*. Üstteki şerit son 30 günü gösterir: gönderim sayısı, veri ve ortalama hız, hatalılar, gün gün çubuk (hatalı gün kırmızı; tıklayınca o gün listelenir) ve en çok veri alan makineler. **Geri al**, yedek alınarak yapılmış bir gönderimin değiştirdiği ve sildiği dosyaları o çalıştırmanın yedeklerinden geri getirir, eklediklerini siler. Çalıştırma günlüğü çalışırken `history/<id>.log` dosyasına akar. Gönderim sürerken **Duraklat** onu dosyalar arasında bekletir (süren kopya da akış ortasında durur), **Sürdür** devam ettirir; bir hedefin satırındaki × o makineyi çalıştırmadan çıkarır, diğerleri sürer; çalıştırma paneli son bir dakikanın hız grafiğini (anlık, tepe, ortalama, duraklama), grup çiplerini ("Lab-A 3/5") çizer; Windows görev çubuğundaki düğme ilerlemeyle dolar ve arkada biten gönderimde yanıp söner. **Sürüm noktası…** bir çalıştırmayı adlandırır; rozet üstünde görünür ve **Bu noktaya dön…** o makinelere sonradan giden her gönderimi yedeklerinden geri alır, en yenisinden başlayarak (yedek almadan yapılan gönderim atlanır ve belirtilir). **Dosya izi** bir dosyanın hangi gönderimle hangi makineye gittiğini bulur, en yenisi üstte. Bir makinede bir programın açık tuttuğu dosya çalıştırmanın sonunda bir kez daha denenebilir (Ayarlar › Genel › *Çalıştırma sonunda kullanımdaki dosyaları bir kez daha dene*, varsayılan kapalı); böyle hatalarla biten bir çalıştırmadan sonra paneldeki **Kullanımdakileri tekrar dene** yalnızca o dosyaları inceleme olmadan aynı makinelere yeniden yazar. Dar pencerede çalıştırmanın düğmeleri başlığın altına iner, liste çalıştırmanın üstünde durur.
- **Bildirimler** — başlık çubuğundaki zil, kimse bakmazken olanları listeler: biten gönderimler (hatalılar okunmamış kalır), erişilemez olan ya da geri gelen makineler, yeni sürüm, duran izleme, hatalı biten zamanlanmış iş. Tıklamak ilgili sayfayı açar (geçmişte o çalıştırmayı); son 100 olay saklanır. Bir röle ya da ajanın bir gönderim için yaptığı iş (paketi uygulama, gruba dağıtma) kanala ayrıca bildirilmez: bütün gönderim bitince gönderen taraf her makineyle birlikte bir kez bildirir; rölenin kuyruktan sonradan yaptığı teslimi röle bildirir. Mesajın sonunda gönderen, `whoami` biçiminde yazar (`ALAN\kullanıcı`, yerel hesap değilse makine adıyla). **Bitince ses** (Ayarlar › Genel): gönderim başarılıysa yükselen iki nota, hata varsa alçak bir uyarı; her bitişte, yalnızca hata varsa ya da kapalı. Deneme çalıştırmaları ve iptaller sessizdir. Windows'ta masaüstü bildirimi yalnızca kurulu uygulama için görünür (Başlat menüsü kısayolu uygulama kimliğini taşır); tam ekran bir program ya da odak yardımı bildirimleri tutarken görünmez. Gösterilemeyen bildirim günlüğe yazılır.
- **Ayarlar** — dil (Sistemle eşle / Türkçe / English / Deutsch / Español; varsayılan sistemle eşle), tema (Koyu / Açık / Sistemle eşle; varsayılan koyu), vurgu rengi, yoğunluk; kopyalama varsayılanları (yeniden deneme, eşzamanlılık, **hedef başına bant genişliği sınırı** — eski aracın `/IPG` karşılığı, yedek klasörü adı); yapılandırma dosyası; sağ tık menüleri (Explorer, Notepad++); arka plan ve başlangıç; güncellemeler (sürüm notları bağlantısıyla); **Tanılama klasörü oluştur…** (günlükler, yapılandırma, ayarlar ve bir özet tek klasörde, parolalar hariç; bir sorunu anlatırken paylaşın); **Bildirimler** (gönderim bitince JSON alan bir web kancası ve/veya mesaj alan bir Telegram botu ve sohbeti — hatada her zaman, başarıda isteğe bağlı — başarısız makineler nedenleriyle; sınama düğmesi); **arayüz ölçeği** (%70–175; Ctrl + / Ctrl − / Ctrl 0 ile de); **Bu sürümdeki yenilikler** (güncellemeden sonra bir kez gösterilen sürüm notu). Pencerenin boyutu, yeri ve ekranı kaplama durumu bir sonraki açılışta geri gelir. Arayüz bir hata verirse boş pencere yerine hatanın metni, *Yeniden yükle*, tanı klasörü ve kopyalama düğmeleri çıkar. **Erişilemeyen makineye açılınca gönder** (Ayarlar › Genel, varsayılan kapalı): kapalı bir makineye yapılan gönderim bu bilgisayarda bekler; makine dakikada bir yoklanır ve yanıt verince kaynakların o anki hali gönderilir. Bekleyenler Hedefler sayfasında, düşürme düğmesiyle listelenir; 7 gün içinde açılmayan makinenin gönderimi düşer. SamSync açık olmalıdır. Ayarlar kartları birbirine yakın biten sütunlara dizilir, kısa kartlar üstte.

**Klavye:** Ctrl K komut paleti, Ctrl / bütün kısayolların listesi, Ctrl , Ayarlar, Ctrl 1…9 sayfalar (Genel bakış 1), Ctrl Enter Gönder sayfasında inceleme açar ve incelemede gönderir (Shift ile deneme), Esc açık olanı kapatır.

Yedek klasörü varsayılan olarak hedef kökündeki `_SamSyncYedek` klasörüdür; adı Ayarlar → Kopyalama’dan değiştirilebilir.

**Eski yedek klasörleri** — eski araç yedeklerini hedef kökünde kendi adını taşıyan bir `_…Yedek` klasöründe tutuyordu. SamSync bir klasörü şu durumda yedek klasörü sayar: hedefin (ya da bir yerel kökün) kökündedir, adı `_` ile başlar ve içinde yalnızca `yyyyMMdd-HHmmss` klasörleri vardır. Böyle bir klasör:
- kökün tamamı ayna kipinde gönderilirken ya da aynalanırken silinmez, içine yazılmaz (inceleme bunu söyler) ve gönderime katılmaz;
- Yedekler sayfasında görünür, sürümleri geri alınabilir;
- hiç temizlenmez: *Saklanacak yedek* sayısı yalnızca ayarlı klasöre uygulanır.

Adı değiştirilmiş eski bir SamSync yedek klasörü de aynı biçimde ele alınır.

**Eski sihirbazdan içe aktarma** — Ayarlar → *Yapılandırma dosyası* → **Sihirbaz ayarlarını içe aktar**, eski sihirbazın profillerini ve son seçimini bir kez taşır.
- **Dosya:** `%LOCALAPPDATA%` altındaki `wizard-state.json` kendiliğinden bulunur; *Dosya seç…* ile elle de seçilebilir. Bu yapılandırma için kaydedilmiş kayıt kullanılır; klasör o zamandan beri taşındıysa makinelerinin çoğunu tanıyan kayıt alınır.
- **Son seçim:** işaretli makineler son gönderimin hedefleri olur. Makine başına sütunlar genel seçeneklere ve hedefe özel istisnalara dönüşür; böylece her makine eskiden neyse aynısını alır. Sihirbazın hariç dosya ve klasörleri yapılandırmadakilere eklenir. Deneme çalıştırması ve yalnızca robocopy'ye özgü ayarlar (hızlı kopyalama, paket arası bekleme, yeniden deneme) alınmaz.
- **Profiller:** yapılandırmaya SamSync profili olarak eklenir. Aynı adlı bir profil varsa olduğu gibi kalır.
- **Bilinmeyen makineler:** yapılandırmada olmayan makineler atlanır ve listelenir.

Eski araçta makine kimliği `setx` ile sabitlenmiş bilgisayarlarda aynı değeri `SAMSYNC_NODE_ID` olarak tanımlayın (`setx SAMSYNC_NODE_ID LabA-Server`) ya da Hedefler → *Bu makine*’den seçin.

## Web arayüzü (sunucu kipi)

Hep açık duran bir makinedeki SamSync, penceresini ağdaki tarayıcılara sunabilir; sürüm gönderen kişilerin bilgisayarına bir şey kurmak gerekmez. Ayarlar → **Web arayüzü**: bir parola belirleyin (en az 8 karakter; yalnızca scrypt özeti saklanır), kapıyı (varsayılan 8780) ve ağdan mı yoksa yalnızca bu bilgisayardan mı erişileceğini seçin, açın. Bölüm adresleri (`http://<ip>:8780`) ve bağlı tarayıcı sayısını gösterir. İkinci bir **izleyici** parolası (Ayarlar › Web arayüzü) tarayıcıya yalnızca bakan bir giriş verir: bir şeyi değiştirecek her çağrı bir iletiyle reddedilir, başlık çubuğu *salt okunur* der.

- Tarayıcı parolayla girer, pencereyle aynı sayfaları, canlı ilerlemeyi ve bildirimleri görür. Oturum çerezi (HttpOnly, SameSite=Strict) 12 saatlik etkinlik boyunca geçerlidir; beş yanlış parola o adresi bir dakika bekletir; API çağrıları başka bir sitedeki formun koyamayacağı bir başlık taşımak zorundadır.
- Dosya ve klasörler, SamSync'in çalıştığı bilgisayarın disklerini gezen bir pencereden seçilir. O bilgisayarın masaüstüne dokunacak işler — iletişim kutuları, orada dosya ya da klasör açmak, pencere denetimi, güncelleme kurmak, entegrasyon ve web arayüzünün kendi ayarları — tarayıcıdan yapılamaz; **Oturumu kapat** düğmesi oturumu kapatır.
- **HTTPS** (varsayılan kapalı) bağlantıyı bilgisayarın kendi ürettiği bir sertifikayla şifreler: adı ve adresleri için bir EC P-256 anahtarı; kullanıcı veri klasöründe saklanır, süresi dolmadan ya da adresler değişince yeniden üretilir. Tarayıcılar ilk girişte uyarır; bölüm, tarayıcının gösterdiğiyle karşılaştırmak için SHA-256 parmak izini gösterir. HTTPS kapalıyken bağlantı düz HTTP'dir: güvenilen bir ağda kullanın. Giren kişi bu bilgisayarın dosyalarını makinelere gönderebilir: parolayı bir yönetici parolası gibi saklayın.
- Tek bilgisayarda denemek için: `node scripts/server-demo.mjs` demoyu web arayüzü `http://127.0.0.1:8780` adresinde açık olarak başlatır (deneme parolası `samsync-demo`).

## Explorer ve Notepad++ menüleri

Kurulu uygulama eski aracın sağ tık menülerini geri getirir ve bu menüler **varsayılan olarak açıktır**. Ayarlar → **Sağ tık menüleri** altından kapatılabilirler. Uygulama her açılışta ve makine listesi, dil ya da bu anahtarlar değiştiğinde menüleri yeniden kurar. Menüler her zaman çalışan programı gösterir, bu yüzden güncelleme ya da taşıma sonrasında da çalışmaya devam ederler. Kaldırıcı menüleri siler.

**Explorer**'da dosya ve klasörlere sağ tıklayınca, eskisiyle aynı yapıda bir **SamSync** alt menüsü çıkar. Windows 11'de bu menü “Daha fazla seçenek göster” altındadır.

| Girdi | Tıklayınca |
| --- | --- |
| Tümüne gönder | bu makine dışındaki bütün etkin makinelere hemen gönderir |
| İncele ve gönder… | SamSync'i öğeler Gönder sayfasında olacak şekilde açar |
| Son ayarla gönder | son incelenen gönderimin hedefleri ve seçenekleriyle hemen gönderir |
| Yedekten geri al… | Yedekler sayfasını öğelerle açar ve bütün makinelerde arar |
| <profil> (profil) | profilin hedefleri ve seçenekleriyle hemen gönderir |
| <grup> | bütün gruba hemen gönderir ya da “<grup> - Tümü” ve makinelerini içeren bir alt menü açar |
| <makine> | o makineye hemen gönderir (gruba ait olmayan makineler) |

- **Ayırıcılar** menüyü bölümlere ayırır: tümü | incele ve son ayar | geri al | profiller | gruplar | tek makineler.
- **Menünün sığması:** Windows sabit bir alt menüyü 16 girdiye kadar rahat gösterir. Önce bu makinenin kendi grubu açılır. Diğer gruplar ancak hepsi birlikte sığarsa açılır; sığmazsa her biri tek girdi olur. Bu davranış eski araçtaki gibi `config.json` içindeki `menuShowNodes` ile değiştirilebilir (`auto`, `always`, `never`); aynı ayar Ayarlar sayfasında da var.
- **Tek tıkla gönderimler** Gönder sayfasındaki listeye dokunmaz. Hedefte silme yapacak bir gönderim (profilden ya da son ayardan gelen ayna kipi) doğrudan gönderilmez, inceleme açılır.
- **Menünün başlattığı program:** `SamSync.exe`'nin yanındaki küçük `SamSyncSend.exe` (kurulum ve zip sürümlerinde). Komut satırını çalışan SamSync'e adlandırılmış boru üzerinden birkaç milisaniyede verir; uygulama çalışmıyorsa `SamSync.exe`'yi başlatır. Tek dosyalı taşınabilir sürümün böyle bir komşusu yoktur, kendisini başlatır; ikinci bir `SamSync.exe` de çalışanı bulup ağır hiçbir şey yüklemeden çıkar.
- **Büyük seçimler:** 100 öğeye kadar seçim desteklenir. Explorer her öğe için programı bir kez başlatır ve gelen istekler tek gönderimde birleşir. Birleştirme boru üzerinden 150 ms (ikinci bir süreçle 400 ms) sessizlik bekler; ikinci öğe gelince bu süre 0,4 / 1,2 sn olur, en çok 30 sn sürer.

**Notepad++**'ta (8.4.8 ve üzeri; standart kurulum ya da `doLocalConf.xml` ile taşınabilir kurulum):
- **Sekme menüsü:** sekmeye sağ tıklayınca bir **SamSync** klasörü çıkar. Klasörde aynı girdiler düz bir liste hâlinde durur; her bölümün ve her grubun arasında bir ayırıcı vardır.
- **Çalıştır menüsü:** aynı girdiler Çalıştır komutları olarak da eklenir.
- **Kısayollar:** `config.json` içindeki `notepadPlusPlusShortcuts` alanından gelir, örneğin `{ "wizard:last": "Ctrl+Alt+W" }`; bu aynı zamanda varsayılandır. `Ctrl+Alt+W`, etkin sekmedeki kaydedilmiş dosyayı pencere açmadan son ayarla gönderir. Girdi kimlikleri eskileriyle aynıdır: `all`, `wizard`, `wizard:last`, `restore`, `profile:<ad>`, `group:<ad>` ve makine kimlikleri. Kısayollar Ayarlar'dan da düzenlenebilir.
- **Dosyalarda ne değişir:** SamSync `shortcuts.xml` ve `tabContextMenu.xml` dosyalarını metin olarak düzenler ve yalnızca adı `[SamSync] …` olan girdilere dokunur. Ardından `shortcuts.xml` dosyasını `config.xml` içinde imzalar (`shortcutsXmlHMAC`; Notepad++ 8.9.6.2'den beri gerekli).
- **Notepad++ açıksa:** Notepad++ kapanırken bu dosyaları kendi belleğindeki hâliyle yeniden yazar, bu yüzden açıkken yapılan değişiklikler kaybolur. SamSync, Notepad++ kapandıktan sonra dosyaları yeniden yazar.
- **Çok uzun komutlar:** 260 karakteri (Notepad++ sınırı) aşan bir komut uyarıyla atlanır.

Eski aracın menüleri hâlâ duran bir makinede onları `legacy\Uninstall-ContextMenu.bat` ile kaldırın; yoksa iki menü birden görünür.

## Komut satırı

```bat
SamSync.exe "D:\Release\Data\settings.json" "D:\Release\Models"
SamSync.exe --to group:Lab-A,NAS "C:\...\Data"
SamSync.exe --to last --yes "C:\...\Data\settings.json"
SamSync.exe --quick "Release → Lab-A"
SamSync.exe --pack "D:\Paketler" --since "D:\Paketler\Data-20261020-1530.samsync-pack" "D:\Release\Data"
```

`--quick <ad>`, Gönder sayfasında kaydedilen bir **hızlı gönderimi** (bir ad altında kaynaklar, hedefler ve seçenekler) çalıştırır; aynı gönderimler tepsi menüsünde ve komut paletinde de durur, istenirse sistem geneli bir kısayol tuşu alır (örn. `Ctrl+Alt+1`; uygulama tepsideyken de çalışır). "Önce incele" ile kaydedilen bir hızlı gönderim inceleme açar.

| Argüman | Anlamı |
| --- | --- |
| yollar | Gönder listesine eklenir |
| `--to <kimlikler>` | virgülle ayrılmış makine kimlikleri, `group:<ad>`, `profile:<ad>`, `all` ya da `last` (son incelenen gönderimin hedefleri ve seçenekleri); incelemeyi açar |
| `--yes` | `--to` ile birlikte kullanılır: incelemeden hemen gönderir (menü girdileri bunu kullanır) |
| `--restore` | Yedekler sayfasını öğelerle açar |
| `--hidden` | tepside başlar (açılışta başlatma bunu kullanır) |
| `--remove-integrations` | Explorer menüsünü ve Notepad++ girdilerini kaldırıp çıkar (kaldırıcı bunu kullanır) |
| `--plan-only` | her öğenin her hedefte nereye gideceğini pencere açmadan yazar (eski `-PlanOnly`) |
| `--check-only` | her hedefte öğelerin aynı olup olmadığını pencere açmadan yazar (eski `-CheckOnly`) |
| `--pack <klasör>` | öğeleri pencere açmadan klasöre tek paket dosyası olarak yazar ve dosyanın yolunu basar (çıkış kodu 0 = yazıldı) |
| `--since <paket\|makine>` | `--pack` ile: yalnızca o önceki paketten beri değişenler, ya da o makinenin (kimlik ya da ad) manifestine göre orada olduğu gibi durmayanlar |

Kısayollar: `Ctrl+K` komut paleti, `Ctrl+/` bütün kısayollar, `Ctrl+,` Ayarlar, `Ctrl+1…9` sayfalar, `Ctrl+Enter` incele / gönder, `Ctrl` `+`/`−`/`0` arayüz ölçeği, `F12` geliştirici araçları.

### Pencere açmadan plan ve eşitlik denetimi

```bat
start /wait SamSync.exe --check-only --to all "D:\Release\Data"
echo %ERRORLEVEL%
SamSync.exe --plan-only --to profile:Lab-A-PCs "D:\Release\Data\settings.json" | more
```

İki kip de uygulamayla aynı ayarları ve yapılandırmayı kullanır; SamSync penceresi açıkken de çalışır. `--to` gönderimdeki gibidir: verilmezse bütün hedefler; `last` ve `profile:` kendi hedefe özel ayarlarını da getirir. Tablo standart çıktıya, makine bilgisi, uyarılar, hatalar ve özet standart hataya yazılır; böylece tablo tek başına yönlendirilebilir. Sütun adları ve durum değerleri ASCII'dir ve eski araçtakilerle aynıdır:

- `--plan-only` — her öğe ve hedef için bir satır: `Source`, `LocalRoot`, `LocalMachine`, `Target`, `Destination`, `Options` (`Backup`, `OnlyNewer`, `Mirror`). Hedeflerde hiçbir şey okunmaz.
- `--check-only` — her hedef için bir satır: `Target`, `TargetId`, `State`, `Changes`, `Missing`, `DestNewer`, `Extras`. Hiçbir şey yazılmaz. `State` şunlardan biridir:
  - `Ayni` — aynı;
  - `Farkli` — farklı;
  - `Yok` — öğelerin hiçbiri hedefte yok;
  - `Erisilemedi` — erişilemedi;
  - `Hata` — hedef okunurken hata oluştu.

  Hedefte yalnızca fazladan dosya olması onu farklı yapmaz.

Çıkış kodu: `0`, planın hesaplandığı ya da bütün hedeflerin aynı olduğu anlamına gelir. `1`; fark, eksik öğe, erişilemeyen hedef ya da hata (kaynak yok, hedef bilinmiyor, bu makine tanınmadı, yapılandırma okunamadı) demektir. Sonuç `root.log`'a da yazılır.

SamSync.exe bir Windows pencere programı olduğu için `cmd` onu kendiliğinden beklemez. `%ERRORLEVEL%` için `start /wait` kullanın ya da çıktıyı bir boruya verin (`| more`; PowerShell'de `| Out-String`); böylece kabuk bekler ve `$LASTEXITCODE` dolar.

## Otomatik güncelleme

Ayarlar → Güncellemeler (kaynak paylaşılan yapılandırmada durur):

| Kaynak | Kullanım |
| --- | --- |
| GitHub | Sürüm GitHub Releases'tan gelir (aşağıdaki iş akışı ya da `npm run release:github`, `GH_TOKEN` gerekir). |
| Web adresi | `latest.yml` ve kurulum dosyalarının durduğu herhangi bir HTTP(S) klasörü. |
| Ağ klasörü | İnternete çıkmayan makineler için: `npm run release:folder -- "\\sunucu\Dagitim\SamSync"`. Makineler `latest.yml`'i okuyup kurulumu SHA-512 ile doğrular ve sessizce kurar. |

Açılışta ve 6 saatte bir denetlenir, yeni sürüm arka planda indirilir; “Yeniden başlat ve kur” ile kurulur. Bu düğme uygulamanın kendi penceresini açar: sürüm, yayın tarihi ve notları, süren bir gönderim varsa uyarı (kurulum uygulamayı yeniden başlatır); **Daha sonra** ve **Şimdi kur ve yeniden başlat**. Sürüm numarası `package.json` içindeki `version` alanıdır. macOS'ta otomatik güncelleme imzalı paket gerektirir.

GitHub deposunun adı kodda yazılı değildir: `scripts/dist.mjs` derleme sırasında onu git uzak adresinden (CI'da `GITHUB_REPOSITORY`) okur, electron-builder pakete yazar.

## Sürüm yayınlama

`.github/workflows/release.yml`: `app/package.json` içindeki `version`'ı artırın, `v<sürüm>` etiketini atıp gönderin:

```bash
git tag v2.1.0
git push origin v2.1.0
```

İş akışı Windows, macOS ve Linux'ta test edip paketler ve hepsini bir GitHub Release'e yükler (`latest*.yml` güncelleme dosyalarıyla). Üç derleme de geçerse iş akışı `SHA256SUMS.txt` ekler, sürümü kendisi yayımlar ve kurulu uygulamalar güncellemeyi alır; biri başarısız olursa sürüm taslak kalır. `ci.yml` her PR'da üç işletim sisteminde tip denetimini, lint'i ve testleri, Windows ve Linux'ta uçtan uca testi çalıştırır.

**Web sitesi.** `pages.yml` proje sitesini README'lerden, SSS'den ve ekran görüntülerinden kurar (`npm run site`, `site/` klasörüne) ve GitHub Pages'e yayımlar. Bir kez açılır: Settings → Pages → Source *GitHub Actions*, sonra depo değişkeni `SAMSYNC_PAGES` = `true`.

## Veriler

| Yer | İçerik |
| --- | --- |
| `config.json` (seçilen dosya) | makineler, gruplar, profiller, senkron işleri ve zamanlamaları, kopyalama ve güncelleme ayarları |
| `%APPDATA%\SamSync\settings.json` | bu bilgisayara özel: tema, son seçimler, yapılandırma yolu, sabitlenen makine, **izlemeler**, tepsi/başlangıç |
| `…\secrets.json` | SFTP parolaları (işletim sisteminin şifreli deposuyla şifrelenmiş) |
| `…\history\` | çalıştırma geçmişi; `…\reports\` her çalıştırma için bir CSV rapor (`rapor-<zaman>-<kimlik>.csv`; son 300 rapor saklanır) |
| `…\syncdb\` | iki yönlü senkronun son durumu |
| `…\log\root.log` | günlük (5 MB'ta döner); `SAMSYNC_LOG` ile değiştirilebilir |
| `…\macs.json` | makineleri uyandırmak için öğrenilen MAC adresleri |
| `…\agent-update\` | öbür makineleri güncellemek için saklanan bu sürümün kurulumu |
| taşınabilir `SamSync.exe`'nin yanındaki `SamSync-data\` | taşınabilir biçimler için yukarıdakilerin hepsi |

**Açılışlar arasında korunanlar:** yukarıdaki dosyaların yanında pencere şunları hatırlar: açık sayfa, Gönder sekmeleri (kaynakları ve hedefleriyle), kaydedilmemiş bir senkron işi düzenlemesi ve Yedekler sayfasındaki öğe. Kaydedilmemiş ayarlar varken sayfadan çıkmak ya da uygulamayı kapatmak önce sorar.

## Geliştirme

```bash
npm install
npm run dev          # Electron, sıcak yenilemeli
npm test             # çekirdek testleri (gerçek dosya sistemi, git ve dosya izleme ile)
npm run typecheck
npm run lint         # ESLint: hatalar, hook kuralları, erişilebilirlik
npm run e2e          # derlenmiş uygulama Playwright ile: gönder, karşılaştır, geri al, ana sayfalarda axe-core taraması
npm run site         # proje sitesi ../site klasörüne
npm run winget -- <sürüm>   # yayımlanmış sürümün winget bildirimleri ../packaging/winget klasörüne
npm run demo -- .demo     # sahte hedef klasörleriyle demo ortamı + config (.demo/ git'e girmez)
npm run screenshots       # README ekran görüntüleri, demodan, iki dilde (docs/screenshots)
npm run web -- --user-data .demo/userdata   # çekirdek + arayüz tarayıcıda (http://localhost:5198)
npm run dist:win     # kurulum + taşınabilir exe + zip
```

`dist:win` ayrıca `resources/launcher/SamSyncSend.c` dosyasını (Explorer menüsünün başlattığı program) `vswhere` ile bulduğu Visual C++ derleyicisiyle derler; derleyici yoksa paket onsuz çıkar ve menüler doğrudan `SamSync.exe`'yi başlatır.

Katmanlar: `src/core` (Electron'dan bağımsız motor: yapılandırma, makine tanıma, aktarım katmanları, planlayıcı, yürütücü, git, senkron, otomasyon, yedekler), `src/main` (pencere, IPC, tepsi, komut satırı, Explorer ve Notepad++ entegrasyonu, güncelleyici), `src/preload`, `src/renderer` (React arayüzü), `src/shared` (ortak tipler, API sözleşmesi, menü girdileri ve `i18n`). `i18n` içinde Türkçe metin anahtardır; İngilizce, Almanca ve İspanyolcalar `i18n/en/*.ts`, `i18n/de/*.ts` ve `i18n/es/*.ts` dosyalarındadır. Bir metnin İngilizcesi, Almancası ya da İspanyolcası yoksa, yer tutucular farklıysa ya da `t()` dışında Türkçe metin kalmışsa `tests/i18n.test.ts` başarısız olur; `node scripts/add-en.cjs <bölüm> [en|de|es]` yeni girdi ekler.

## Lisans

Telif hakkı (C) 2026 Samet Kurumahmut

SamSync özgür yazılımdır: Özgür Yazılım Vakfı'nın yayımladığı [GNU Genel Kamu Lisansı sürüm 3](../LICENSE) koşulları altında dağıtabilir ve/veya değiştirebilirsiniz. Yararlı olması umuduyla, ancak **hiçbir garanti olmadan** dağıtılır; satılabilirlik ya da belirli bir amaca uygunluk garantisi de dahil değildir. Tam metin için [`LICENSE`](../LICENSE) dosyasına bakın.
