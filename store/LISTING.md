# Chrome Web Mağazası gönderim rehberi

Bu dosyadaki metinler Chrome Web Store Developer Dashboard'daki alanlara olduğu gibi yapıştırılmak için hazırlandı.

**Yüklenecek paket:** `dist/istima-1.0.1.zip` (`cd tools && npm run package` ile yeniden üretilir)
**Görseller:** `store/images/` (`npm run screenshots && npm run assets` ile yeniden üretilir)

---

## 1. Paket (Package)

Dashboard → **Add new item** → `dist/istima-1.0.1.zip` dosyasını yükleyin.

## 2. Mağaza girişi (Store listing)

| Alan | Değer |
|---|---|
| Dil | Türkçe (varsayılan, `default_locale: tr`). İngilizce açıklama `_locales/en` içinde; isterseniz İngilizce girişi de aşağıdaki metinle doldurun. |
| Kategori | **Erişilebilirlik (Accessibility)** |
| Ad ve özet | Paketten otomatik gelir (`İstima – Türkçe Haberleri Sesli Dinle`) |
| Simge | Paketten gelir (`icons/icon-128.png`) |
| Ekran görüntüleri (1280×800) | `store/images/screenshot-1-dinle.png` … `screenshot-5-dogru-okuma.png` (bu sırayla) |
| Küçük tanıtım kutucuğu (440×280) | `store/images/promo-small-440x280.png` |
| Büyük tanıtım görseli (1400×560) | `store/images/promo-marquee-1400x560.png` |
| Resmî URL / Ana sayfa | `https://istima.ubeydgencer.com` |
| Destek URL'si | `https://github.com/ubeydgencer/istima/issues` |

### Ayrıntılı açıklama (Türkçe)

```
Haberleri okumayın, dinleyin.

İstima, gezdiğiniz sitelerdeki Türkçe haberleri tek tıkla doğal bir sesle okur. Yapay zekâ sesi tamamen bilgisayarınızda üretilir: sunucu yok, hesap yok, takip yok.

NASIL ÇALIŞIR
• Bir haber açın ve araç çubuğundaki İstima simgesine tıklayın (ya da Alt+Shift+D'ye basın); ses birkaç saniye içinde başlar.
• İsterseniz “Haberleri otomatik bul” seçeneğini açın: Türkçe bir haber açtığınızda köşede “Haberi dinle” düğmesi kendiliğinden belirir.
• Okunan paragraf sayfada vurgulanır, sayfa okunan yeri takip eder.
• Sekme değiştirseniz de okuma sürer; araç çubuğundaki İstima simgesinden kontrol edin.

ÖZELLİKLER
• Her sitede çalışır: haberi sayfadan kendisi ayıklar, menü, reklam ve yorumları atlar.
• Sayıları, tarihleri, saatleri, para birimlerini ve kısaltmaları Türkçe okunuşlarıyla seslendirir (“1.250,75 TL”, “29 Ekim 1923”, “TBMM”).
• İki ses modeli: Antalia-2 Mini ve EMA Lightning; ayarlardan seçin.
• 0,8× ile 1,75× arasında altı hız; hızlandırınca ses incelmez.
• Önceki / sonraki paragraf, ilerleme çubuğundan atlama, Alt+tık ile istediğiniz paragraftan başlama.
• Seçili metni sağ tıkla “Seçili metni İstima ile dinle”.
• Klavye kısayolları: Alt+Shift+D başlat/duraklat, Alt+Shift+← → paragraf atla, Alt+Shift+X durdur.
• Açık ve koyu tema, Türkçe ve İngilizce arayüz.
• İstediğiniz sitelerde düğmeyi gizleme, otomatik okuma, başlığı okuma gibi ayarlar.

GİZLİLİK
İstima metni hiçbir sunucuya göndermez. Ses modeli eklentinin içinde gelir ve WebAssembly ile doğrudan tarayıcınızda çalışır. Kişisel veri, analitik, çerez veya reklam yoktur. Seslendirme internet bağlantısı olmadan da çalışır.

AÇIK KAYNAK
İstima Apache-2.0 lisanslı açık kaynaktır: https://github.com/ubeydgencer/istima
Ses, açık kaynak Antalia-2 Mini modeliyle üretilir. Ses sentetiktir; gerçek bir kişiye ait değildir.
```

### Detailed description (English)

```
Don't read the news. Listen to it.

İstima reads Turkish news articles on the sites you visit in a natural voice, with one click. The AI voice runs entirely on your computer: no server, no account, no tracking.

HOW IT WORKS
• Open an article and click the İstima toolbar icon (or press Alt+Shift+D); speech starts within seconds.
• Optionally turn on “Find articles automatically” and a “Listen” button appears in the corner of every Turkish article.
• The paragraph being read is highlighted and the page follows along.
• Switch tabs and reading continues; control it from the İstima toolbar icon.

FEATURES
• Works on any site: extracts the article and skips menus, ads and comments.
• Reads numbers, dates, times, currencies and abbreviations the way they are said in Turkish.
• Six speeds from 0.8× to 1.75× without chipmunk pitch.
• Previous / next paragraph, seek from the progress bar, Alt-click any paragraph to start there.
• Right-click any selected text: “Listen to selection with İstima”.
• Shortcuts: Alt+Shift+D start/pause, Alt+Shift+← → skip, Alt+Shift+X stop.
• Light and dark themes, Turkish and English interface.

PRIVACY
İstima never sends text anywhere. The speech model ships inside the extension and runs in your browser with WebAssembly. No personal data, analytics, cookies or ads. Speech works offline.

OPEN SOURCE
Apache-2.0: https://github.com/ubeydgencer/istima
Speech comes from the open-source Antalia-2 Mini model. The voice is synthetic, not a real person's.
```

## 3. Gizlilik uygulamaları (Privacy practices)

### Tek amaç (Single purpose)

```
İstima tek bir iş yapar: kullanıcının açtığı web sayfasındaki Türkçe haber metnini (veya seçtiği metni) cihaz üzerinde çalışan bir metinden konuşmaya modeliyle sesli okur.
```

### İzin gerekçeleri (Permission justification)

**offscreen**
```
Ses modeli (ONNX Runtime Web, WebAssembly) bir Web Worker'da çalışır ve üretilen ses Web Audio ile çalınır. Service worker'da ses çalınamadığı ve Worker başlatılamadığı için okuma süresince bir offscreen belge (AUDIO_PLAYBACK, WORKERS) kullanılır.
```

**storage**
```
Kullanıcının ayarlarını (okuma hızı, düğmenin konumu, düğmenin gizleneceği siteler, vurgu ve otomatik kaydırma tercihleri) chrome.storage.sync'te ve devam eden okuma oturumunun durumunu chrome.storage.session'da saklamak için.
```

**contextMenus**
```
Sağ tık menüsüne “Seçili metni İstima ile dinle” ve “Bu sayfayı İstima ile dinle” komutlarını eklemek için.
```

**activeTab**
```
Kullanıcı araç çubuğu simgesine, sağ tık menüsüne veya klavye kısayoluna bastığında, eklenti kurulmadan önce açılmış sekmelerde de sayfanın haber metnini okuyabilmek için.
```

**scripting**
```
Eklenti kurulmadan önce açılmış bir sekmede kullanıcı okumayı başlattığında (activeTab ile) metin ayıklayıcı içerik betiğini o sekmeye yüklemek için. Uzak kod çalıştırılmaz; yalnızca paketteki dosyalar yüklenir.
```

**İsteğe bağlı ana makine izni (optional_host_permissions: http://*/*, https://*/*)**

Kurulumda istenmez. Yalnızca kullanıcı ayarlardan “Haberleri otomatik bul” seçeneğini açtığında Chrome'un izin penceresiyle istenir. Panelde gerekçe sorulursa:
```
Bu izin isteğe bağlıdır ve kurulumda istenmez. Kullanıcı ayarlardan “Haberleri otomatik bul” seçeneğini açarsa istenir: İstima belirli bir site listesiyle çalışmadığı için, kullanıcının açtığı herhangi bir haber sayfasında Türkçe haber olup olmadığını cihaz üzerinde tespit edip “Haberi dinle” düğmesini kendiliğinden göstermek için kullanılır. Sayfa içeriği hiçbir sunucuya gönderilmez. İzin verilmezse eklenti activeTab ile, yalnızca kullanıcı simgeye, kısayola veya sağ tık menüsüne bastığında çalışır.
```

### Uzak kod (Remote code)

```
Hayır, uzak kod kullanmıyorum. Tüm JavaScript ve WebAssembly dosyaları (ONNX Runtime Web dahil) pakette bulunur. 'wasm-unsafe-eval' yalnızca paketteki ONNX Runtime WebAssembly modülünü derlemek için CSP'de yer alır.
```

### Veri kullanımı (Data usage)

Hiçbir kutuyu işaretlemeyin: İstima **hiçbir kategoride** kullanıcı verisi toplamaz (kişisel bilgi, sağlık, finans, kimlik doğrulama, kişisel iletişim, konum, web geçmişi, kullanıcı etkinliği, web sitesi içeriği).

> Not: “Web sitesi içeriği” sayfa metnini okusa da **toplamaz**: metin cihazdan çıkmaz, saklanmaz, iletilmez. Google'ın tanımına göre “toplama”, verinin cihaz dışına iletilmesidir.

Aşağıdaki üç beyanı işaretleyin:
- Kullanıcı verilerini onaylanmış kullanım alanları dışında üçüncü taraflara satmıyorum/aktarmıyorum.
- Kullanıcı verilerini öğenin tek amacıyla ilgisi olmayan amaçlarla kullanmıyorum/aktarmıyorum.
- Kullanıcı verilerini kredibilite belirlemek veya borç verme amacıyla kullanmıyorum/aktarmıyorum.

### Gizlilik politikası URL'si

```
https://istima.ubeydgencer.com/gizlilik/
```

## 4. Dağıtım (Distribution)

- Görünürlük: **Herkese açık (Public)**
- Bölgeler: Tüm bölgeler (veya yalnızca Türkiye ve Türkçe konuşulan bölgeler)
- Fiyat: Ücretsiz

> Not: Açıklamada tarayıcı adları listesi, uzun teşekkür/kütüphane listeleri gibi ürünü anlatmayan isim yığınları kullanmayın; Chrome Web Mağazası bunları “anahtar kelime spam'i” sayıp reddediyor (1.0.1 ilk gönderimi bu yüzden reddedildi).

## 5. Yayından sonra

Yayında: https://chromewebstore.google.com/detail/idnhjopkmlgdhipcfplknfdfpkcehhle


Mağaza bağlantısı belli olunca `site/assets/main.js` içindeki `STORE_URL` sabitini doldurun ve siteyi yeniden yayınlayın; “Chrome'a ekle” düğmeleri mağazaya yönlenir.

## Microsoft Edge Eklentileri (isteğe bağlı, ücretsiz)

Aynı zip, aynı metin ve görsellerle https://partner.microsoft.com/dashboard/microsoftedge adresinden gönderilebilir.
