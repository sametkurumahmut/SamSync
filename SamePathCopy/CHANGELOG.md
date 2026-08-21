# Sürüm Geçmişi

## Yayımlanmamış

- 16 dosya/klasör seçildiğinde sağ tık menüsünde SamePathCopy görünmüyordu (15'te görünüyordu). Nedeni Windows'un seçim modeli sınırı: komut satırıyla çalışan `Document` fiilleri 15 öğeden sonra gizleniyor. Kurulum girdileri artık `Player` modeliyle yazıyor; sınır **100 öğeye** çıktı (101 ve üstünde Windows yine gizliyor, o durumda klasörü seçmek gerekiyor). Gerçek kabuk menüsü üzerinde doğrulandı: `Document` ile 15 ✓ / 16 ✗, `Player` ile 16 ✓ / 100 ✓ / 101 ✗ — alt menü de 16 seçimde tam doluyor.
- Explorer fiili her seçili öğe için bir kez çalıştırdığı için 16-100 dosyada onlarca süreç başlıyor. Kuyruk toplayıcısı buna göre sağlamlaştırıldı: sabit 3 saniyelik toplama süresi dolduğunda geri kalan süreçler ikinci bir kopyalama penceresi açıyordu; artık yeni istek gelmeyi bırakana kadar bekliyor (çok seçimde 1,2 sn sessizlik, en fazla 30 sn). Kuyruk ayrıca tek çağrıda birden çok yol almayı da destekliyor (kabuk bütün seçimi tek komut satırına dizerse). Yeni test takımı: [tests/Test-Queue.ps1](tests/Test-Queue.ps1) — 16 ayrı çağrının tek kopyalamada toplandığını, hiçbir yolun düşmediğini ve yinelenen yolun tekilleştiğini sınıyor.

- Sihirbazda bilgisayar adına tıklamak, satırın altında o makineye ne gideceğini **dosya dosya** gösteren bir tablo açıyor; tekrar tıklamak kapatıyor. Her satırda git'teki gibi bir işaret (`+` hedefte yok, `~` üzerine yazılacak, `!` hedefteki dosya daha yeni, `-` hedefte fazla), öğeye göre göreli yol, durum metni ve boyut duruyor; işaret ve durum renkli (yeşil / vurgu / uyarı / kırmızı). Liste ilk açılışta `robocopy /L` ile hesaplanıyor (hedefe hiçbir şey yazılmıyor, pencere donmuyor), sonra önbellekten geliyor. Erişilemeyen hedefte robocopy zaman aşımı beklenmiyor. Kalabalık listeler 400 satırda kesiliyor. Kart açılınca o satırın `Hedefte` rozeti de doluyor (`Hedefi incele` düğmesinin yazdığı rozetin aynısı) ve kart görünür alana kaydırılıyor; ayrıntı bölümüne yer açmak için pencere biraz daha büyük açılıyor (1040x780).

- Ayrıntı tablosundaki satırlar varsayılan olarak işaretli; işareti kaldırılan öğe **yalnızca o makinede** kopyalamaya girmiyor. Yol robocopy'ye tam yolla `/XF` (dosyalar; hedefteki fazlalık da olabilir, öyleyse ayna onu silmiyor) ya da `/XD` (klasörler) olarak geçiyor. Klasörün işareti kaldırılınca altındaki satırların kutuları kapanıyor, çünkü onlar da kopyalanmıyor. Düşürülen yollar tek bir robocopy komut satırına sığmak zorunda olduğu için hedef başına toplam uzunluk sınırı var; sınıra gelince neden eklenmediği söyleniyor. Düşürme yalnızca o çalıştırma için geçerli, kayıtlı ayarlara yazılmıyor. Kartta ayrıca `Yenile` ve `Düşürülenleri geri al` düğmeleri var; kaynak listesi ya da hedef parametresi değişince açık kart "Yenile ile güncelleyin" diyor.

- Yeni **karşılaştırma penceresi** (`Karşılaştır ⇄`): solda o makinede etkilenecek öğelerin listesi, sağda seçilen dosyanın kaynak ile hedef arasındaki **satır satır farkı** (eklenen satır yeşil `+`, kalkan satır kırmızı `-`, satır numaraları iki taraf için ayrı). Üstte iki tarafın boyutu ve tarihi yazıyor. Fark LCS ile hesaplanıyor; ortak baş ve son kırpılıyor, uzun değişmeyen bloklar `... N satır aynı` satırına iniyor. İkili, çok büyük, hedefte olmayan ya da okunamayan dosyalarda satır farkı yerine nedeni yazıyor. Pencere yalnızca okuma yapıyor. Ayrıntı tablosundaki her dosya satırının kendi `⇄` düğmesi pencereyi o dosyada açıyor. Katman [SamePathCopy.Diff.ps1](SamePathCopy.Diff.ps1) içinde ve [tests/Test-Diff.ps1](tests/Test-Diff.ps1) ile sınanıyor.

- Sihirbazın filtre kutusu satırları gizlemiyordu: `N / M seçili` göstergesi değişiyor ama tablodan satır düşmüyordu. Satırın denetim listesi `@()` ile diziye çevriliyordu ve bu PowerShell 5.1 sürümünde `List[object]` için "bağımsız değişken türleri eşleşmiyor" hatası veriyor; hata `TextChanged` işleyicisinin içinde sessizce yutulduğu için görünürlük döngüsü hiç çalışmıyordu. Liste artık doğrudan dolaşılıyor.

- Listeleme özeti (`robocopy /L` çıktısı) artık satır dökümü de veriyor ve klasör satırlarındaki dosya sayısını yoldan ayırıyor. robocopy sürecini `System.Diagnostics.Process` başlatıyor (`Start-Process -PassThru` çıkış kodunu güvenilir vermiyor) ve erişilemeyen paylaşımda günlüğe düşen `ERROR nn (0x...)` satırı hata sayılıyor: robocopy o durumda 8'in altında bir kod dönüp her şeyi "yeni" listeliyor.

## 1.3.0

- Kaynak listesi açıkken pencereye dosya bırakılınca liste ekranda asılı kalıyordu: çip yeniden kurulurken görsel ağaçtan çıkarılıyor ama `Popup` kendi penceresinde çizildiği için kapanmıyordu. Kaldırılan çiplerin açılır listesi artık önce kapatılıyor.

- `Son gönderim` çipi tıklanabilir oldu: son 10 çalıştırma CSV raporlarından listeleniyor (tarih, hedef sayısı, başarılı/hatalı/iptal dökümü, kaynak). `Hedefleri seç` o çalıştırmanın hedef kümesini tabloya uyguluyor, `Raporu aç` CSV'yi açıyor. Günlük özeti yoksa ama rapor varsa çip `Geçmiş` etiketiyle yine görünüyor.

- Sihirbazda kaynak listesi artık düzenlenebiliyor: kaynak çipinin açılır listesindeki onay kutusuyla öğe o kopyalamadan düşürülüyor (çip `Kaynak: 7 / 9 öğe` gösteriyor), pencereye sürüklenip bırakılan dosya/klasör listeye ekleniyor. Başlık, yerel kök çipi ve `Hedefi incele` rozetleri yalnızca kalan öğeleri sayıyor; kopyalama sihirbazın döndürdüğü son listeyle yapılıyor. Bütün öğelerin işareti kaldırılırsa kopyalama başlamıyor; değişiklik yalnızca o çalıştırma için geçerli.

- `-CheckOnly` kipi eklendi: hedeflere hiçbir şey yazmadan her hedef için `Ayni` / `Farkli` / `Yok` / `Erisilemedi` / `Hata` durumu ve sayı dökümü (`Changes`, `Missing`, `DestNewer`, `Extras`) yazılıyor. Çıkış kodu 0 = bütün hedefler aynı, 1 = fark var; eğitim öncesi "12 makine senkron mu" denetimi betikten çalıştırılabiliyor. Erişilemeyen hedefte robocopy zaman aşımı beklenmiyor; sihirbazdaki `Hedefi incele` ile aynı inceleme işlevini kullanıyor.

- Sihirbaz tablosuna `Hedefte` kolonu ve `Hedefi incele` düğmesi eklendi: seçili hedeflerde `robocopy /L` çalıştırılıp her satıra durum rozeti yazılıyor — `aynı`, `N değişecek`, `hedefte yok`, `erişilemedi`. Hedefteki dosya kaynaktan daha yeniyse rozet `!` ile uyarı rengine dönüyor (kopyalama üzerine yazar); ipucunda sınıf dökümü duruyor. İnceleme hedefe hiçbir şey yazmıyor, erişilemeyen hedefleri atlıyor. Listeleme özeti artık sınıf dökümü de veriyor (yeni / kaynak daha yeni / hedef daha yeni / boyutu farklı); inceleme mantığı [SamePathCopy.Common.ps1](SamePathCopy.Common.ps1) içinde ve gerçek robocopy ile test ediliyor.

- Sihirbaza `Seç ⌄` menüsü eklendi: `Erişilebilirleri seç` bu menüye taşındı, yanına `Son çalıştırmada hatalıları seç` (en son CSV raporunda hata alan hedefleri işaretler, diğerlerini bırakır) ve `Seçimi ters çevir` geldi. Rapor özetleri [SamePathCopy.Log.ps1](SamePathCopy.Log.ps1) içindeki yeni ayrıştırıcıdan okunuyor; bozuk rapor dosyaları sessizce atlanıyor.

- Pencere başlığındaki kaynak özeti yeniden tasarlandı. `9 kaynak öğe` gibi bir sayı ne kopyalanacağını anlatmıyordu, `... (ilk: <yol>)` satırı ise yalnızca ilk öğeyi gösteriyordu: başlık artık ortak klasörü ve sayı dökümünü veriyor (`C:\...\Data içinden 9 öğe (6 dosya, 3 klasör)`), ayrıntı ise tıklanınca açılan listede duruyor. Liste, öğeleri yerel köke göre gruplayıp her birinin hedefte oluşacak göreli yolunu yazıyor (klasörler `\` ile bitiyor, satır ipucunda tam yol duruyor); hiçbir kökün altında olmayan öğeler ayrı başlıkta toplanıyor. Kalabalık seçimlerde liste 200 satırda kesiliyor, kalan sayı bildiriliyor ve `Yolları panoya kopyala` ile seçimin tamamı panoya alınabiliyor.
- `Yerel kök` çipi birden çok kök tanımlıyken yolu yarıda kesiyordu; artık tek kökte yolu, çok kökte kök sayısını gösteriyor. Tam liste açılır pencerede, her kökün yanında o kökten kaç öğe seçildiğiyle (`3 öğe` / `seçimde yok`) duruyor.
- Aynı iki çip kopyalama penceresinin başlığında da kullanılıyor; geri alma penceresi de aynı özet satırını gösteriyor.
- Göreli yol hesabı tek yere alındı (`Get-SamePathCopySourceRelativePath`): hedef yolu da başlıktaki liste de aynı işlevi kullanıyor, kök dışı öğelerin sürücü adına çevrilmesi tek yerde duruyor.
- Yeni testler: kaynak özeti (başlık metinleri, kök gruplaması, kök dışı öğeler, liste sınırı, pano metni) [tests/Test-Destination.ps1](tests/Test-Destination.ps1) içinde; çiplerin açılır listesi gerçek WPF penceresinde [tests/Test-Wizard.ps1](tests/Test-Wizard.ps1) içinde sınanıyor.

- Sihirbazdaki toplu seçim ikon çiftleri (`☑` / `☐`) tek onay kutusuna indirildi: hem kolon başlıklarında hem grup çiplerinde. Kutu üç durumlu — hepsi işaretli, hiçbiri, karışık — ve basıldığında hepsini işaretler ya da temizler. Satırlar değiştikçe ve filtre uygulandıkça durumu kendini güncelliyor.

- Notepad++ sekme menüsünde gruplar da birbirinden ayırıcıyla ayrılıyor: her grubun önüne bir ayırıcı konuyor, grubun kendi girdisi ile makineleri aynı bölümde kalıyor.
- Notepad++ sekme menüsünde de bölümler ayırıcıyla ayrılıyor (`tabContextMenu.xml` içine `<Item id="0" />` yazılıyor): `Tümü` | sihirbaz girdileri | geri alma | profiller | gruplar | tek makineler.
- Kaldırma, eklenen ayırıcıları da temizliyor: yönetilen girdilerin klasör adı toplanıp o klasördeki `id="0"` girdileri kaldırılıyor (config.json'a ihtiyaç duymadan).

- Explorer menüsündeki 16 öğe sınırı ağacın tamamı için geçerli olduğu ortaya çıktı (alt menü bütçeyi artırmıyor): `Unit3` grubu 17. öğe olduğu için görünmüyordu. Kurulum artık öğe sayısını önceden hesaplıyor ve sığmıyorsa tek makine girdilerini menüye koymuyor, grup girdilerini doğrudan komuta bağlıyor; hangi girdilerin çıkarıldığını yazıyor. Davranış `config.json` içindeki `menuShowNodes` (auto/always/never) alanıyla değiştirilebiliyor.
- Ayırıcılar artık `Tümü`, sihirbaz girdileri ve `Yedekten geri al` arasına da konuyor.
- Explorer menü testi bütçe davranışını da kapsıyor: sığan/sığmayan yapılandırma, `always`, `never`, grupsuz yapılandırma ve geçersiz `menuShowNodes` değeri.

- Explorer menüsünde 16 öğe sınırı yüzünden kırpılan makineler düzeltildi: gruplar artık kendi alt menülerinde duruyor (alt menünün ilk girdisi `<grup> - Tümü`), üst seviyede yalnızca toplu girdiler, gruplar ve gruba ait olmayan makineler kalıyor. Üç setli yapılandırmada görünmeyen `Unit3` IG'leri geri geldi.
- Menü bölümleri ayırıcı çizgiyle ayrılıyor (`CommandFlags = 0x20`): toplu girdiler, profiller, gruplar ve tek makineler arası.
- Explorer menü yapısı için test eklendi ([tests/Test-ExplorerMenu.ps1](tests/Test-ExplorerMenu.ps1)): üst seviye girdi sayısı ve sırası, gruba ait makinelerin alt menüde olması, grup alt menüsündeki toplu girdi ve ayırıcı bayrakları `-WhatIf` çıktısı üzerinden doğrulanıyor.

- Menüye `Yedekten geri al` girdisi eklendi (`-TargetId restore`): seçilen öğenin hedeflerdeki yedekleri taranıyor, her hedef için hangi yedeğin geri yazılacağı penceredeki açılır listeden seçiliyor. Geri almadan önce hedefin mevcut hâli varsayılan olarak yedekleniyor. Yedeği olmayan öğede işlem başlamıyor.
- `config.json` içindeki `copy.postCommand` ile kopyalama sonrası komut çalıştırılabiliyor: hedef başına bir kez, `{address}` `{targetId}` `{targetName}` `{networkRoot}` `{destination}` `{source}` yer tutucularıyla. Zaman aşımı `copy.postCommandTimeoutSeconds` (varsayılan 60 sn); çıktı ve hata günlüğe, sonuç panele yazılıyor. Deneme çalıştırmasında komut çalışmıyor.

- Her kopyalama çalıştırması için CSV rapor yazılıyor (`log\reports\rapor-<tarih-saat>.csv`): hedef, kaynak, hedef yolu, parametreler, sonuç, robocopy kodu, süre ve hata notu. Kopyalama penceresine `Raporu aç` düğmesi eklendi.
- Kopyalama bitince görev çubuğunda bildirim balonu gösteriliyor; sihirbazdaki `Bitince bildirim göster` parametresiyle kapatılabiliyor.

- Ayna artık kör çalışmıyor: kopyalama başlamadan `robocopy /L /MIR` ile hedefte silinecek öğeler listeleniyor, panelde ve günlükte gösteriliyor, toplam silme sayısıyla onay isteniyor. Onay verilmezse hiçbir şey kopyalanmıyor.
- `Deneme çalıştırması` artık ne değişeceğini de listeliyor (kopyalanacak öğe sayısı, hedefte fazla öğe sayısı ve ilk beş yol).
- Hedef paylaşımdaki boş alan kaynak boyutundan küçükse kopyalama öncesi uyarı satırı ekleniyor.

- Kopyalama artık hedefler arasında eşzamanlı çalışıyor: varsayılan olarak 4 bilgisayara aynı anda gönderiliyor (sihirbazdaki `Eşzamanlı hedef` alanından 1-16 arası ayarlanır). Bir hedefin planları kendi içinde sıralı kaldığı için `Ayna` gibi parametreler güvenliğini koruyor; iptal bütün çalışan robocopy süreçlerini durduruyor.
- Kopyalama betiği uçtan uca sınanıyor ([tests/Test-CopyRun.ps1](tests/Test-CopyRun.ps1)): gerçek robocopy ile paralel kopyalama, göreli yol, süzgeç, yedek + temizlik, deneme çalıştırması ve ayna davranışı.
- Hata günlüğü artık hata türünü ve yığın izini de yazıyor; otomatik kapanma kipinde (test/otomasyon) hata penceresi açılmıyor.

- Sihirbaz parametreleri artık yalnızca onay kutusu değil: metin ve sayı alanları da destekleniyor. Eklenenler: hariç dosyalar (`/XF`), hariç klasörler (`/XD`), paket arası bekleme (`/IPG`), yeniden deneme sayısı (`/R`) ve denemeler arası bekleme (`/W`). Yeniden deneme alanları boş bırakılırsa `config.json` değerleri kullanılıyor.
- Yedekler için tutma sınırı eklendi: her başarılı yedekten sonra en yeni `copy.backupKeep` (varsayılan 5, 0 = sınırsız) tarih klasörü kalıyor, eskiler siliniyor. Elle oluşturulmuş klasörlere dokunulmuyor; silinenler panelde ve günlükte görünüyor.

- Sihirbaza profiller eklendi: hedef seçimi ve parametreler bir adla saklanıp tek tıkla geri yüklenebiliyor. Her profil menüde `<ad> (profil)` girdisi olarak görünüyor, komutlara `-TargetId profile:<ad>` olarak geçiyor ve klavye kısayolu bağlanabiliyor.
- Profil adı doğrulaması, büyük/küçük harf farkında aynı profili güncelleme ve bulunmayan profil için kayıtlı profilleri sayan hata mesajı eklendi.
- `-PlanOnly` kipinde hata artık pencere açmıyor; mesajı hata akışına yazıp 1 ile çıkıyor (otomasyon kilitlenmiyor).

- Sihirbaza filtre kutusu eklendi: ad, grup veya node kimliğine göre süzme; süzme sırasında toplu seçim ikonları yalnızca görünen satırlara uygulanıyor, gizli satırların seçimi korunuyor.
- Sihirbaza grup çipleri eklendi: her grup tek tıkla topluca seçilip bırakılabiliyor.
- Sihirbaz açılışında hedeflerin SMB portuna eşzamanlı TCP yoklaması yapılıyor; bilgisayar adının yanındaki nokta erişilebilirliği gösteriyor. `Erişimi sına` yoklamayı yeniliyor, `Erişilebilirleri seç` yalnızca yanıt verenleri işaretliyor.
- Sihirbaz üst satırında günlükten okunan `Son gönderim` özeti gösteriliyor.

- Dosya günlüğü eklendi ([SamePathCopy.Log.ps1](SamePathCopy.Log.ps1)): araç klasörünün altındaki `log\root.log` dosyasına yazılıyor, klasör yazılamıyorsa `%LOCALAPPDATA%` ve `%TEMP%` altına düşülüyor, `SAMEPATHCOPY_LOG` ile yol değiştirilebiliyor.
- Kopyalama panelinde görünen bütün satırlar (hedef, kaynak → hedef, etkin parametreler, yedek yolu, başarılı/hatalı/atlandı durumu, robocopy hata kodu ve ayrıntıları, özet) günlüğe de yazılıyor.
- Ayrıca oturum başlığı, yerel node ve kökler, çözülen hedefler, sihirbaz seçimleri, hesaplanan plan, kuyruk birleştirme, kurulum/kaldırma ve Notepad++ bütünleşmesi kaydediliyor; hatalar yığın konumuyla birlikte düşüyor.
- Günlük satırları çalıştırma kimliği taşıyor (paralel kopyalamalar ayrışıyor), `root.log` 5 MB'ı geçince kaydırılıyor ve günlük yazımı hiçbir koşulda kopyalamayı durdurmuyor.

## 1.2.0

- Menüye `Wizard (son ayar)` girdisi eklendi (`-TargetId wizard:last`): sihirbaz penceresini açmadan, sihirbazda en son kaydedilen hedef seçimi ve parametrelerle kopyalamayı başlatır. Etiketi `wizardLastLabel` alanından değiştirilebilir.
- Notepad++ kısayolu (`Ctrl+Alt+W`) `all` yerine `wizard:last` girdisine bağlandı: tek tuşla, hedef seçmeye uğraşmadan son ayarla gönderim yapılıyor. Kopyalama penceresi bu durumda `Son sihirbaz ayarı` etiketini gösteriyor.
- Son ayarda hiçbir hedef seçili değilse ne yapılacağını söyleyen bir hata veriliyor.

- Sihirbaz ve kopyalama penceresi WPF ile baştan tasarlandı: sistem temasına (açık/koyu) ve Windows vurgu rengine uyan renkler, yuvarlatılmış kart yüzeyleri, özel onay kutusu/düğme/ilerleme çubuğu şablonları ve ince kaydırma çubukları. Ortak tema [SamePathCopy.Ui.ps1](SamePathCopy.Ui.ps1) içinde tanımlanıyor.
- Sihirbaz penceresi: kaynak özeti ve yerel kök bilgisi, grup kolonlu hedef tablosu, canlı `N / M seçili` göstergesi, parametre açıklamalarını gösteren başlık ipuçları. Parametre kolonları tanım listesinden üretiliyor.
- Toplu seçim, kolon başlıklarının altına taşındı: `Gönder`, `Yedek al`, `Yalnızca yeni` ve `Ayna` kolonlarının her biri kendi `☑` / `☐` ikonlarıyla topluca işaretlenip temizlenebiliyor. Metin düğmeler kaldırıldı, açıklamalar ikon ipuçlarında.
- Kopyalama penceresi: durum işaretli günlük satırları (sürüyor/başarılı/hatalı/atlandı), yedek ve hata ayrıntıları alt satır olarak, ilerleme sayacı, süre ve sonuç özeti, `Günlüğü kopyala` düğmesi.
- Kopyalama sırasında `İptal` düğmesi eklendi: çalışan `robocopy` süreci durduruluyor, kalan hedefler atlandı olarak işaretleniyor.
- Menüde `Tümü`'nün ardından `Wizard` girdisi eklendi: hedefler listeden işaretlenerek seçiliyor (varsayılan olarak hepsi işaretli) ve her bilgisayar için parametreler ayrı ayrı veriliyor.
- Bilgisayar başına parametreler: `Yedek al` (hedefteki önceki hâli `_SamePathCopyYedek\<tarih-saat>` altına alır), `Yalnızca yeni` (`/XO`), `Ayna` (`/MIR`, yalnızca klasörlerde ve ek onayla). Bütün hedefler için: `Deneme çalıştırması` (`/L`), `Hızlı kopyalama` (`/MT:8`).
- Sihirbaz ayarları `%LOCALAPPDATA%\SamePathCopy\wizard-state.json` içinde config yoluna göre saklanıyor; pencere son hâliyle açılıyor. Yeni eklenen bilgisayar işaretli gelir, silinen düşer. Yol `SAMEPATHCOPY_WIZARD_STATE` ile değiştirilebilir.
- Sihirbaz etiketi `config.json` içindeki `wizardLabel` alanından değiştirilebiliyor.
- Robocopy argüman üretimi ortak katmana taşındı ve testlendi; yedek klasörü klasör kopyalamalarında dışlanıyor (`/XD`).

## 1.1.3

- Node'lara `localRoots` alanı eklendi: bir bilgisayar birden fazla kaynak kökü tanımlayabiliyor. Kaynak hangi kökün altındaysa göreli yol o köke göre hesaplanıp hedefin `networkRoot` değeri altına yazılıyor; iç içe köklerde en uzun eşleşen kök kullanılıyor. Tek `localRoot` kullanan yapılandırmalar aynen çalışmaya devam ediyor.
- Sonuç penceresi ve `-PlanOnly` çıktısı her öğe için eşleşen kökü gösteriyor; kökler dışındaki öğeler eskisi gibi tam yolunu koruyor.
- Node'lara `group` alanı eklendi. Menüde her grup için o gruptaki bütün makinelere gönderen bir girdi oluşuyor; grup girdisi kendi makinelerinin başında duruyor ve komutlara `-TargetId group:<ad>` olarak geçiyor. Yerel bilgisayar kendi grubunun hedeflerinden de çıkarıldığı için her eğitmen `Unit1` gibi bir girdiyle yalnızca kendi setine gönderiyor.
- İkon artık yalnızca toplu girdilerde (`Tümü` ve gruplar) görünüyor; tek makine girdileri ikonsuz.
- Explorer ve Notepad++ menüleri aynı `Get-SamePathCopyMenuEntries` listesinden üretiliyor; sıra ve etiketler iki menüde birebir aynı.
- `config.json` içindeki 12 `Unit*` node'u kendi grubuna alındı.
- Yerel node tespiti kademeli hâle geldi: `SAMEPATHCOPY_NODE_ID` ortam değişkeni, IP adresi eşleşmesi, bilgisayar adı eşleşmesi ve son ölçüt olarak `localRoot` dizininin bu bilgisayarda var olması. IP eşleşmesi ada göre eşleşmeyi ezdiği için aynı `config.json` bütün bilgisayarlara değiştirilmeden dağıtılabiliyor.
- Çoklu eşleşme hatası hangi ölçütte oluştuğunu ve nasıl çözüleceğini söylüyor.
- `config.json` içindeki üç `Unit*Trainer` node'undan bu bilgisayara ait `localNames` değeri kaldırıldı; kurulum artık `Root` olarak tanınıyor.
- Notepad++ testi beklenen komut sayısını `config.json` içinden hesaplıyor; node listesi değiştiğinde kırılmıyor. Yerel kimlik çözümü için `tests/Test-LocalIdentity.ps1` eklendi.

## 1.1.2

- Notepad++ komutlarına `config.json` içindeki `notepadPlusPlusShortcuts` alanıyla klavye kısayolu atanabiliyor; varsayılan olarak `Ctrl+Alt+W` aktif dosyayı tüm hedeflere kopyalıyor.
- Kısayol metni doğrulanıyor: tanınmayan tuş, birden fazla tuş, değiştiricisiz harf/rakam ve aynı kısayolun iki hedefte kullanılması kurulumu durduruyor; `shortcuts.xml` içindeki mevcut kısayollarla çakışma uyarı veriyor.

## 1.1.1

- Notepad++ 8.9.6.2 ve üzerinde `shortcuts.xml` bütünlük imzası (`config.xml` içindeki `shortcutsXmlHMAC`) kurulum ve kaldırma sonrasında güncelleniyor; sekme menüsünden komut çalıştırırken çıkan **Security Warning** uyarısı ortadan kalkıyor.
- İmza yazılamadığında betik uyarı verip Notepad++ içindeki **Çalıştır > Validate shortcuts.xml** adımını hatırlatıyor.
- Notepad++ açıkken kurulum yapıldığında, uygulama kapanırken değişiklikleri geri yazdığı için betiğin tekrar çalıştırılması gerektiği uyarısı netleştirildi.
- Notepad++ Run komutu 260 karakterde kırpıldığı için bozulan çağrı kısaltıldı: kısa PowerShell anahtarları kullanılıyor ve `-ConfigPath` yalnızca varsayılan dışındaki config dosyaları için yazılıyor. `Queue-SamePathCopy.ps1` içinde `-ConfigPath` isteğe bağlı hâle geldi; verilmezse betiğin yanındaki `config.json` kullanılıyor.
- Komut yine de 260 karakteri aşarsa bozuk girdi yazılmıyor; kurulum o girdiyi atlayıp uyarı veriyor.

## 1.1.0

- Notepad++ 8.4.8 ve üzerindeki sekme sağ tık menüsüne SamePathCopy hedefleri otomatik ekleniyor.
- Kurulum, standart ve taşınabilir Notepad++ ayar konumlarını algılayıp mevcut `shortcuts.xml` ve `tabContextMenu.xml` özelleştirmelerini koruyor.
- Kaldırma işlemi Notepad++ içindeki yalnızca SamePathCopy tarafından yönetilen komutları temizliyor.

## 1.0.0

- İlk paylaşıma hazır sürüm.
- Aynı dizin yapısını farklı yerel ve ağ kökleri arasında koruyarak kopyalama.
- Yerel kök dışındaki kaynaklar için tam yol koruması.
- Çoklu dosya ve klasör seçimi.
- Config tabanlı node yönetimi, sonuç penceresi ve özel context-menu ikonu.
- `Trainer`, `IG1`, `IG2` gibi büyük harf içeren node kimlikleri.
- SMB paylaşımına erişim kontrolü ve ayrıntılı `robocopy` hata mesajları.
- Arkaya alınabilen, sürüm ve işlem sonucunu gösteren kopyalama penceresi.
- README; mevcut menü adı, config yenileme davranışı, PowerShell 5.1 gereksinimi, node alanlarının sınırları ve `PlanOnly` kullanımıyla uyumlu hâle getirildi.
