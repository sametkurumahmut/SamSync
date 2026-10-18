# SamePathCopy

[English](README.md)

Windows Explorer sağ tık menüsünden bir veya birden fazla dosya ya da klasörü seçilen bilgisayarlara kopyalar. Aynı hedefler Notepad++ sekme sağ tık menüsünde de kullanılabilir. Yapılandırılmış kök dizinler arasındaki göreli yolu korur; kaynak öğeleri silmez.

Örnek:

```text
C:\ActiveRelease\Data\EntityConfigurations\ModelHeavyIndustry\Ornek300LC.entity
```

Yerel node'un `localRoot` değeri `C:\ActiveRelease`, uzak node'un `networkRoot` değeri `Sim\Samet` ise `10.10.2.181` hedefinde şuraya kopyalanır:

```text
\\10.10.2.181\Sim\Samet\Data\EntityConfigurations\ModelHeavyIndustry\Ornek300LC.entity
```

Klasör seçildiğinde klasörün kendisi ve bütün içeriği aynı konuma kopyalanır.

## Sürüm takibi

Uygulamanın sürümü `config.json` dosyasındaki `version` alanında tutulur:

```json
{
  "version": "1.0.0",
  "menuTitle": "SamePathCopy"
}
```

Sürüm numarası `MAJOR.MINOR.PATCH` (SemVer) biçimindedir. Yeni paket paylaşılırken davranışı bozan değişikliklerde `MAJOR`, geriye uyumlu özelliklerde `MINOR`, hata düzeltmelerinde `PATCH` artırılmalıdır. Sürüm, kopyalama sonuç penceresinin başlığında ve yerel kök satırında görünür.

Sürüm değişiklikleri [CHANGELOG.md](CHANGELOG.md) dosyasında listelenir.

### Birden fazla kaynak kökü

Bir node birden fazla kaynak kökü tanımlayabilir. Kaynak hangi kökün altındaysa göreli yol o köke göre hesaplanır ve hedefte aynı `networkRoot` altına yazılır:

```json
{
  "id": "Root",
  "name": "Root - 10.10.2.82",
  "address": "10.10.2.82",
  "localRoots": [
    "C:\\E\\repo\\musteri\\proje",
    "C:\\E\\repo\\musteri\\simulatorexternaldata",
    "C:\\E\\repo\\musteri\\simcontents"
  ],
  "networkRoot": "proje",
  "enabled": true
}
```

Hedefin `networkRoot` değeri `Sim\ActiveRelease` ise:

```text
proje\Data\x.entity            -> \\10.10.1.11\Sim\ActiveRelease\Data\x.entity
simulatorexternaldata\ses\a.wav -> \\10.10.1.11\Sim\ActiveRelease\ses\a.wav
simcontents\model\b.fbx        -> \\10.10.1.11\Sim\ActiveRelease\model\b.fbx
```

Göreli yol doğrudan `networkRoot` altına yazıldığı için iki kökte aynı göreli yol varsa (`proje\Data\x` ve `simcontents\Data\x`) hedefte aynı dosyaya denk gelirler; kökleri buna göre seçin. Sonuç penceresi ve `-PlanOnly` çıktısı her öğe için hangi kökün eşleştiğini gösterir.

İç içe kökler tanımlanabilir; en uzun eşleşen kök kullanılır. Tek köklü eski yapılandırmalar `localRoot` alanıyla çalışmaya devam eder; iki alan birlikte verilirse `localRoot` ilk kök olur.

### Kökler dışındaki öğeler

Seçilen öğe yerel node'un köklerinden birinin içindeyse, o kökün altındaki göreli yol hedef `networkRoot` altında korunur.

Öğe köklerin hiçbirinin altında değilse tam yerel yol sürücü harfi bir klasöre dönüştürülerek korunur:

```text
C:\Fraps\README.HTM
→ \\10.10.2.181\Sim\Samet\C\Fraps\README.HTM
```

Bu sayede farklı sürücülerde aynı ada sahip yollar çakışmaz. UNC kaynakları `networkRoot\UNC\sunucu\paylaşım\...` altında saklanır.

### Arayüz

Sihirbaz ve kopyalama penceresi WPF ile yazılmıştır ([SamePathCopy.Ui.ps1](SamePathCopy.Ui.ps1) ortak temayı üretir). Renkler Windows ayarlarından okunur: açık/koyu tema `AppsUseLightTheme` değerine, vurgu rengi `DWM\AccentColor` değerine göre belirlenir (okunabilirlik için çok açık vurgu renkleri yerine varsayılan mavi kullanılır). Arayüz PowerShell'in STA kipini gerektirir; `powershell.exe` varsayılan olarak STA çalışır, kurulumun ürettiği komutlar da bu yüzden olduğu gibi çalışır.

### Sihirbaz

Menüde `Tümü`'nün hemen ardından gelen `Wizard` girdisi, göndermeden önce bir pencere açar: hangi bilgisayarlara gönderileceği listeden işaretlenir ve her bilgisayar için parametreler ayrı ayrı seçilir. Etiket `config.json` içindeki `wizardLabel` alanından değiştirilebilir.

Pencerede kaynak özeti ve yerel kök çipi üstte, hedef tablosu ortada (grup adıyla birlikte), canlı `N / M seçili` göstergesi tablonun sağ üstünde durur. Her onay kutusu kolonunun başlığının altında o kolonun tamamını çeviren **tek bir onay kutusu** vardır: basıldığında hepsi işaretlenir, hepsi işaretliyken basıldığında temizlenir. Kutu kolonun durumunu da gösterir: hepsi işaretliyse **onay işareti**, hiçbiri işaretli değilse **boş**, bir kısmı işaretliyse **tire** (`–`) — böylece "bu kolonda bazıları seçili" tek bakışta görülür. Durum pencere açılırken de saklanmış ayardan hesaplanır: kaydedilen seçimle açılan pencerede üstteki kutular satırlarla tutarlı gelir. Böylece `Gönder`, `Yedek al`, `Yalnızca yeni` ve `Ayna` kolonları ayrı ayrı topluca açılıp kapatılabilir; ne yaptıkları kutunun ipucunda yazar. Filtre uygulanmışsa yalnızca görünen satırlar hem sayıma hem toplu işleme girer. Parametre kolonları [SamePathCopy.Wizard.ps1](SamePathCopy.Wizard.ps1) içindeki tanım listesinden üretilir; yeni bir parametre eklemek için o listeye bir satır yazmak yeterlidir, kolon ve onay kutuları kendiliğinden oluşur. Kolon başlıklarında parametrenin ne yaptığını anlatan ipuçları vardır.

Hedef listesinin üstünde üç yardımcı vardır:

- **Filtre kutusu** — ada, gruba veya node kimliğine göre süzer. Süzme sırasında kolon başlığındaki toplu seçim ikonları yalnızca görünen satırlara uygulanır: `Unit2` yazıp `Gönder` kolonunu işaretlemek o gruba ait satırları seçer. Gizlenen satırların seçim durumu korunur.
- **Grup çipleri** — her grubun adının solunda tek bir onay kutusu; o gruptaki bütün bilgisayarları tek tıkla seçer veya bırakır. Kutu grubun durumunu da gösterir: hepsi seçiliyse onay işareti, hiçbiri seçili değilse boş, **bir kısmı seçiliyse tire** (`–`).
- **Erişim yoklaması** — pencere açılırken her hedefin SMB portuna (445) kısa bir TCP yoklaması yapılır; bilgisayar adının solundaki nokta yeşil (yanıt var) ya da kırmızı (yanıt yok) olur, ipucunda ayrıntısı yazar. `Erişimi sına` yoklamayı yeniler. Böylece kapalı bir eğitmen bilgisayarı yüzünden kopyalamanın zaman aşımını beklemek gerekmez.
- **`Hedefi incele`** — seçili hedeflerde `robocopy /L` çalıştırıp tabloya eklenen `Hedefte` kolonunu doldurur: `aynı` (yeşil), `N değişecek`, `hedefte yok`, `erişilemedi`. Hedefteki dosya kaynaktakinden **daha yeniyse** rozet uyarı rengine döner ve `!` ile başlar — kopyalama o dosyanın üzerine yazar; ipucunda döküm (hedefte olmayan / kaynak daha yeni / hedef daha yeni / boyutu farklı / fazladan) yazar. Hedefe hiçbir şey yazılmaz; erişilemeyen hedefler atlanır. Hangi **dosyaların** değişeceğini görmek için bilgisayar adına tıklayın (aşağıdaki *Makine başına dosya listesi*).
- **`Seç ⌄` menüsü** — seçim yardımcılarını tek düğmede toplar:
  - `Erişilebilirleri seç` — yalnızca yoklamaya yanıt veren hedefleri işaretler (görünen satırlarda).
  - `Son çalıştırmada hatalıları seç` — en son CSV raporunda hata alan hedefleri işaretler, diğerlerini bırakır; yarım kalan gönderim iki tıkla tamamlanır. Rapor yoksa ya da hata yoksa bunu söyler.
  - `Seçimi ters çevir` — görünen satırlarda seçimi tersine çevirir.

Başlık satırı seçimi tek satırda özetler: tek öğede tam yol ve türü, çok öğede ortak klasör ile sayı dökümü (`C:\...\Data içinden 9 öğe (6 dosya, 3 klasör)`), öğeler ayrı klasörlerden geliyorsa klasör sayısı. Ayrıntı, altındaki iki tıklanabilir çipte durur — böylece kalabalık seçimlerde satır uzayıp kesilmez:

- **`Kaynak: N öğe`** — açılan listede öğeler ait oldukları yerel köke göre gruplanır ve her öğe **hedefte oluşacak göreli yoluyla** yazılır (klasörler `\` ile biter, satır ipucunda tam yol görünür). Hiçbir kökün altında olmayan öğeler `Yerel kök dışında (sürücü adıyla kopyalanır)` başlığı altında toplanır. Liste en fazla 200 satır gösterir, kalanı `... ve N öğe daha` diye bildirir; `Yolları panoya kopyala` düğmesi seçimin tamamını panoya yazar.

  Sihirbazda bu liste düzenlenebilir: her satırın başındaki **onay kutusunun işareti kaldırılan öğe o kopyalamaya girmez** (çip `Kaynak: 7 / 9 öğe` der, başlık ve inceleme yalnızca kalanları sayar) ve **pencereye dosya/klasör bırakmak** öğeyi listeye ekler. Değişiklik yalnızca o çalıştırma içindir, kayıtlı ayarlara yazılmaz; bütün öğelerin işareti kaldırılırsa kopyalama başlatılmaz. İlk 200 satırın dışında kalan öğeler tek tek düşürülemez.
- **`Yerel kök: <yol>` / `N yerel kök`** — bir kök varsa yolu çipte görünür, birden fazla kök varsa yalnızca sayı yazar; açılan listede bütün kökler tam yolla ve her birinden kaç öğe seçildiğiyle (`3 öğe` / `seçimde yok`) durur. Yol artık çipin içinde yarıda kesilmiyor.

Aynı iki çip kopyalama penceresinin başlığında da vardır; geri alma penceresi de aynı özet satırını kullanır.

Üst satırdaki `Son gönderim` çipi, günlükteki en son kopyalama özetini gösterir (tarih, başarılı/hatalı sayıları, süre). Tıklanınca **son 10 çalıştırma** CSV raporlarından listelenir: her satırda tarih, hedef sayısı, başarılı/hatalı/iptal dökümü ve kaynak görünür. `Hedefleri seç` o çalıştırmanın hedef kümesini tabloya uygular (o hedefler seçilir, diğerleri bırakılır) — "geçen seferkinin aynısına gönder" iki tıktır; `Raporu aç` CSV'yi varsayılan uygulamayla açar. Liste her açılışta yeniden okunur.

Bilgisayar başına parametreler:

| Parametre | Ne yapar |
| --- | --- |
| `Yedek al` | Hedefte aynı yolda hâlihazırda duran dosya/klasörü, kopyalamadan önce `<networkRoot>\_SamePathCopyYedek\<tarih-saat>\<göreli yol>` altına kopyalar. Hedefte önceki hâli yoksa atlanır. Yedek başarısız olursa o öğe kopyalanmaz. |
| `Yalnızca yeni` | Hedefteki dosya kaynaktan yeni ya da aynı yaştaysa dokunmaz (`robocopy /XO`). |
| `Ayna (fazlayı sil)` | Hedefi kaynağın aynası yapar; kaynakta olmayan dosyalar hedefte silinir (`robocopy /MIR`). Yalnızca klasör kopyalamada uygulanır ve başlatmadan önce ayrıca onay ister. |

Bütün hedefler için geçerli parametreler:

| Parametre | Ne yapar |
| --- | --- |
| `Bitince bildirim göster` | Kopyalama bitince görev çubuğunda bildirim balonu gösterir (varsayılan açık). Pencere arkada kalsa da sonuç görülür. |
| `Deneme çalıştırması` | Ne kopyalanacağını hesaplar, hiçbir şey yazmaz (`robocopy /L`). Yedek adımı da atlanır. |
| `Hızlı kopyalama` | Çok iş parçacıklı kopyalama (`robocopy /MT:8`). Yeniden başlatılabilir kip (`/Z`) bu durumda kullanılmaz. |
| `Hariç dosyalar` | Noktalı virgülle ayrılmış dosya kalıpları kopyalanmaz (`robocopy /XF`). Örnek: `*.pdb;*.tmp;desktop.ini` |
| `Hariç klasörler` | Noktalı virgülle ayrılmış klasör adları kopyalanmaz (`robocopy /XD`). Örnek: `.git;Logs;Temp`. Yedek klasörü zaten hep hariç tutulur. |
| `Eşzamanlı hedef` | Aynı anda kaç bilgisayara kopyalandığı (varsayılan `4`, `1` = sırayla, en fazla `16`). Aynı hedefe iki robocopy birden gönderilmez; bir hedefin planları kendi içinde sıralı kalır, böylece `Ayna` gibi yıkıcı parametreler güvenli çalışır. |
| `Paket arası bekleme (ms)` | Ağı boğmamak için paketler arasına bekleme koyar (`robocopy /IPG:n`). `0` = sınırsız hız. |
| `Yeniden deneme sayısı` | `robocopy /R:n`. Boş bırakılırsa `config.json` içindeki `copy.retryCount` kullanılır. |
| `Denemeler arası bekleme (sn)` | `robocopy /W:n`. Boş bırakılırsa `config.json` içindeki `copy.waitSeconds` kullanılır. |

İlk açılışta bütün bilgisayarlar işaretli, parametreler kapalı gelir. Seçimler `%LOCALAPPDATA%\SamePathCopy\wizard-state.json` içinde config dosyası yoluna göre saklanır; pencere bir sonraki açılışta son hâliyle gelir. Vazgeçilse bile tablodaki son durum saklanır. `config.json`'a sonradan eklenen bilgisayar işaretli gelir, silinen bilgisayar durumdan düşer. `SAMEPATHCOPY_WIZARD_STATE` ortam değişkeni durum dosyasının yolunu değiştirir.

Yedek klasörü hedefin `networkRoot` değeri altında durur ve klasör kopyalamalarında kopyalama dışında bırakılır (`robocopy /XD`), böylece yedekler kendi kendini çoğaltmaz.

Yedekler hedef paylaşımda sınırsız birikmesin diye her başarılı yedekten sonra eski tarih klasörleri silinir; kaç tanesinin tutulacağı `config.json` içindeki `copy.backupKeep` alanından belirlenir (varsayılan `5`, `0` = sınırsız). Yalnızca `yyyyMMdd-HHmmss` biçimindeki klasörler temizlenir; elle oluşturulmuş klasörlere dokunulmaz. Silinen yedekler sonuç panelinde ve günlükte görünür.

#### Makine başına dosya listesi

Tablodaki **bilgisayar adına tıklamak**, o satırın altında büyük bir kart açar: kopyalama o makinede tam olarak neyi yapacak, dosya dosya. Adın solundaki `›` işareti açıldığında `⌄` olur; tekrar tıklamak kartı kapatır. Her satırda git'i andıran bir işaret, öğeye göre göreli yol, durum metni ve boyut vardır:

| İşaret | Durum | Ne anlama gelir |
| --- | --- | --- |
| `+` (yeşil) | `yeni` / `yeni klasör` | Hedefte yok; ilk kez kopyalanacak. |
| `~` (vurgu rengi) | `güncellenecek` / `boyutu farklı` | Hedefteki dosyanın üzerine yazılacak. |
| `!` (uyarı rengi) | `hedef daha yeni` | Hedefteki dosya kaynaktan **daha yeni**; kopyalama onu eski hâline döndürür. |
| `-` (kırmızı / soluk) | `silinecek` / `hedefte fazla` | Kaynakta yok, hedefte var. Yalnızca `Ayna` açıkken silinir; kapalıysa olduğu gibi kalır. |

Liste ilk açılışta `robocopy /L` ile hesaplanır — hedefe hiçbir şey yazılmaz — ve sonraki açılışlarda önbellekten gelir. Hesaplama sırasında `hesaplanıyor...` yazar ve pencere yanıt vermeye devam eder. Erişim yoklamasına yanıt vermeyen hedefte robocopy'nin ağ zaman aşımı beklenmez, kart bunu söyler. Kalabalık listeler 400 satırda kesilir; kalan sayı satır olarak bildirilir. Birden çok kaynak öğe seçildiyse satırlar öğe başlıkları altında gruplanır. Kart açıldığında o satırın `Hedefte` rozeti de dolar: aynı sayılardan `Hedefi incele` düğmesinin yazdığı rozetin aynısı üretilir.

Satırların hepsi işaretli gelir. **Bir satırın işaretini kaldırmak o öğeyi yalnızca o makinede** kopyalamadan düşürür; öbür hedefler etkilenmez. Yol robocopy'ye tam yolla geçer: dosyalar `/XF`, klasörler `/XD`. Hedefteki fazlalığın işaretini kaldırmak onu `/XF` listesine koyar, yani `Ayna` açık olsa bile o dosya silinmez. Bir klasörün işareti kaldırılınca altındaki satırların kutuları kapanır, çünkü onlar da kopyalanmaz. Düşürülen yollar tek bir robocopy komut satırına sığmak zorunda olduğundan hedef başına toplam uzunluk sınırı vardır; sınıra gelindiğinde neden eklenmediği söylenir (bu durumda tek tek dosya yerine üst klasörü düşürün ya da `Hariç dosyalar` kalıbını kullanın). Düşürme yalnızca o çalıştırma için geçerlidir, `wizard-state.json` içine yazılmaz.

Kartın sağ üstündeki düğmeler: `Yenile` listeyi yeniden hesaplar, `Düşürülenleri geri al` o makinede düşürülen bütün öğeleri geri getirir, `Karşılaştır ⇄` aşağıdaki pencereyi açar. Kaynak listesi değişirse (çipten öğe düşürülür ya da pencereye dosya bırakılır) veya o satırın `Ayna` / `Yalnızca yeni` parametresi elle değiştirilirse açık kart eski listeyi göstermek yerine `Yenile ile güncelleyin` der.

#### Karşılaştırma penceresi

Ayrıntı kartındaki `Karşılaştır ⇄` düğmesi (ya da bir dosya satırının kendi `⇄` düğmesi) ayrı bir pencere açar: solda o makinede etkilenecek öğelerin listesi, sağda seçilen dosyanın **kaynak ile hedef arasındaki satır satır farkı**. Eklenecek satırlar yeşil `+`, hedeften kalkacak satırlar kırmızı `-` ile işaretlenir; iki taraf için ayrı satır numaraları yazılır. Üstte iki dosyanın boyutu, tarihi ve hedef yolu durur. Satır farkı LCS ile hesaplanır: ortak baş ve son kırpılır, uzun değişmeyen bloklar `... N satır aynı` satırına iner, böylece on binlerce satırlık bir dosyada yalnızca değişikliğin çevresi görünür. İkili (NUL baytı taşıyan), çok büyük (2 MB üstü), hedefte olmayan ya da okunamayan dosyalarda satır farkı yerine nedeni yazılır — boyut ve tarih karşılaştırması yine görünür. Pencere yalnızca okuma yapar; `Listeyi panoya kopyala` bütün satırları işaretleriyle panoya alır. Karşılaştırma katmanı [SamePathCopy.Diff.ps1](SamePathCopy.Diff.ps1) içindedir.

#### Profiller

Sihirbazın sağ üstündeki **Profil** kutusu, adlandırılmış seçim kümeleri tutar: hedef seçimi ve bütün parametreler bir adla saklanır. `Profili kaydet` mevcut tabloyu kaydeder, listeden bir profil seçmek onu tabloya uygular, `Sil` kaldırır. Profil adı harf, rakam, nokta, alt çizgi ve tire içerebilir (menü komutlarında hedef kimliği olarak kullanıldığı için boşluk yoktur).

Her profil menüde `<ad> (profil)` girdisi olarak görünür ve komutlara `-TargetId profile:<ad>` biçiminde geçer; yani bir profile klavye kısayolu da bağlanabilir:

```json
"notepadPlusPlusShortcuts": {
    "profile:Unit1IG": "Ctrl+Alt+1",
    "profile:Egitmenler": "Ctrl+Alt+2"
}
```

Profil eklendikten veya silindikten sonra menü girdilerinin güncellenmesi için kurulumu (`Install-ContextMenu.bat`) yeniden çalıştırın. Profiller `wizard-state.json` içinde, son kullanılan ayarla aynı dosyada ama ondan bağımsız durur: ayar kaydetmek profilleri değiştirmez.

#### Son ayarla gönderme

`Wizard` girdisinin hemen ardından gelen `Wizard (son ayar)` girdisi pencereyi hiç açmaz: sihirbazda en son kaydedilen hedef seçimini ve parametreleri olduğu gibi uygulayıp kopyalamayı başlatır. Komutlara `-TargetId wizard:last` olarak geçer, etiketi `config.json` içindeki `wizardLastLabel` alanından değiştirilebilir.

Bu girdi özellikle klavye kısayolu için düşünülmüştür: hedefler bir kez sihirbazdan seçilir, sonrasında Notepad++ içinde tek tuşla aynı hedeflere gönderilir. Kopyalama penceresi bu durumda `Son sihirbaz ayarı` etiketiyle açılır. Henüz sihirbaz kullanılmamışsa varsayılan geçerlidir (bütün hedefler, parametreler kapalı). Son ayarda hiçbir hedef seçili değilse kopyalama yapılmaz ve sihirbazı açıp seçim yapılması istenir.

### Günlük

Bütün betikler araç klasörünün altındaki `log\root.log` dosyasına yazar. Klasör yazılamıyorsa (salt okunur paylaşımdan çalıştırma) sırayla `%LOCALAPPDATA%\SamePathCopy\log\root.log` ve `%TEMP%\SamePathCopy\log\root.log` denenir. `SAMEPATHCOPY_LOG` ortam değişkeni dosyanın yolunu doğrudan belirler. Günlük yazımı hiçbir koşulda kopyalamayı durdurmaz; yazılamazsa sessizce atlanır.

Satır biçimi:

```text
2026-08-20 16:22:44.473 [INFO ] [41a4729c] [Panel] Demo hedefi 1  [yedek] → başarılı
```

Sırasıyla zaman damgası, seviye (`INFO` / `WARN` / `ERROR`), çalıştırma kimliği ve bileşen adı yer alır. Çalıştırma kimliği her süreç için üretilir; aynı dosyaya birden fazla kopyalama paralel yazdığında satırlar bu kimlikle ayrılır. Bileşenler: `Kopyala`, `Panel`, `Sihirbaz`, `Plan`, `Kuyruk`, `Kurulum`, `Kaldırma`, `Notepad++`.

**Kopyalama panelinde görünen her satır günlüğe de yazılır**: hedef başına kaynak → hedef satırı, etkin parametreler, yedek yolu, `başarılı` / `hatalı` / `atlandı` durumu, robocopy hata kodu ve hata ayrıntıları, en sonda özet. Bunların yanında oturum başlığı (sürüm, kullanıcı, süreç kimliği), yerel node ve kökler, çözülen hedefler, sihirbazdan gelen seçim ve parametreler, hesaplanan plan, kuyruk birleştirme ve kurulum/kaldırma işlemleri de kaydedilir. `Günlüğü kopyala` düğmesinin ipucunda günlük dosyasının yolu yazar.

Her kopyalama çalıştırması ayrıca `log\reports\rapor-<tarih-saat>.csv` dosyasına yazılır: zaman, hedef, kaynak, hedef yolu, etkin parametreler, sonuç (`başarılı` / `hatalı` / `iptal`), robocopy kodu, süre ve hata notu. Kopyalama penceresindeki `Raporu aç` düğmesi bu dosyayı açar. Dosya noktalı virgül ayırıcıyla yazıldığı için Excel'de doğrudan açılır.

`root.log` 5 MB'ı geçtiğinde `root.1.log`, `root.2.log`, `root.3.log` olarak kaydırılır; en eskisi silinir. Günlük klasörü sürüm denetimine girmez.

### Yedekten geri alma

Menüdeki `Yedekten geri al` girdisi (`-TargetId restore`, etiket `config.json` içindeki `restoreLabel` alanından değişir), seçilen öğenin hedeflerdeki eski hâlini geri yazar. Explorer'da bir klasöre sağ tıklayıp bu girdiyi seçmek, o klasörün yedeklerini arar.

Pencerede yalnızca o öğe için yedeği bulunan bilgisayarlar listelenir; her satırda o hedefteki yedek tarihleri açılır listede durur (en yeni önce seçili). `Geri almadan önce hedefin şu anki hâlini yedekle` seçeneği varsayılan olarak açıktır, yani geri alma da geri alınabilir. Geri alma yedekteki dosyaları hedefe yazar; hedefte olup yedekte olmayan dosyalar silinmez (ayna kullanılmaz).

Seçilen öğe için hiçbir hedefte yedek yoksa işlem başlamaz ve bunu söyleyen bir hata verilir. Yedekler kopyalama sırasında `Yedek al` parametresi seçiliyken oluşur.

### Kopyalama sonrası komut

`config.json` içindeki `copy.postCommand` doluysa, bir hedefe kopyalama başarıyla bittikten sonra o komut **bir kez** çalıştırılır (deneme çalıştırmasında çalışmaz). Örnek: dağıtımdan sonra karşı taraftaki simülatörü yeniden başlatan bir görevi tetiklemek.

```json
"copy": {
    "retryCount": 2,
    "waitSeconds": 1,
    "backupKeep": 5,
    "postCommand": "schtasks /run /s {address} /tn \\"Sim Yeniden Baslat\\"",
    "postCommandTimeoutSeconds": 60
}
```

Kullanılabilir yer tutucular: `{address}`, `{targetId}`, `{targetName}`, `{networkRoot}`, `{destination}`, `{source}`. Komut `cmd /c` ile çalışır, penceresi görünmez; çıkışı ve hata akışı günlüğe yazılır, sonuç panelde satır olarak görünür. `postCommandTimeoutSeconds` (varsayılan 60, en fazla 3600) süresinde bitmezse süreç durdurulur ve hata olarak kaydedilir. Komut yalnızca `config.json` üzerinden tanımlanır; arayüzden serbest komut girilemez.

### Kopyalama öncesi denetimler

Kopyalama penceresi açıldıktan sonra, işlem başlamadan önce iki denetim yapılır:

- **Ayna önizlemesi** — `Ayna` seçili her hedef için `robocopy /L /MIR` çalıştırılıp hedefte silinecek öğeler listelenir. Panelde hedef başına "N fazla öğe silinecek, M öğe güncellenecek" satırı ve ilk beş dosyanın yolu görünür; ardından toplam silme sayısını söyleyen bir onay istenir. Onay verilmezse hiçbir şey kopyalanmaz. Bütün liste günlüğe de yazılır.
- **Disk alanı** — hedef paylaşımdaki boş alan kaynak boyutundan küçükse uyarı satırı eklenir (kopyalama engellenmez, çünkü hedefte üzerine yazılacak dosyalar da yer açar). Boş alan okunamayan paylaşımlar sessizce atlanır.

`Deneme çalıştırması` seçiliyken her hedef için ne değişeceği de listelenir: "N öğe kopyalanacaktı, M öğe hedefte fazla" ve ilk beş yol.

### Gruplar

Node'lara `group` alanı verilerek makineler kümelenir. Menüde her grup için, o gruptaki bütün makinelere gönderen tek bir girdi oluşur:

```json
{
  "id": "Unit1IG1",
  "group": "Unit1",
  "name": "IG1 - 10.10.2.11",
  "address": "10.10.1.11",
  "localRoot": "C:\\Sim\\ActiveRelease",
  "networkRoot": "Sim\\ActiveRelease",
  "enabled": true
}
```

### Kaç dosya seçilebilir (100 öğe sınırı)

Windows, komut satırıyla çalışan bir sağ tık fiilini **seçili öğe sayısına** göre gizler. Sınır fiilin seçim modeline (`MultiSelectModel`) bağlıdır ve [Microsoft belgesinde](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-employ-the-verb-selection-model) tabloyla verilir:

| Seçim modeli | Komut satırı fiili | COM fiili |
| --- | --- | --- |
| `Document` (her öğe için ayrı pencere açan fiiller) | 15 öğe | 15 öğe |
| `Player` (her sayıda öğeyi kabul eden fiiller) | **100 öğe** | sınırsız |

Kurulum bu yüzden bütün girdileri `Player` modeliyle yazar: **16 dosya/klasör seçildiğinde menü girdisi kayboluyordu** (15'te görünüyordu), artık 100 öğeye kadar görünür. 101 ve üstünde Windows girdiyi yine gizler; o durumda öğelerin bulunduğu **klasörü** seçip gönderin (klasör kopyalaması alt ağacın tamamını götürür) ya da seçimi ikiye bölün.

Explorer, fiili seçilen her öğe için **bir kez** çalıştırır — 40 dosya seçmek 40 PowerShell süreci başlatır. [Queue-SamePathCopy.ps1](Queue-SamePathCopy.ps1) bu çağrıları hedef + config başına bir kuyrukta toplar: ilk süreç toplayıcı olur, ötekiler isteklerini bırakıp çıkar, sonunda **tek bir kopyalama penceresi** açılır ve bütün seçim tek robocopy planına girer. Toplayıcı yeni istek gelmeyi bırakana kadar bekler (tek dosyada 0,4 sn, çok seçimde 1,2 sn sessizlik; en fazla 30 sn), böylece geç açılan süreçler de aynı çalıştırmaya girer. Kabuğun bütün seçimi tek komut satırına dizdiği durum da desteklenir: fazladan gelen yollar kaynak listesine katılır.

### Explorer menüsünün 16 öğe sınırı

> Bu bölümdeki 16, **menüye kaç girdi sığdığı** ile ilgilidir; yukarıdaki 100 ise **kaç dosya seçilebildiği**. İkisi farklı sınırlardır.


Windows'un klasik basamaklı sağ tık menüsü **bütün ağaçta en fazla 16 öğe** gösterir; fazlasını uyarı vermeden gizler. Alt menüye taşımak bu bütçeyi artırmaz: gözlemlenen iki durum, düz listede 19 girdiden 16'sının, alt menülü ağaçta ise `4 toplu + (1 grup + 5 girdi) + (1 grup + 5 girdi) = 16` öğenin göründüğü ve sonrasının düştüğüdür. Ayırıcı çizgiler bu bütçeden yer yemez.

Kurulum bu yüzden bütçeyi kimin harcayacağına önceden karar verir. Öncelik sırası:

1. **Toplu girdiler** (`Tümü`, sihirbaz girdileri, `Yedekten geri al`, profiller) — her zaman.
2. **Bütün grup girdileri** — her zaman: hiçbir grup menüden düşmez, grup girdisine tıklamak o grubun tamamına gönderir.
3. **Gruba ait olmayan makineler** — düşerlerse menüden hiç erişilemezler (arkalarında bir grup girdisi yok), bu yüzden grup açmadan önce yer bulurlar.
4. **Bu makinenin kendi grubunun makineleri** — alt menüde tek tek açılır. En çok kendi setindeki makinelere gönderildiği için bütçede öncelik onların.
5. **Kalan grupların makineleri** — hepsi sığıyorsa açılır, sığmıyorsa hiçbiri. Yarısını açmak "neden Unit1 açık da Unit3 kapalı" sorusunu doğuracağı için simetri korunur.

Bir grubu açmanın bedeli grubun kendi `<grup> - Tümü` girdisi + üye sayısıdır; grup girdisinin kendisi zaten sayılmıştır.

Örnek — bu makine `Unit2` setindeki eğitmen istasyonuysa (3 set × 4 makine + 1 gruba ait olmayan makine):

```text
Tümü                        (ikonlu)
Wizard                      (ikonlu)
Wizard (son ayar)           (ikonlu)
Yedekten geri al            (ikonlu)
Unit1                  → tıklamak Unit1'in tamamına gönderir
Unit2 ▸                → Unit2 - Tümü, IG1, IG2, IG3
Unit3                  → tıklamak Unit3'ün tamamına gönderir
Root                        (gruba ait olmayan makine)
```

12 öğe: kendi setindeki makinelere tek tıkla gönderilir, öbür setler grup girdisiyle erişilebilir kalır. Geliştirme makinesi gibi **gruba ait olmayan** bir makinede açılacak kendi grup yoktur; o durumda bütün gruplar grup girdisi olarak kalır (7 öğe).

`config.json` içindeki `menuShowNodes` alanı bu davranışı değiştirir:

| Değer | Davranış |
| --- | --- |
| `auto` (varsayılan) | Yukarıdaki öncelik sırası uygulanır. Kurulum hangi grupların açıldığını ve hangilerinin grup girdisi olarak kaldığını yazar. |
| `always` | Bütün grupların makineleri konur; sınır aşılıyorsa uyarı verilir (Windows fazlasını gizler). |
| `never` | Hiçbir makine girdisi konmaz, yalnızca toplu girdiler ve gruplar görünür. |

Grup tanımlı değilse tek makineler menüdeki tek hedef olduğu için bütçeye ve bu ayara bakılmaksızın konur.

Bu bütçe yalnızca **Explorer** menüsü içindir. Notepad++ sekme menüsünde öğe sınırı yoktur; orada bütün makineler her zaman listelenir.

Sığan bir yapılandırmada menü şöyle görünür (gruplar alt menüde, bölümler ayırıcıyla ayrılmış):

```text
Tümü                        (ikonlu)
────────────────────────────────────
Wizard                      (ikonlu)
Wizard (son ayar)           (ikonlu)
────────────────────────────────────
Yedekten geri al            (ikonlu)
────────────────────────────────────
Unit1              ▸   (ikonlu)   →   Unit1 - Tümü   (ikonlu)
Unit2              ▸   (ikonlu)       Eğitmen - 10.10.1.10
────────────────────────────────────       IG1 - 10.10.1.11
Arşiv sunucusu                             IG2 - 10.10.1.12
```

12 makineli üç setli yapılandırmada bütün makineler sığmaz (`4 + 3 + 12 = 19`): menü kendi grubunun makinelerini açar, öbür iki grup girdi olarak kalır (yukarıdaki örnek, 12 öğe). Gruba ait olmayan bir makinede kurulduysa açılacak kendi grup olmadığı için menü yalnızca toplu girdilerle ve üç grup girdisiyle (7 öğe) kurulur. Kapalı bir gruptaki tek bir makineye göndermek için sihirbaz kullanılır (filtre + onay kutuları) ya da o makine için bir profil kaydedilir.

Ayırıcılar bölüm değiştiğinde konur (`CommandFlags = 0x20`): `Tümü`, sihirbaz girdileri, geri alma, profiller, gruplar ve tek makineler arasında. İkon yalnızca toplu girdilerde durur; tek makine girdileri ikonsuzdur.

Notepad++ sekme menüsünde böyle bir sınır olmadığı için orada liste düzdür ve bütün makineler görünür: grup girdileri kendi makinelerinin başında durur. Bölümler orada da ayırıcıyla ayrılır — `tabContextMenu.xml` içine `<Item FolderName="SamePathCopy" id="0" />` girdileri yazılır (`id="0"` Notepad++'ta ayırıcı anlamına gelir):

```text
Tümü
────────────────
Wizard
Wizard (son ayar)
────────────────
Yedekten geri al
────────────────
Unit1
  Eğitmen - 10.10.1.10
  IG1 - 10.10.1.11
  IG2 - 10.10.1.12
  IG3 - 10.10.1.13
────────────────
Unit2
  Eğitmen - 10.10.1.30
  ...
```

Sekme menüsü düz listelendiği için **her grubun önüne de ayırıcı** konur; grubun kendi girdisi ile o gruba ait makineler aynı bölümde kalır (Explorer'da buna gerek yok, çünkü gruplar orada ayrı alt menülerde).

Kaldırma bu ayırıcıları da temizler: yönetilen girdiler silinirken bulundukları klasör adı toplanır ve o klasördeki `id="0"` girdileri de kaldırılır.

Grup girdileri komutlara `-TargetId group:Unit1` biçiminde geçer; `Queue-SamePathCopy.ps1` ve `Copy-SamePath.ps1` bu kimliği doğrudan kabul eder. Yerel bilgisayar kendi grubunun girdisinden de çıkarıldığı için, Unit1 eğitmeninde `Unit1` seçmek yalnızca o setin IG'lerine gönderir. Grubun bu bilgisayar dışında etkin üyesi kalmazsa grup girdisi menüde hiç oluşmaz.

Klavye kısayolu da atanabilir; `notepadPlusPlusShortcuts` anahtarı grup kimliğini kabul eder:

```json
"notepadPlusPlusShortcuts": {
    "wizard:last": "Ctrl+Alt+W",
    "group:Unit1": "Ctrl+Alt+1"
}
```

### Birden fazla dosya ve klasör

Explorer'da birden fazla dosya, birden fazla klasör veya karışık dosya/klasör seçimi yapılabilir. Seçimler kısa bir kuyrukta birleştirilir ve tek sonuç penceresinde bütün kaynak-hedef kopyalamaları gösterilir.

Windows'un seçim modeli sınırı yüzünden en fazla **100 öğelik** seçim desteklenir; daha fazlasında Windows menü girdisini gizler. Ayrıntı ve nedeni için [Kaç dosya seçilebilir (100 öğe sınırı)](#kaç-dosya-seçilebilir-100-öğe-sınırı) bölümüne bakın.

## Tek yapılandırmayı bütün bilgisayarlarda kullanma

Aynı `config.json` eğitmen ve bütün IG bilgisayarlarında **hiç değiştirilmeden** kullanılır. Eğitmen dahil her bilgisayar `nodes` listesinde bulunur ve kendi yerel/paylaşım köklerine sahiptir. Araç çalıştığı bilgisayarı, en belirleyici ölçütten başlayarak otomatik tanır:

1. `SAMEPATHCOPY_NODE_ID` ortam değişkeni (ya da `Get-LocalSamePathCopyIdentity -NodeId`) verilmişse doğrudan o node kullanılır.
2. `address` alanının yerel IP adreslerinden biriyle eşleşmesi.
3. `address` veya isteğe bağlı `localNames` değerlerinden birinin Windows bilgisayar adıyla eşleşmesi.
4. Bir kademede birden fazla node eşleşirse, `localRoot` dizini bu bilgisayarda var olan tek node seçilir.

IP eşleşmesi ada göre eşleşmeyi ezdiği için, bilgisayar adları benzersiz olmasa bile (örneğin bütün makinelerin adı `MSI` olsa bile) her bilgisayar kendi node'unu bulur. Ada göre birden fazla eşleşme kalan durumda ayrımı `localRoot` yapar: eğitmen kökü `D:\Sim\ActiveRelease`, geliştirme makinesinin kökü `C:\E\repo\musteri\proje` ise yalnızca gerçekten var olan kökün node'u seçilir.

Hiçbir kademe tek bir node'a inemezse araç kopyalama yapmaz ve hangi node'ların eşleştiğini söyler. Bu durumda ya bu bilgisayarın adresi/adı tek bir node'da bırakılır, ya `localRoot` değerleri ayrıştırılır, ya da yalnızca o bilgisayarda `setx SAMEPATHCOPY_NODE_ID Unit1Trainer` gibi bir ortam değişkeniyle kimlik sabitlenir; config dosyası ortak kalır.

Eşleşen node'un `localRoot` değeri kaynak kökü olarak kullanılır ve o node kendi hedef listesinden çıkarılır. Uzak node'a gönderimde `\\address\networkRoot` kullanılır.

Örnek olarak IG-12 üzerinde çalışırken:

```json
{
  "id": "sim-12",
  "address": "10.10.2.12",
  "localNames": ["IG-12"],
  "localRoot": "E:\\Samet",
  "networkRoot": "Sim\\Samet"
}
```

Araç bu bilgisayarda `E:\Samet` dizinini göreli yol hesabının yerel kökü olarak kullanır. Kaynaklar bu kökün dışında da seçilebilir; bu durumda sürücü harfi dahil tam yol hedef altında korunur. Başka bilgisayarlar bu node'a `\\10.10.2.12\Sim\Samet` üzerinden gönderir.

Eğitmen bilgisayar da aynı `nodes` listesinde olduğu için IG bilgisayarlarından eğitmene doğrudan dosya gönderilebilir.

Dosyanın fiziksel olarak da tek kopya olması istenirse `config.json` ortak bir salt-okunur ağ paylaşımına konabilir ve her bilgisayarda kurulum şu şekilde yapılabilir:

```bat
Install-ContextMenu.bat -ConfigPath "\\dosya-sunucusu\ProjeConfig\config.json"
```

Kurulum, bu merkezi config yolunu sağ tık komutlarına kaydeder. Bilgisayarların paylaşımı okuyabilmesi gerekir. Menü yapısını etkileyen `menuTitle`, `allLabel`, node ekleme/silme, `name`, `id` veya `enabled` değişikliklerinden sonra kurulum tekrar çalıştırılmalıdır. Yerel node tespitini değiştirebileceği için `address` veya `localNames` değişikliklerinden sonra da kurulumu yenilemek en güvenli yöntemdir. `localRoot`, `networkRoot`, `version` ve `copy` ayarları her işlem başında config dosyasından yeniden okunur ve tek başlarına menünün yeniden kurulmasını gerektirmez.

## Ön koşullar

- Windows PowerShell 5.1 ve Windows Explorer kullanılmalıdır.
- Notepad++ sekme menüsü bütünleşmesi için Notepad++ 8.4.8 veya üzeri gerekir. Notepad++ zorunlu değildir; bulunmazsa bu adım atlanır.
- Hedef bilgisayarlarda `networkRoot` değerinin ilk parçasıyla aynı adda SMB paylaşımı bulunmalı. `Sim\Samet` için `Sim` paylaşımı gerekir.
- İşlemi yapan Windows kullanıcısının hedef paylaşımına yazma yetkisi olmalı.
- Güvenlik duvarında Windows Dosya ve Yazıcı Paylaşımı açık olmalı.
- Her node'un yerel klasörü `localRoot`, ağdan erişilen paylaşım yolu `networkRoot` ile ayrı ayrı tanımlanır.

Etki alanı dışındaki bilgisayarlarda kimlik bilgisini Windows Credential Manager'a bir kez kaydetmek gerekebilir:

```powershell
cmdkey /add:10.10.2.11 /user:HEDEF-BILGISAYAR\Kullanici /pass
```

Komut parolayı etkileşimli ister; parolayı `config.json` içine yazmayın.

## Node'ları ayarlama

`config.json` kendi makine listenizi içerdiği için depoda yok. Betiklerin yanındaki [`config.example.json`](config.example.json) dosyasını `config.json` adıyla kopyalayıp düzenleyin; git `config.json` dosyasını yok sayar.

`config.json` içindeki `nodes` dizisine eğitmen dahil bütün bilgisayarları ekleyin:

```json
{
  "id": "sim-14",
  "name": "Operatör Kabini 14 (10.10.2.14)",
  "address": "10.10.2.14",
  "localNames": ["IG-14"],
  "localRoot": "E:\\GuncelSurum",
  "networkRoot": "Sim\\GuncelSurum",
  "enabled": true
}
```

- `id`: Menü komutunun kalıcı anahtarıdır. `Trainer`, `IG1`, `IG2` gibi büyük veya küçük İngilizce harfler, rakam, nokta, alt çizgi ve tire kullanılabilir. Baştaki/sondaki boşluklar otomatik temizlenir. Kimlikler büyük/küçük harfe duyarsız olarak benzersiz olmalıdır; örneğin `IG1` ile `ig1` aynı kimlik kabul edilir. `all` değeri “Tümü” işlemi için ayrılmıştır ve node kimliği olarak kullanılmamalıdır.
- `name`: Menüde görünen serbest metindir.
- `address`: IPv4 adresi veya DNS/Windows bilgisayar adıdır.
- `localNames`: İsteğe bağlı Windows bilgisayar adı veya adlarıdır. IP adresi değişken olan (DHCP ya da Wi-Fi ile bağlanan) bilgisayarların tanınmasını sağlar. Aynı adı birden fazla node'a yazmak eşleşmeyi belirsizleştirir; o durumda ayrımı IP eşleşmesi veya `localRoot` varlığı yapar.
- `group`: İsteğe bağlı grup adıdır. Aynı grup adını taşıyan node'lar için menüde tek tıkla o grubun tamamına gönderen bir girdi oluşur. Node kimliğiyle aynı karakterler kullanılabilir (`Unit1` gibi; boşluk yok). Büyük/küçük harf farkı gözetilmez.
- `localRoot`: Bu bilgisayar kaynak olduğunda göreli yol hesabının başlangıcı olan, sürücü harfiyle başlayan mutlak yerel yoldur. Örnek: `E:\Samet`. Bu dizin dışındaki öğeler de tam yolları korunarak kopyalanabilir.
- `localRoots`: Birden fazla kaynak kökü için kullanılan listedir; `localRoot` yerine ya da onunla birlikte verilebilir. Her kök sürücü harfiyle başlayan mutlak bir yoldur. Ayrıntı için [Birden fazla kaynak kökü](#birden-fazla-kaynak-kökü) bölümüne bakın.
- `networkRoot`: Bilgisayar hedef olduğunda kullanılan, paylaşım adıyla başlayan yoldur. `Sim\Samet` değeri `\\IP\Sim\Samet` üretir.
- `enabled`: `false` yapılırsa hedef menüden ve “Tümü” işleminden çıkar.

Uygulama sürümü `version`, üst menü adı `menuTitle`, tüm hedefler seçeneğinin adı `allLabel`, sihirbaz girdisinin adı `wizardLabel`, son ayarla gönderen girdinin adı `wizardLastLabel` alanından değiştirilebilir. `copy.retryCount`, başarısız kopyalama denemelerinin tekrar sayısını; `copy.waitSeconds` ise tekrarlar arasındaki bekleme süresini belirler. İzin verilen aralıklar sırasıyla `0-100` ve `0-60` saniyedir.

## Kurulum

Önerilen yöntem `Install-ContextMenu.bat` dosyasına çift tıklamaktır. BAT dosyası PowerShell betiğini yalnızca bu işlem için `ExecutionPolicy Bypass` ile çalıştırır; bilgisayarın kalıcı PowerShell güvenlik politikasını değiştirmez.

Komut satırından da çalıştırılabilir:

```bat
Install-ContextMenu.bat
```

Merkezi veya farklı bir config kullanılacaksa parametre BAT dosyasına verilebilir:

```bat
Install-ContextMenu.bat -ConfigPath "\\dosya-sunucusu\ProjeConfig\config.json"
```

PowerShell betiğini doğrudan çalıştırmak isterseniz execution policy engeline takılmamak için şu komutu kullanın:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\Install-ContextMenu.ps1"
```

Kurulum yalnızca mevcut kullanıcıya, `HKCU` altında yapılır; yönetici yetkisi gerekmez. Menü yapısını etkileyen config değişikliklerinden sonra kurulum betiğini tekrar çalıştırın. Explorer'ı yeniden başlatmak normalde gerekmez.

Kurulum sistemde Notepad++ 8.4.8 veya üzerini bulursa sekme sağ tık bütünleşmesini de otomatik kurar. Standart kurulumların `%APPDATA%\Notepad++` ayar klasörü ve `doLocalConf.xml` kullanan taşınabilir kurulumlar desteklenir. Mevcut `shortcuts.xml` ve `tabContextMenu.xml` içerikleri silinmez; yalnızca adı `[SamePathCopy]` ile başlayan yönetilen komutlar güncellenir.

Notepad++ kapanırken `shortcuts.xml` ve `config.xml` dosyalarını kendi belleğindeki içerikle yeniden yazar. Bu nedenle kurulumu Notepad++ kapalıyken çalıştırın; açıkken çalıştırdıysanız uygulamayı kapatıp betiği bir kez daha çalıştırın.

### shortcuts.xml bütünlük imzası

Notepad++ 8.9.6.2 ve üzeri, bir kullanıcı komutunu çalıştırmadan önce `shortcuts.xml` dosyasının bütünlüğünü doğrular (CVE-2026-48800). İmza, makine GUID'i anahtarıyla üretilen HMAC-SHA256 değeridir ve `config.xml` içinde `<GUIConfig name="shortcutsXmlHMAC" value="..." />` olarak tutulur. İmza eksik ya da eşleşmiyorsa Notepad++ komutu çalıştırmaz; `shortcuts.xml` dosyasını salt okunur açıp **Security Warning** uyarısını gösterir.

Kurulum ve kaldırma, `shortcuts.xml` dosyasını yazdıktan sonra bu imzayı `config.xml` içinde günceller; ek bir adım gerekmez. İmza yazılamazsa (`config.xml` bulunamaması veya makine GUID'inin okunamaması) betik uyarı verir; bu durumda Notepad++ içinde **Çalıştır (Run) > Validate shortcuts.xml** komutunu bir kez kullanmak yeterlidir.

### Klavye kısayolu atama

Notepad++ komutlarına klavye kısayolu `config.json` içindeki `notepadPlusPlusShortcuts` alanından atanır. Anahtar hedef kimliğidir; tüm hedeflere kopyalayan girdi için `all` kullanılır:

```json
"notepadPlusPlusShortcuts": {
    "wizard:last": "Ctrl+Alt+W",
    "IG1": "Ctrl+Alt+F5"
}
```

Varsayılan yapılandırmada `wizard:last` için `Ctrl+Alt+W` tanımlıdır: Notepad++ içinde `Ctrl+Alt+W`, aktif sekmedeki kaydedilmiş dosyayı **sihirbaz penceresini açmadan**, sihirbazda en son kaydedilen hedef seçimi ve parametrelerle kopyalar. Böylece hedefleri bir kez sihirbazdan seçip sonra tek tuşla göndermek mümkün olur; kopyalama penceresi `Son sihirbaz ayarı` etiketiyle açılır. Bütün hedeflere göndermek isteniyorsa kısayol `all` girdisine bağlanabilir. Değişikliğin etkin olması için kurulumu Notepad++ kapalıyken çalıştırın; kısayol Notepad++ açılışında yüklenir ve **Ayarlar > Kısayol Eşleyici > Run komutları** altında görünür.

Kısayol metni `Ctrl`, `Alt`, `Shift` değiştiricilerini ve tek bir tuşu (`A-Z`, `0-9`, `F1-F24`, `Insert`, `Delete`, `Home`, `End`, `PageUp`, `PageDown`, `Up`, `Down`, `Left`, `Right`, `Space`, `Tab`, `Enter`, `Backspace`, `Esc`) kabul eder. Harf ve rakamlar en az bir değiştirici tuş gerektirir. Tanınmayan tuş, birden fazla tuş veya aynı kısayolun iki hedefe atanması kurulumu hatayla durdurur; menüde bulunmayan bir kimlik yalnızca uyarı üretir.

Kurulum, istenen kısayolun `shortcuts.xml` içindeki başka bir makro/komutla çakışmasını denetleyip uyarır. Notepad++'ın kendi varsayılan kısayolları bu dosyada tutulmadığı için denetlenemez; `Ctrl+Alt+W` Notepad++ 8.9.7 varsayılanlarında boştur (`Ctrl+W` sekmeyi kapatır, `Ctrl+Shift+W` tümünü kapatır).

### Run komutu 260 karakter sınırı

Notepad++, sekme menüsündeki komut satırını `$(FULL_CURRENT_PATH)` gibi değişkenleri açmadan önce 260 karaktere kırpar ve uyarı vermez; kırpılan komut çalıştığında "Cannot find path ... because it does not exist" gibi hatalar görülür. Kurulum bu yüzden komutu kısa tutar: kısa PowerShell anahtarları (`-nop -w hidden -ep bypass -f`) kullanılır ve `-ConfigPath` yalnızca betiğin yanındaki varsayılan `config.json` dışında bir dosya kullanıldığında yazılır. `Queue-SamePathCopy.ps1` çağrısında `-ConfigPath` verilmezse betiğin yanındaki `config.json` kullanılır.

Aracın veya özel config dosyasının yolu yine de sınırı aşacak kadar uzunsa kurulum, bozuk bir menü girdisi yazmak yerine o girdiyi atlar ve uyarı verir. Bu durumda aracı daha kısa bir yola (örnek: `C:\SamePathCopy`) taşıyıp kurulumu yeniden çalıştırın.

Kurulum, `assets\SamePathCopy.ico` dosyasını ana menüye ve hedef alt menülerine bağlar. Araç klasörü paylaşılırken `assets` klasörünü de pakete dahil edin.

Windows 11'de klasik Explorer uzantısı ilk menü yerine **Daha fazla seçenek göster** (`Shift+F10`) altında görüntülenebilir.

Araç klasörünü kurulumdan sonra taşımayın; kayıt defterindeki komut betiğin mevcut tam yolunu kullanır.

## Kullanım

1. Bir veya birden fazla dosya/klasör seçip sağ tıklayın.
2. **SamePathCopy** menüsünü açın. Menü adı `config.json` içindeki `menuTitle` ile değiştirilmişse yapılandırılan adı kullanın.
3. Tek bir bilgisayarı veya **Tümü** seçeneğini seçin.
4. Açılan sonuç penceresinden her hedefin durumunu kontrol edin.

Notepad++ içinde kaydedilmiş bir dosyanın sekmesine sağ tıklayıp **SamePathCopy** alt menüsünden aynı hedefler seçilebilir. İsimsiz, henüz kaydedilmemiş sekmelerin dosya sistemi yolu olmadığı için önce kaydedilmeleri gerekir. Sekmede kaydedilmemiş değişiklik varsa kopyalanan içerik diskteki son kaydedilmiş sürümdür.

`robocopy` dönüş kodu `0-7` başarılı, `8` ve üzeri hatalı kabul edilir. Var olan dosyalar gerektiğinde güncellenir; hedefte olup kaynakta bulunmayan dosyalar silinmez.

Sonuç penceresi diğer uygulamaların üzerinde sabitlenmez; normal bir pencere gibi arkaya alınabilir. SMB paylaşımına erişilemiyorsa veya `robocopy` hata verirse sonuç alanında Windows'un ayrıntılı hata mesajı gösterilir.

Kopyalama penceresi her işlem için tek satır gösterir: soldaki işaret durumu verir (`⋯` sürüyor, `✓` başarılı, `✕` hatalı, `–` atlandı), altında kaynak → hedef yolu, hata ya da yedek bilgisi ek satır olarak eklenir. Üstte ilerleme çubuğu ve `3 / 12` sayacı, altta `N başarılı • N hatalı • süre` özeti durur. `İptal` düğmesi çalışan `robocopy` sürecini durdurur ve kalan hedefleri atlanmış olarak işaretler; `Günlüğü kopyala` bütün satırları panoya alır.

### Robocopy 16 ve erişim reddedildi

`robocopy` kodu `16`, hedef yolun bulunamaması, hatalı kullanım veya yetersiz erişim yetkisi gibi ciddi bir hatayı belirtir. `Hedef SMB paylaşımına erişilemiyor` ya da `Access is denied` görülürse hedef bilgisayarda hem paylaşım izni hem de klasörün NTFS Güvenlik izni kontrol edilmelidir. Kaynak bilgisayardaki kullanıcıya hedef paylaşımda değiştirme/yazma yetkisi verilmelidir.

Gerekirse doğru hedef hesabı Windows Credential Manager'a kaydedin:

```bat
cmdkey /add:10.10.2.182 /user:HEDEF-BILGISAYAR\Kullanici /pass
```

Önceden aynı IP için yanlış kimlik bilgisi kaydedilmişse `cmdkey /delete:10.10.2.182` ile kaldırıp yeniden ekleyin.

## Yapılandırmayı değiştirmeden sınama

Gerçek kopyalama yapmadan hedef yolu görmek için:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\Copy-SamePath.ps1" -SourcePath "C:\ActiveRelease\Data\EntityConfigurations\ModelHeavyIndustry\Ornek300LC.entity" -TargetId all -PlanOnly
```

`PlanOnly` kaynak öğenin varlığını ve yerel bilgisayarın config içindeki bir node ile eşleşmesini doğrular, hesaplanan hedefleri ekrana yazar ve `robocopy` çalıştırmaz. Tek hedefi sınamak için `all` yerine ilgili node kimliğini verin.

## Eşitlik denetimi (-CheckOnly)

"Bu kaynak bütün makinelerde aynı mı?" sorusu için, hedeflere hiçbir şey yazmadan:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\Copy-SamePath.ps1" -SourcePath "C:\ActiveRelease\Data" -TargetId all -CheckOnly
```

Her hedef için bir satır yazılır: `State` sütunu `Ayni`, `Farkli`, `Yok` (hedefte hiç yok), `Erisilemedi` ya da `Hata`; `Changes` / `Missing` / `DestNewer` / `Extras` sütunları sayıları verir (`DestNewer` hedefte kaynaktan daha yeni dosya demektir — kopyalama üzerine yazar). Erişilemeyen hedef için robocopy zaman aşımı beklenmez. Çıkış kodu otomasyon içindir: **0** bütün hedefler aynı, **1** fark/eksik/erişilemeyen var. Durum değerleri, alt süreç çıktısında kod sayfasına takılmaması için ASCII yazılır. Pencere açılmaz; sihirbaz penceresi de açılmaz (hedef kümesi `all`, grup, makine kimliği ya da `profile:<ad>` ile verilir). Aynı denetimin arayüzlüsü sihirbazdaki `Hedefi incele` düğmesidir.

## Geliştirme ve testler

Bütün test takımlarını tek komutla koşturmak için:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tests\Invoke-SamePathCopyTests.ps1"
```

Koşucu her takımı **ayrı bir süreçte** çalıştırır (takımların hepsi `Assert-Equal`'i kendi içinde tanımlıyor ve ortam değişkeni paylaşıyor) ve **üç durum** ayırır:

| Durum | Anlamı |
| --- | --- |
| `geçti` | Takım sıfır çıkış koduyla bitti. |
| `kaldı` | Takım hata verdi ya da zaman aşımına düştü. Son 20 satır çıktısı ekrana yazılır. |
| `atlandı` | Takım bu ortamda **koşulamadı**. Nedeni satırda yazar; bu bir başarısızlık değildir. |

Çıkış kodu yalnızca `kaldı` varsa `1` olur — atlanan takım otomasyonu kırmızıya çevirmez. Takımların günlüğü ve sihirbaz durumu geçici bir klasöre yönlendirilir, böylece `log\root.log` ve kayıtlı sihirbaz ayarınız kirlenmez; tertemiz koşuda o klasör silinir, kalan varsa yolu yazılır.

Ortam gereksinimleri (takımların kodundan okunarak koşucuya yazıldı):

| Takım | Gereksinim |
| --- | --- |
| `Test-CopyRun`, `Test-Destination`, `Test-Queue` | Yönetim paylaşımı: hedefleri `\\127.0.0.1\C$\...` üzerine kuruyorlar, **yükseltilmiş oturum** gerekiyor. |
| `Test-Diff` | Yönetim paylaşımı + etkileşimli masaüstü oturumu (gerçek WPF penceresi açıyor). |
| `Test-Wizard` | Yönetim paylaşımı + masaüstü oturumu + bu makinenin `config.json` içindeki bir node ile eşleşmesi. |
| `Test-NotepadPlusPlusIntegration` | `config.json` ve yerel kimlik. Kurulu Notepad++ **gerekmiyor**: takım kendi sahte kurulumunu geçici klasörde kuruyor. |
| Diğerleri | Yok. |

Anahtarlar:

- `-Only Diff,Queue` — yalnızca verilen takımlar (`Diff`, `Test-Diff` ve `Test-Diff.ps1` aynı şeyi seçer).
- `-SkipUi` — pencere açan takımları atlar (uzak oturum, hızlı denetim).
- `-TimeoutSeconds 900` — takım başına üst sınır; aşan takım öldürülür ve `kaldı` sayılır.

Yeni bir takım eklemek için `tests\Test-<ad>.ps1` yazmak yeterli: koşucu onu kendiliğinden bulur ve gereksinimsiz koşar (satırda `(gereksinim tanımlı değil)` yazar). Ortam gerektiriyorsa koşucudaki `$suiteRequirements` tablosuna bir satır eklenir. Tabloda kalmış ama dosyası silinmiş bir takım varsa koşu sonunda uyarı verilir.

## Kaldırma

`Uninstall-ContextMenu.bat` dosyasına çift tıklayın veya komut satırından çalıştırın:

```bat
Uninstall-ContextMenu.bat
```

Bu işlem Explorer sağ tık kayıtlarını ve Notepad++ içindeki SamePathCopy komutlarını kaldırır; diğer Notepad++ özelleştirmelerini, betikleri, yapılandırmayı veya kopyalanmış dosyaları silmez.

## Lisans

Telif hakkı (C) 2026 Samet Kurumahmut

Bu araç özgür yazılımdır: Özgür Yazılım Vakfı'nın yayımladığı [GNU Genel Kamu Lisansı sürüm 3](../LICENSE) koşulları altında dağıtabilir ve/veya değiştirebilirsiniz. Yararlı olması umuduyla, ancak **hiçbir garanti olmadan** dağıtılır; satılabilirlik ya da belirli bir amaca uygunluk garantisi de dahil değildir. Tam metin için [`LICENSE`](../LICENSE) dosyasına bakın.
