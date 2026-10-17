# Sürüm Geçmişi

## Yayımlanmamış

- **Düzeltme:** veri klasörü (`SAMSYNC_USER_DATA`, taşınabilir sürümün yanındaki `SamSync-data`) tek-örnek kilidinden önce seçiliyor; eskiden kurulu uygulama açıkken başlatılan taşınabilir kopya ya da ekran görüntüsü/duman testi çalıştırması kendini ikinci örnek sanıp pencere açmadan kapanıyordu.
- **Düzeltme:** yardım botu ve çalıştırma paneli çekmeceleri başlık çubuğunun altından başlıyor; Windows'ta pencerenin küçült/büyüt/kapat düğmeleri çekmecenin kendi düğmelerini örtüyordu.

## 2.1.0 — 2026-10-17

- **Yardım botu ve SSS:** başlık çubuğundaki bot düğmesi ya da **F1** bir sohbet çekmecesi açar; "nasıl gönderirim", "röle nedir", "sürümü USB ile götüreceğim" gibi soruları yanıtlar, yanıtın geldiği SSS maddesini ya da README bölümünü gösterir ve ilgili sayfayı açar. Çevrimdışı çalışır: 40 maddelik iki dilli SSS ve uygulamayla gelen README üzerinde Türkçe/İngilizce gövde bulma ve eş anlamlı sözlüğüyle arama. Ayarlar › **Yardım botu**'na bir Claude API anahtarı girilirse (bu makinede şifreli saklanır) serbest sorular belgelerle birlikte Claude'a gider; anahtar yokken ya da hata olursa çevrimdışı yanıt gösterilir. Yeni **Yardım** sayfası: arama kutusu, konu konu açılır SSS, README'den eşleşen bölümler. Komut paletinde *Yardım botuna sor…*.
- **Genel bakış sayfası (Ctrl 1):** uygulama artık bu sayfayla açılıyor. Üstte kutular: makineler (erişilen/toplam, erişilemeyenlerin adı), bugün aktarılan veri ve 14 günlük küçük grafik, son 7 günün hatalı gönderimleri, otomasyon (izleme ve zamanlanmış iş sayısı, duraklatıldıysa), envanter (geride/eksik), varsa röle ve güncelleme. Altta son gönderimler, hızlı gönderimler, izlemeler ve zamanlanmış işler.
- **Ağ görünümü:** genel bakışta bu bilgisayar solda, gruplar sağda birer kutu; her gruba giden çizgi erişilebilirliğe göre renkli (hepsi yeşil, bir kısmı sarı, hiçbiri kırmızı kesikli), röle işaretli ve dağıttığı makinelere kesikli çizgiler. Makineye tıklamak onu gönderim hedefi yapar / çıkarır; bir makineyi başka bir grubun kutusuna sürüklemek grubunu değiştirir (sorarak, yapılandırmaya yazar).
- **Paket dosyası (.samsync-pack):** Gönder sayfasında **Paket yaz** kaynakları makineler yerine tek bir sıkıştırılmış dosyaya yazar (gönderimin dışlamaları ve `.samsyncignore` uygulanır; rölenin paket biçimi + bir dizin). Diskle götürülen sürüm için: dosya hedef makinede SamSync'in Gönder listesine eklenince klasör gibi bir kaynak olur — plan içindekileri hedefle karşılaştırır, yalnızca farklı olanları yazar, ayna fazlalıkları siler, bitince manifest kalır; sonraki ağ gönderimi yine hızlı başlar. Bütün kaynaklar paketse **bu makine** de hedef seçilebilir (kendi diskine doğrudan yazar, röle sayılmaz). Kaynak satırında "paket" rozeti: etiket, dosya sayısı, boyut, kimden, ne zaman.
- **Makine envanteri:** Hedefler sayfasında tablo — satırlar gönderilen klasörler, sütunlar makineler, hücrede o makinedeki sürümün etiketi, zamanı ve boyutu (manifestten). Bir klasörün en yeni hâli ölçüt: ondan eski olanlar "geride" (sarı, saat simgesi), hiç gönderilmemiş olanlar "eksik", erişilemeyen makine kırmızı başlık. Her bitişten sonra kendini yeniler; **Yenile** düğmesi var. Genel bakıştaki Envanter kutusu da buradan beslenir.
- **Yarım kalan büyük dosyaya devam:** 8 MB ve üstü dosyalar hedefte sabit adlı geçici dosyaya yazılır; iptal, kopan bağlantı ya da kapanan uygulama yüzünden yarım kalan dosya bir sonraki gönderimde kaldığı bayttan sürer (önce hedefteki parçanın son 256 KB'ı kaynakla karşılaştırılır; tutmazsa baştan). Günlükte "kaldığı yerden sürüyor (412 MB / 1,2 GB)". **İptal artık dosyanın bitmesini beklemiyor:** akış anında kesilir, parça kalır. 14 günden eski parça silinir.
- **Çalıştırma paneli:** son 60 saniyenin hız grafiği (anlık, tepe, ortalama; 5 sn sıfırsa "bekliyor"), gruplar için "Lab-A 3/5" çipleri. Windows görev çubuğundaki simgede gönderim ilerlemesi dolar; pencere odakta değilken biten gönderim simgeyi yanıp söndürür.
- **Geçmiş:** üstte istatistik şeridi — son 30 günün gönderim sayısı, aktarılan veri ve ortalama hız, hatalı sayısı/yüzdesi, gün gün çubuk grafik (hatalı gün kırmızı; çubuğa tıklayınca liste o güne süzülür), en çok veri alan makineler. **Geri al** düğmesi: yedek alarak yapılmış bir gönderimin değiştirdiği ve sildiği dosyaları o gönderimin yedeklerinden geri getirir, eklediği dosyaları siler (şimdiki hâller de yedeklenir); yedeksiz gönderimde çıkmaz.
- **Karşılaştır: makine ↔ makine.** Kaynak yerine iki makine seçilir (A, B) ve bir klasör: yalnız birinde olanlar, farklı olanlar, hangisinin daha yeni olduğu; dosyaya tıklayınca iki makinedeki hâlinin satır farkı. aynı olması gereken makineler (A ↔ B) arasındaki sapmayı yakalar; hiçbir şey yazılmaz.
- **Zamanlanmış hızlı gönderim:** kaydedilmiş bir gönderim belirli saatlerde ya da her n dakikada bir kendi kendine gider (bu makinede, inceleme açılmadan; değişiklik yoksa bir şey yapmaz). Çipteki kalem ad, kısayol ve zamanlamayı düzenler; Otomasyon sayfasındaki zamanlanmış işler arasında "hızlı gönderim" rozetiyle listelenir, **Şimdi çalıştır** var.
- **Bildirimler (Ayarlar):** gönderim bitince bir web kancasına JSON (durum, etiket, makineler, işlem/bayt sayıları, süre, özet metin) ve/veya Telegram botuyla bir sohbete mesaj; hatalı/kısmi bitişlerde her zaman, başarılılarda isteğe bağlı; başarısız makineler nedenleriyle listelenir; **Sına** düğmesi. Deneme çalıştırmaları bildirilmez.
- **Hata ekranı:** arayüz çökerse boş pencere yerine hatanın metni, **Yeniden yükle**, **Tanı klasörü oluştur** ve **Hatayı kopyala** düğmeleri; yakalanmayan hatalar bir uyarı balonu ve günlük satırı olur (tanı klasörüne girer). Tanı klasörü artık o oturumun günlük satırlarını da içerir.
- **Pencere ve ölçek:** pencerenin boyutu, yeri ve ekranı kaplama durumu bir sonraki açılışta geri gelir (ekran bağlı değilse ortada açılır). **Arayüz ölçeği** %70–175: Ctrl + / Ctrl − / Ctrl 0 ya da Ayarlar › Görünüm; başlık çubuğu düğmeleri de ölçeklenir.
- **Kısayollar:** Ctrl / tüm kısayolların listesi; Ctrl , Ayarlar; Ctrl Enter Gönder sayfasında inceleme açar, incelemede gönderir (Shift ile deneme); Ctrl 1…9 sayfalar (Genel bakış 1). Komut paletindeki ipuçları sayfa sırasını izler.
- **Bu sürümde yeni kartı:** güncellemeden sonraki ilk açılışta o sürümün CHANGELOG bölümü bir kez gösterilir (dosya uygulamayla birlikte gelir); Ayarlar › Hakkında ve komut paletinden yeniden açılır.
- **Hız:** içerik karşılaştırması özetleri (yer, yol, boyut, zaman) `hashcache.json`'da hatırlar; içerikle karşılaştırılan bir gönderim büyük dosyaları kopyalarken özetini de alır, sonraki içerik karşılaştırması o dosyayı ağdan okumaz. Genel bakış dışındaki sayfalar ilk açıldıklarında yüklenir (ilk paket 1,34 MB → 1,12 MB). Çalıştırma günlüğü anında `history/<id>.log` dosyasına akar; bellekte son 2000 satır kalır, geçmiş ayrıntısı dosyadan okur (50 bin satıra kadar).
- **Yayın akışı:** paketlenmiş uygulama her platformda bir kez açılıp penceresinin görüntüsü alınır; boş pencere (bozuk paket) yayını durdurur, görüntü artefakt olarak kalır. Yerelde `npm run smoke`. `scripts/bench-smb-compress.ps1` bir paylaşıma robocopy ile /COMPRESS'li ve /COMPRESS'siz kopya hızını ölçer (uzak makinelere erişim olmadığı için henüz ölçülmedi).

## 2.0.3 — 2026-10-17

- **Manifest ile hızlı karşılaştırma:** her gönderimden sonra hedefin kökünde `samsync-manifest.json` kalır (gönderilen klasörün altındaki her şey: ad, boyut, tarih; kim ne zaman yazdı). Sonraki gönderim hedefi ağ üzerinden klasör klasör gezmek yerine manifestten başlar — önce kökün listesi ve dosyalardan 24 örnek hedefle karşılaştırılır; biri bile tutmazsa (örneğin sürüm diskten kopyalandıysa) eski usul tam tarama yapılır. 7 günden eski manifest kullanılmaz. İncelemede "manifestten" rozeti; Karşılaştır sayfası her zaman doğrudan bakar. Röleye giden paket uygulanınca röle manifesti kendi diskinden yazar.
- **Aynı makineye iki kişi:** gönderim sürerken hedefin kökünde `samsync-lock.json` durur (bilgisayar adı, kullanıcı, gönderimin adı, başlangıç zamanı, sürüm). Başkasının taze kilidi varsa inceleme makine kartında "ahmet yazıyor" rozeti ve açıklaması çıkar, çalıştırma günlüğüne de uyarı düşer; gönderim yine devam eder. 30 dakikadan eski kilit yok sayılır; kilit bitince kaldırılır. Bu dosya ve `samsync-manifest.json` hiçbir zaman gönderilmez, karşılaştırılmaz, aynada silinmez.
- **İnceleme: klasör ağacı.** Gönderim planı artık klasör klasör görünüyor: her klasör satırında dalın sayıları (+yeni ~değişen !hedef daha yeni −silinecek), işlem sayısı ve boyutu; tek çocuklu klasör zincirleri tek satırda ("Models/Vehicle"); ilk düzey açık gelir, tümünü aç/kapat düğmeleri var; klasörün onay kutusu bütün dalı seçer ya da bırakır; arama yaparken eşleşenler hep görünür. Düz liste de duruyor, aradaki geçiş hatırlanıyor.

## 2.0.2 — 2026-10-17

- **Sıkıştırılmış paket:** röle olarak işaretlenen (SamSync çalışan) bir makineye dosyalar artık tek tek kopyalanmıyor; gönderimin değişiklikleri tek bir sıkıştırılmış paket olarak (`_SamSyncRelay\jobs\<id>.pack`, dosya başına gzip; zip/png/mp4 gibi zaten sıkışık olanlar olduğu gibi) yazılıyor, oradaki SamSync paketi kendi diskine uyguluyor (yedek, kullanımdaki dosya denetimi, doğrulama aynı), sonra grubundakilere dağıtıyor. Ağ üzerinden dosya başına birkaç tur yerine tek akış; bir DLL ~%40, PDB ~%23 boyuta iniyor. Grubunda kimse olmayan bir röle de paketi kendisi için alır. Çalıştırma günlüğünde "Paket: 6,5 MB → 2,6 MB (%40)". Makine yanıt vermezse paket geri alınır ve röle dahil hepsine doğrudan gönderilir.
- **Röle canlılığı:** röledeki SamSync paylaşıma yarım dakikada bir `_SamSyncRelay\alive.json` yazıyor. Hedefler sayfasında rozet "röle açık / röle kapalı" diyor; kalp atışı eski ya da yoksa plan o makineye ve arkasındakilere doğrudan yazıyor, 60 sn beklemiyor.
- **Hızlı gönderimler:** Gönder sayfasındaki listeyi (kaynaklar, hedefler, seçenekler) bir adla kaydet; sonra tek tıkla gönder — Gönder sayfasındaki şeritten, tepsi menüsündeki **Hızlı gönder**'den, komut paletinden, `SamSync.exe --quick "ad"` ile (kısayol ya da Görev Zamanlayıcı) ya da sistem geneli bir **kısayol tuşuyla** (örn. Ctrl+Alt+1; uygulama tepsideyken de çalışır). "Önce incele" açıksa inceleme açılır. Bu makineye özel (settings.json).
- **Ayarlar:** Güncellemeler bölümünde **Sürüm notları** düğmesi (GitHub'daki sürüm sayfası); Hakkında bölümünde **Tanılama klasörü oluştur…** — günlükler, yapılandırma, ayarlar ve bir özet (makine, erişim, röle, son çalıştırmalar) tek klasöre kopyalanır, parolalar hariç.
- **README:** `npm run screenshots` ekran görüntülerini demodan iki dilde kendisi alıyor; Hedefler sayfası galeriye eklendi.
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
