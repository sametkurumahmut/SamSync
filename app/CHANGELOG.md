# Sürüm Geçmişi

## Yayımlanmamış

- **Sıkıştırılmış paket:** röle olarak işaretlenen (SamSync çalışan) bir makineye dosyalar artık tek tek kopyalanmıyor; gönderimin değişiklikleri tek bir sıkıştırılmış paket olarak (`_SamSyncRelay\jobs\<id>.pack`, dosya başına gzip; zip/png/mp4 gibi zaten sıkışık olanlar olduğu gibi) yazılıyor, oradaki SamSync paketi kendi diskine uyguluyor (yedek, kullanımdaki dosya denetimi, doğrulama aynı), sonra grubundakilere dağıtıyor. Ağ üzerinden dosya başına birkaç tur yerine tek akış; bir DLL ~%40, PDB ~%23 boyuta iniyor. Grubunda kimse olmayan bir röle de paketi kendisi için alır. Çalıştırma günlüğünde "Paket: 6,5 MB → 2,6 MB (%40)". Makine yanıt vermezse paket geri alınır ve röle dahil hepsine doğrudan gönderilir.
- **Röle canlılığı:** röledeki SamSync paylaşıma yarım dakikada bir `_SamSyncRelay\alive.json` yazıyor. Hedefler sayfasında rozet "röle açık / röle kapalı" diyor; kalp atışı eski ya da yoksa plan o makineye ve arkasındakilere doğrudan yazıyor, 60 sn beklemiyor.
- **Hızlı gönderimler:** Gönder sayfasındaki listeyi (kaynaklar, hedefler, seçenekler) bir adla kaydet; sonra tek tıkla gönder — Gönder sayfasındaki şeritten, tepsi menüsündeki **Hızlı gönder**'den, komut paletinden ya da `SamSync.exe --quick "ad"` ile (kısayol ya da Görev Zamanlayıcı). "Önce incele" açıksa inceleme açılır. Bu makineye özel (settings.json).
- **Uyanık kal:** bir gönderim sürerken bilgisayar uykuya dalmıyor (ekran kapanabilir); Wi‑Fi üzerinden dakikalar süren PDB gönderimi yarıda kalmıyor.
- **Hız sınaması:** makine kartındaki göstergeyle 3 MB rastgele veri yazılıp geri okunur, silinir; yazma/okuma hızı ve gecikme kartta ve günlükte ("↑0,5 ↓2,1 MB/sn • 180 ms").
- **Röle durumu:** röle olan makinede "Bu makine" kartı rölenin durumunu gösterir: grup, alınan iş sayısı, son işin zamanı ve sonucu.
- **Hedefler:** her makine kartında son gönderimin hızı, süresi ve zamanı ("son gönderim: 1,5 MB/sn • 12 sn • 3 dk önce"); yavaş makine bir bakışta belli.
- **Plan:** pencerenin son 60 sn içinde erişilebilir gördüğü makineye plan sırasında yeniden erişim denetimi yapılmıyor (gönderim başına bir tur daha az).

## 2.0.1 — 2026-10-16

- **Röle (bir makine üzerinden dağıtım):** Hedefler'de bir makine **röle** olarak işaretlenince, onunla birlikte seçilen grup makinelerine dosyalar önce yalnızca ona gider (kendi, çoğu zaman yavaş, bağlantınızdan tek kopya); oradaki SamSync işi paylaşımdaki `_SamSyncRelay` klasöründen alıp dosyaları kendi diskinden grubun ağı üzerinden dağıtır ve sonucu yazar. İnceleme, çalıştırma paneli ve geçmiş her makineyi "X üzerinden" rozetiyle, röleden gelen sonucuyla gösterir. Röle 60 sn içinde işi almazsa (orada SamSync çalışmıyorsa) o makinelere buradan doğrudan ayrı bir gönderim başlar. Tek başına seçilen bir grup makinesi röleye uğramaz; Karşılaştır sayfası ve `--check-only` her makineye doğrudan bakar. `copy.relayAckSeconds` ve `copy.relayTimeoutMinutes` süreleri ayarlar.
- **Hız:** gönderim her dosya için hedefte 8 yerine 3 işlem yapıyor (kopyala, yeniden adlandır; Windows'ta değişiklik zamanı kopyayla geliyor); klasörler bir kez soruluyor; boş alan sorgusu karşılaştırmayla aynı anda yapılıyor. Varsayılan eşzamanlılık: 16 dosya, 8 hedef (en çok 64 / 32); Node dosya iş parçacığı havuzu 32. Yeni izlemelerin bekleme süresi 0,8 sn (en az 0,2 sn).
- **Sağ tık menüsü:** menü artık **SamSyncSend.exe** adlı küçük bir programı başlatıyor; o da komutu çalışan uygulamaya bir boru üzerinden birkaç milisaniyede veriyor (eskiden her tıklama ikinci bir Electron süreci açıyordu, ~1 sn). Uygulama kapalıysa SamSync.exe'yi başlatıyor. Kurulumla ve zip'le gelir; tek dosyalı taşınabilir sürüm kendisini başlatmaya devam eder. İkinci bir SamSync.exe de artık ağır modülleri yüklemeden çıkıyor.
- **Erişim denetimi:** pencere açıkken yapılan düzenli denetim Windows'ta paylaşımın kendisine de bakıyor: 445'e yanıt veren ama paylaşımı vermeyen makine "erişilemiyor" görünüyor ve SMB oturumu açık kalıyor, sonraki gönderim oturum kurmakla vakit kaybetmiyor.
- **Çalıştırma paneli:** gönderim sırasında hız (MB/sn) ve kalan süre; her hedefin yanında kendi hızı, bitince ortalaması. Günlüğe hedef başına boyut, süre ve hız yazılıyor.
- **Kullanımdaki dosya:** 1 MB ve üstü bir dosya hedefte değiştirilecekse önce hedefteki dosya yazma için açılıp deneniyor; bir program (ör. yüklü DLL) tutuyorsa dosya ağ üzerinden hiç taşınmadan, yeniden denemeden "dosya kullanımda… ya da yazma izni yok" hatası veriliyor. Yeniden adlandırmada da aynı açık mesaj (ham EPERM yerine).
- **Otomasyon:** izleme kartlarında **Şimdi gönder** düğmesi. İzlenen yollarda hedeften farklı olanları beklemeden gönderir, izleme kapalıyken de; senkron işi çalıştıran izlemede işi çalıştırır. Yalnızca farklar gider, hedefte bir şey silinmez.

## 2.0.0 — SamSync

Eski PowerShell aracının (1.x) yerine sıfırdan yazılmış, çapraz platform bir masaüstü uygulaması (Electron + React + TypeScript). Eski aracın menüleri, tek tıkla gönderimi ve sihirbaz özellikleri de içindedir.

- **Gönder** — sürükle-bırak, dosya/klasör seçimi ya da yol yapıştırma. Gruplu hedef seçicide arama, erişim noktası, profiller ve “son çalıştırmada hatalılar” var.
  - **Plan:** gönderimden önce her hedef için dosya dosya plan çıkar: yeni / güncellenecek / hedef daha yeni / fazla.
  - **İnceleme:** satır bazında dahil etme, kaynak–hedef satır farkı, seçimi tüm hedeflere uygulama.
  - **Kipler:** üzerine yaz, yalnızca yeni, ayna. Eski sihirbazdaki gibi her hedefe ayrı kip ve yedek ayarı verilebilir.
  - **Karşılaştırma:** tarih+boyut, içerik, boyut.
  - **Sekmeler:** her sekme kendi kaynaklarını ve hedeflerini tutar; sağ tık menüsünden gelen öğeler kendi sekmesinde açılır.
- **Karşılaştır** — Gönder sayfasındaki kaynakları hedeflerle hiçbir şey göndermeden karşılaştırır. Hedef başına yeni / değişen / hedefte daha yeni / fazla dosyalar süzgeç ve aramayla listelenir, seçilen dosyanın satır farkı yanında görünür.
- **Git** — yerel değişiklikler (hazırlanmış, hazırlanmamış, izlenmeyen) ya da seçilen commit'ler (tek, çoklu, aralık; son commit, son 3, push edilmemişler).
  - Commit'lerin dosyaları birleşik bir listede, her dosyanın farkı yanında gösterilir.
  - İçerik diskten ya da commit'ten alınır; silinen ve taşınan dosyalar hedeften de kalkar.
  - Commit içeriği git nesne özetiyle karşılaştırılır.
- **Senkron** — klasör çiftleri: iki yönlü (son durumu hatırlayarak silmeleri ve çakışmaları ayırır), ayna, güncelle, özel. Filtreler, sürümleme, işlem ızgarasında satır bazında değiştirme ve uzak klasör tarayıcı var.
  - **Yok sayma dosyası:** iki tarafın ya da gönderilen klasörün kökündeki `.samsyncignore` desenleri hariç tutulur.
  - **Silinenler:** sürüm klasörüne (sayıyla ve günle sınırlı), yerel klasörlerde Geri Dönüşüm Kutusu'na ya da kalıcı.
  - **İş dosyası:** bir iş `.samsync-job.json` olarak dışa aktarılır ve içe aktarılır.
  - `--sync <iş>` pencere açmadan çalıştırır (çıkış kodu 0 = başarılı).
- **Otomasyon** — canlı izleme ve zamanlanmış senkron.
  - **İzleme:** değişince yalnızca değişenleri gönderir, erişilemeyen makinelere dakikada bir yeniden dener.
  - **Zamanlanmış senkron:** aralıkla ya da belirli saatlerde, tek bir makinede çalışır.
  - Hepsi duraklatılabilir; uygulama sistem tepsisinde çalışmaya devam edebilir ve oturum açılınca gizli başlayabilir.
  - **Git olayları:** commit, amend, merge, pull (isteğe bağlı rebase, cherry-pick, reset) sonrası değişen dosyalar gönderilir; dal değiştirmek bir şey göndermez.
  - **Hedefler:** yapılandırmadaki makineler, yapılandırma gerektirmeyen düz klasörler ya da her değişiklikte çalışan bir senkron işi (canlı senkron).
  - **Ayarlar:** erişilemeyen makinelere yeniden deneme (varsayılan kapalı, aralığı ayarlanır), bildirim, tek gönderimdeki dosya sınırı, kaçırılan zamanlamaların açılışta çalışması.
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
- **Yapılandırma düzenleyici** — config dosyası JSON olarak düzenlenir, yazarken ve kaydederken denetlenir, yazıldığı gibi kaydedilir; başka dosya yüklenebilir, kopyası dışa aktarılabilir.
- **Açılışlar arası** — açık sayfa, Gönder sekmeleri, kaydedilmemiş senkron işi ve Yedekler girişi korunur; kaydedilmemiş ayarlar varken sayfadan çıkmak ya da kapatmak önce sorar.
- **Taşınabilir sürümler** — tek dosyalı exe ve zip; ayarlar ve geçmiş programın yanındaki `SamSync-data` klasöründe durur.
- **Eski yapılandırma** — eski `config.json` doğrudan okunur; kaydederken eski aracın alanları korunur.
  - Makine tanıma kuralları aynıdır (ortam değişkeni `SAMSYNC_NODE_ID`, `<ad>.<USERDNSDOMAIN>` dahil).
  - Grup adları node kimliğiyle aynı karakterlerle sınırlıdır.
- **Otomatik güncelleme** — GitHub Releases, web adresi ya da ağ klasörü. GitHub Actions Windows, macOS ve Linux paketlerini üretir; üçü de geçince sürümü kendisi yayımlar.
- **Görünüm**
  - Türkçe ve İngilizce arayüz; varsayılan olarak bilgisayarın dili izlenir.
  - Koyu (varsayılan), açık ve sistemle eşlenen tema; vurgu rengi; sıkı yoğunluk.
  - Komut paleti (`Ctrl+K`).
