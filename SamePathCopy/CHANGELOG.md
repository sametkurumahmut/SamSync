# Sürüm Geçmişi

## Yayımlanmamış

- Sihirbaz ve kopyalama penceresi WPF ile baştan tasarlandı: sistem temasına (açık/koyu) ve Windows vurgu rengine uyan renkler, yuvarlatılmış kart yüzeyleri, özel onay kutusu/düğme/ilerleme çubuğu şablonları ve ince kaydırma çubukları. Ortak tema [SamePathCopy.Ui.ps1](SamePathCopy.Ui.ps1) içinde tanımlanıyor.
- Sihirbaz penceresi: kaynak özeti ve yerel kök bilgisi, grup kolonlu hedef tablosu, canlı `N / M seçili` göstergesi, parametre açıklamalarını gösteren başlık ipuçları. Parametre kolonları tanım listesinden üretiliyor.
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
