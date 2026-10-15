# Sürüm Geçmişi

## Yayımlanmamış

Eski araçla kalan beş fark kapandı.

- **Hedefe özel ayar** — eski sihirbazın *Yedek al* / *Yalnızca yeni* / *Ayna* sütunları geri geldi. Hedef listesinde her makinenin satırındaki ayar düğmesi o makineye kendi kipini ve yedeğini verir. Ayarlar:
  - satırda rozetle, alt çubukta sayıyla, incelemede hedef kartında görünür;
  - son gönderimle (`--to last`, *Son ayarla gönder*) ve profillerle saklanır;
  - çalıştırmada her hedef kendi yedek ayarıyla yazılır; ayna onayı yalnızca aynalanan hedeflerin silmelerini sayar.

  İzleme oluşturulurken hedefe özel ayna kaldırılır.
- **Pencere açmadan denetim** — `--plan-only` ve `--check-only` (eski `-PlanOnly` / `-CheckOnly`). Hedef başına tablo standart çıktıya yazılır; sütun adları ve durumlar eskisiyle aynıdır (`Ayni` / `Farkli` / `Yok` / `Erisilemedi` / `Hata`). Çıkış kodu 0 = hepsi aynı, 1 = değil ya da hata. Açık bir SamSync penceresinin yanında da çalışır; sonuç `root.log`'a yazılır.
- **Eski yedek klasörleri** — hedef kökünde `_` ile başlayıp yalnızca `yyyyMMdd-HHmmss` klasörleri içeren klasör (eski aracın `_…Yedek` klasörü) yedek klasörü sayılır:
  - kökün tamamı ayna kipinde gönderilirken ya da senkronda aynalanırken silinmez, içine yazılmaz, gönderime katılmaz;
  - Yedekler sayfasında ek kök olarak taranır ve sürümleri geri alınabilir.

  Geri almada klasör ve tarih adı denetlenir; hedef kökünün dışına çıkan bir yol reddedilir.
- **Eski sihirbazdan içe aktarma** — Ayarlar → Yapılandırma dosyası → *Sihirbaz ayarlarını içe aktar*. `%LOCALAPPDATA%` altındaki `wizard-state.json` kendiliğinden bulunur ya da elle seçilir.
  - Son seçim, hedefler ve hedef başına sütunlarla birlikte son gönderim ayarı olur.
  - Profiller yapılandırmaya eklenir; aynı adlı profiller korunur.
  - Bilinmeyen makineler atlanır ve bildirilir.
- **Makine tanıma** — bilgisayar adı etki alanında `<ad>.<USERDNSDOMAIN>` olarak da eşleşir (eski araçtaki gibi).
- **Grup adı denetimi** — grup adı node kimliğiyle aynı karakterlerle sınırlıdır (harf, rakam, `.`, `_`, `-`). Uymayan yapılandırma yüklenmez; Hedefler düzenleyicisi bunu kaydetmeden önce gösterir.

## 2.1.0

Eski aracın sağ tık menüleri ve tek tıkla gönderimi geri geldi; arayüz İngilizce de kullanılabilir.

- **Dil** — Türkçe ve İngilizce. Varsayılan olarak bilgisayarın dili izlenir (Türkçe Windows'ta Türkçe, diğerlerinde İngilizce); Ayarlar → Dil'den değiştirilebilir. Menüler, bildirimler, günlük ve CSV raporu da seçilen dilde yazılır.
- **Explorer menüsü** — kurulumla gelir, varsayılan olarak açıktır. Eskisiyle aynı yapıdadır:
  - tümüne gönder, incele ve gönder, son ayarla gönder, yedekten geri al;
  - profiller, gruplar ve makineler;
  - bölümler arasında ayırıcılar;
  - 16 girdi sınırına göre önce bu makinenin grubunun açılması; `menuShowNodes` ayarı.

  Her açılışta çalışan programa göre yeniden kurulur; kaldırıcı menüyü siler. 2.0.0'daki tek “SamSync ile gönder” girdisi kaldırıldı.
- **Notepad++** — sekme sağ tık menüsünde bir “SamSync” klasörü, Çalıştır menüsünde aynı komutlar ve kısayollar gelir (`notepadPlusPlusShortcuts`; varsayılan `Ctrl+Alt+W` = son ayarla gönder). Notepad++ 8.9.6.2'nin istediği `shortcuts.xml` imzası `config.xml` içine yazılır. Notepad++ açıkken değişen ayarlar, Notepad++ kapanınca yeniden yazılır. 260 karakteri aşan komutlar uyarıyla atlanır.
- **Komut satırı** — `--yes` incelemeden hemen gönderir. `--to last` son incelenen gönderimin hedeflerini ve seçeneklerini kullanır; tek tıkla gönderimler bu son ayarı değiştirmez. `--restore` Yedekler sayfasını öğelerle açar ve bütün makinelerde arar.
- **Çoklu seçim** — Explorer'ın her öğe için başlattığı süreçler türlerine göre ayrı ayrı birleştirilir. Bekleme önce 400 ms sürer, ikinci öğeden sonra 1,2 sn olur, en çok 30 sn bekler. Pencere hazır olmadan gelen istekler kaybolmaz.
- **Profiller** — artık hedeflerle birlikte gönderim seçeneklerini de saklar ve uygular (kip, yedek, filtreler…).
- **Ayna kipi** — hedeflerde silinecek öğe varsa göndermeden önce toplam sayıyla ayrıca onay istenir. Tek tıkla gönderimde silme varsa doğrudan gönderilmez, inceleme açılır.
- **CSV rapor** — her çalıştırmadan sonra kendiliğinden yazılır; son 300 rapor saklanır.
- **Erişilemeyen hedefler** — çalıştırmada hatalı sayılır. Böylece “son çalıştırmada hatalıları seç” ve “hatalılara yeniden gönder” kapalı olan makineleri de kapsar.
- **Kopyalama sonrası komut** — `{source}` son gönderilen öğe, `{destination}` o öğenin hedefteki yoludur (eski araçtaki gibi).
- **Taşınabilir sürüm** — açılışta başlatma ve menüler artık geçici klasörü değil, taşınabilir exe'nin kendisini gösterir.

## 2.0.0 — SamSync

Eski PowerShell aracının (1.x) yerine, sıfırdan yazılmış çapraz platform masaüstü uygulaması (Electron + React + TypeScript).

- **Gönder** — sürükle-bırak, dosya/klasör seçimi ya da yol yapıştırma; gruplu hedef seçici (arama, erişim noktası, profiller, “son çalıştırmada hatalılar”). Gönderimden önce her hedef için dosya dosya plan: yeni / güncellenecek / hedef daha yeni / fazla; satır bazında dahil etme, kaynak–hedef satır farkı, seçimi tüm hedeflere uygulama. Kipler: üzerine yaz, yalnızca yeni, ayna. Karşılaştırma: tarih+boyut, içerik, boyut.
- **Git** — yerel değişiklikler (hazırlanmış, hazırlanmamış, izlenmeyen) ya da seçilen commit'ler (tek, çoklu, aralık; son commit, son 3, push edilmemişler). Commit'lerin dosyaları birleşik listede, her dosyanın farkı yanında. İçerik diskten ya da commit'ten; silinen/taşınan dosyalar hedeften de kalkar; commit içeriği git nesne özetiyle karşılaştırılır.
- **Senkron** — klasör çiftleri: iki yönlü (son durumu hatırlayarak silmeleri ve çakışmaları ayırır), ayna, güncelle, özel. Filtreler, sürümleme, işlem ızgarasında satır bazında değiştirme, uzak klasör tarayıcı.
- **Otomasyon** — canlı izleme (değişince yalnızca değişenleri gönderir, erişilemeyen makinelere dakikada bir yeniden dener) ve zamanlanmış senkron (aralıkla ya da belirli saatlerde, tek bir makinede). Hepsini duraklatma, sistem tepsisinde çalışmaya devam etme, oturum açılınca gizli başlama.
- **Yedekler** — hedeflerdeki yedek sürümlerini (`_SamSyncYedek`) bulma ve geri yazma.
- **Geçmiş** — hedef bazında sonuçlar, hatalar, günlük, CSV rapor, yeniden gönderme.
- Atomik yazma (geçici dosya + yeniden adlandırma), isteğe bağlı içerik doğrulaması, yeniden deneme, eşzamanlı hedefler ve dosyalar, hedef başına bant genişliği sınırı, iptal, kopyalama sonrası komut, eski yedeklerin temizlenmesi.
- Hedef türleri: SMB paylaşımı, klasör/bağlı sürücü, SFTP.
- Eski `config.json` doğrudan okunur, kaydederken eski aracın alanları korunur; makine tanıma kuralları aynıdır (ortam değişkeni `SAMSYNC_NODE_ID`).
- Explorer sağ tık menüsü (100 öğeye kadar, tek pencerede toplanır), komut satırı (`--to group:...`), komut paleti (`Ctrl+K`).
- Otomatik güncelleme: GitHub Releases, web adresi ya da ağ klasörü. GitHub Actions ile Windows, macOS ve Linux paketleri.
- Koyu (varsayılan), açık ve sistemle eşlenen tema; vurgu rengi; sıkı yoğunluk.
