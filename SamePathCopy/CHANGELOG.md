# Sürüm Geçmişi

## Yayımlanmamış

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
