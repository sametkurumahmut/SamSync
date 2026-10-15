# Sürüm Geçmişi

## 2.0.0 — SamSync

Eski PowerShell aracının (1.x) yerine sıfırdan yazılmış, çapraz platform bir masaüstü uygulaması (Electron + React + TypeScript). Eski aracın menüleri, tek tıkla gönderimi ve sihirbaz özellikleri de içindedir.

- **Gönder** — sürükle-bırak, dosya/klasör seçimi ya da yol yapıştırma. Gruplu hedef seçicide arama, erişim noktası, profiller ve “son çalıştırmada hatalılar” var.
  - **Plan:** gönderimden önce her hedef için dosya dosya plan çıkar: yeni / güncellenecek / hedef daha yeni / fazla.
  - **İnceleme:** satır bazında dahil etme, kaynak–hedef satır farkı, seçimi tüm hedeflere uygulama.
  - **Kipler:** üzerine yaz, yalnızca yeni, ayna. Eski sihirbazdaki gibi her hedefe ayrı kip ve yedek ayarı verilebilir.
  - **Karşılaştırma:** tarih+boyut, içerik, boyut.
- **Git** — yerel değişiklikler (hazırlanmış, hazırlanmamış, izlenmeyen) ya da seçilen commit'ler (tek, çoklu, aralık; son commit, son 3, push edilmemişler).
  - Commit'lerin dosyaları birleşik bir listede, her dosyanın farkı yanında gösterilir.
  - İçerik diskten ya da commit'ten alınır; silinen ve taşınan dosyalar hedeften de kalkar.
  - Commit içeriği git nesne özetiyle karşılaştırılır.
- **Senkron** — klasör çiftleri: iki yönlü (son durumu hatırlayarak silmeleri ve çakışmaları ayırır), ayna, güncelle, özel. Filtreler, sürümleme, işlem ızgarasında satır bazında değiştirme ve uzak klasör tarayıcı var.
- **Otomasyon** — canlı izleme ve zamanlanmış senkron.
  - **İzleme:** değişince yalnızca değişenleri gönderir, erişilemeyen makinelere dakikada bir yeniden dener.
  - **Zamanlanmış senkron:** aralıkla ya da belirli saatlerde, tek bir makinede çalışır.
  - Hepsi duraklatılabilir; uygulama sistem tepsisinde çalışmaya devam edebilir ve oturum açılınca gizli başlayabilir.
- **Yedekler** — hedeflerdeki yedek sürümlerini (`_SamSyncYedek`) bulup geri yazar.
  - Explorer ve Notepad++ menüsünden gelen öğeleri bütün makinelerde arar.
  - Eski aracın yedek klasörleri de taranır. Hedef kökünde `_` ile başlayıp yalnızca `yyyyMMdd-HHmmss` klasörleri içeren klasör yedek klasörü sayılır ve ayna kipinde silinmez.
- **Geçmiş** — hedef bazında sonuçlar, hatalar, günlük, yeniden gönderme.
  - Her çalıştırmadan sonra bir CSV rapor kendiliğinden yazılır; son 300 rapor saklanır.
  - Kapalı olan makineler de hatalı sayılır.
- **Explorer menüsü** — kurulumla gelir ve varsayılan olarak açıktır. Eski aracın menüsüyle aynı yapıdadır:
  - tümüne gönder, incele ve gönder, son ayarla gönder, yedekten geri al;
  - profiller, gruplar ve makineler;
  - bölümler arasında ayırıcılar;
  - 16 girdi sınırına göre önce bu makinenin grubu açılır; davranış `menuShowNodes` ile değiştirilebilir.

  Uygulama her açılışta menüyü çalışan programa göre yeniden kurar; kaldırıcı menüyü siler.
- **Notepad++** — sekme sağ tık menüsünde bir “SamSync” klasörü, Çalıştır menüsünde aynı komutlar ve kısayollar (`notepadPlusPlusShortcuts`; varsayılan `Ctrl+Alt+W` = son ayarla gönder).
  - Notepad++ 8.9.6.2'nin istediği `shortcuts.xml` imzası `config.xml` içine yazılır.
  - Notepad++ açıkken değişen ayarlar, Notepad++ kapanınca yeniden yazılır.
  - 260 karakteri aşan komutlar uyarıyla atlanır.
- **Komut satırı**
  - `--to` hedefleri seçer: makine, `group:`, `profile:`, `all`, `last`.
  - `--yes` incelemeden hemen gönderir.
  - `--restore` Yedekler sayfasını öğelerle açar.
  - `--plan-only` ve `--check-only` pencere açmadan çalışır: plan ya da hedeflerin durumu standart çıktıya yazılır. Durumlar `Ayni` / `Farkli` / `Yok` / `Erisilemedi` / `Hata`; çıkış kodu 0 hepsinin aynı olduğunu gösterir.
  - Explorer'ın her öğe için başlattığı süreçler tek gönderimde birleşir.
- **Profiller** — hedeflerle birlikte gönderim seçeneklerini de saklar. Eski sihirbazın profilleri ve son ayarları Ayarlar → Yapılandırma dosyası → *Sihirbaz ayarlarını içe aktar* ile alınabilir.
- **Ayna kipi** — hedeflerde silinecek öğe varsa göndermeden önce toplam sayıyla ayrıca onay istenir. Tek tıkla gönderimde silme varsa doğrudan gönderilmez, inceleme açılır.
- **Yazma** — atomik yazma (geçici dosya + yeniden adlandırma), isteğe bağlı içerik doğrulaması, yeniden deneme, eşzamanlı hedefler ve dosyalar, hedef başına bant genişliği sınırı, iptal, eski yedeklerin temizlenmesi.
- **Kopyalama sonrası komut** — `{source}` son gönderilen öğe, `{destination}` o öğenin hedefteki yoludur.
- **Hedef türleri** — SMB paylaşımı, klasör/bağlı sürücü, SFTP.
- **Eski yapılandırma** — eski `config.json` doğrudan okunur; kaydederken eski aracın alanları korunur.
  - Makine tanıma kuralları aynıdır (ortam değişkeni `SAMSYNC_NODE_ID`, `<ad>.<USERDNSDOMAIN>` dahil).
  - Grup adları node kimliğiyle aynı karakterlerle sınırlıdır.
- **Otomatik güncelleme** — GitHub Releases, web adresi ya da ağ klasörü. GitHub Actions ile Windows, macOS ve Linux paketleri üretilir.
- **Görünüm**
  - Türkçe ve İngilizce arayüz; varsayılan olarak bilgisayarın dili izlenir.
  - Koyu (varsayılan), açık ve sistemle eşlenen tema; vurgu rengi; sıkı yoğunluk.
  - Komut paleti (`Ctrl+K`).
