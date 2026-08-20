# Sürüm Geçmişi

## Yayımlanmamış

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
