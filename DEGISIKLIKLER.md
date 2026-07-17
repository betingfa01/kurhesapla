# FA01 Kur Hesaplayıcı — Yapılan İyileştirmeler

Arayüz, hesaplama mantığı, iş akışı ve tüm özellikler birebir aynı bırakıldı. Aşağıdaki değişiklikler sadece performans, uyumluluk, güvenilirlik ve kod kalitesini iyileştirir; hiçbiri görünümü veya sonuçları etkilemez (her biri test edilerek doğrulandı).

## 1. Home Screen / PWA tutarlılığı (asıl talep edilen kısım)

**Sorun:** `manifest.json` tek bir ikon bildiriyordu (`1024x1024` olarak işaretli ama gerçek dosya 1152×912, kare olmayan bir JPEG). Apple touch icon, favicon ya da splash screen tanımı hiç yoktu. Sonuç: iPhone'da ana ekrana eklerken Safari kendi ürettiği bir önizleme/ekran görüntüsünü ikon olarak kullanıyor, açılışta beyaz/boş bir ekran (splash) gösteriyor, Android/Windows/Edge tarafında da bozuk ölçekli bir ikon çıkma riski vardı.

**Çözüm:**
- Mevcut `logo.jpeg`'den (marka/tasarım değişmeden, uygulamadaki `object-fit:cover` ile birebir aynı kırpma mantığıyla) 16 ile 1024 px arası 12 farklı boyutta kare PNG ikon üretildi (`icons/` klasörü).
- Android adaptive icon için 192 ve 512 px'de, logonun güvenli alan içinde kalması amacıyla arka plan rengiyle dolgulu "maskable" ikon varyantları eklendi.
- `manifest.json`'a tüm bu ikonlar + `id`, `scope`, `orientation`, `description` alanları eklendi (isim, renkler, `start_url` değişmedi).
- `index.html`'e `apple-touch-icon`, `favicon`, `apple-mobile-web-app-*` meta etiketleri ve Windows/Edge için `msapplication-TileImage` eklendi → artık iPhone Safari, Android Chrome, Windows Chrome, macOS Safari ve Edge'de **aynı ikon**.
- iOS için 14 farklı cihaz çözünürlüğünde (iPhone SE'den 16 Pro Max'e, iPad 9.7"den Pro 12.9"a) marka rengi + ortalanmış logo içeren splash ekranları üretildi (`splash/`) ve doğru `media` sorgularıyla bağlandı → artık açılışta beyaz flaş yok, her cihazda aynı splash görünüyor.

## 2. API güvenilirliği (otomatik yedekleme)

- Döviz kuru için tek kaynak vardı (`open.er-api.com`). Bu kaynak çökerse uygulama doğrudan "son kayıtlı kur" moduna düşüyordu. Şimdi bu kaynak başarısız olursa **sessizce** ikinci bir sağlayıcıya (`frankfurter.app`) geçiliyor; birincisi çalıştığında rakamlar birebir aynı, sadece arıza anında ek bir güvenlik ağı var.
- Kripto tarafındaki mevcut OKX → CoinGecko yedekleme mantığı aynen korundu.
- Döviz ve kripto istekleri artık **paralel** atılıyor (önceden sırayla bekleniyordu) → normal koşullarda güncelleme neredeyse yarı sürede tamamlanıyor, başarı/başarısızlık kuralı ("ikisi de tutmalı") değişmedi.
- Cihaz internete yeniden bağlandığında (`online` event) veya uygulama uzun süre arka planda kaldıktan sonra öne geldiğinde, son deneme üzerinden yeterli süre geçtiyse otomatik bir tazeleme denemesi tetikleniyor (en fazla 5 dakikalık normal döngü kadar sık; spam yok). Bu, "uygulamayı açtım ama kur eskiymiş" şikayetini azaltır.

## 3. Gerçek hata/kusur düzeltmeleri

- **Service worker eski önbellekleri hiç silmiyordu.** Sürüm numarası değiştikçe eski `caches` kayıtları cihazda birikip yer kaplıyordu. `activate` olayı eklenerek eski önbellekler otomatik temizleniyor.
- **Yarış durumu:** Kullanıcı "KURLARI YENİLE" butonuna basarken, arka plandaki 5 dakikalık otomatik yenileme aynı anda tetiklenirse iki istek çakışabiliyor, buton durumu ve gösterilen kur birbirini eziyordu. Artık tek seferde yalnızca bir güncelleme çalışabiliyor (`isUpdating` kilidi).
- **Safari özel gezinme uyumluluğu:** `localStorage` çağrıları hiç `try/catch` içinde değildi. Safari'nin gizli/özel modunda veya depolama kısıtlı bazı ortamlarda `localStorage` erişimi hata fırlatabilir; bu durumda sayfa yüklenir yüklenmez tüm uygulama sessizce çöküyordu (JS hatası → hiçbir şey çalışmıyordu). Artık tüm depolama erişimleri güvenli şekilde sarmalandı; depolama çalışmasa bile uygulama normal çalışmaya devam ediyor (sadece "son kayıtlı kur" özelliği o oturumda pasif kalıyor).
- **Servis çalışanı çapraz-kaynak isteklerine karışıyordu:** Eskiden `fetch` olayı *her* isteği (kur API'leri dahil) yakalayıp önbelleğe düşmeye çalışıyordu; bu istekler zaten önbellekte olmadığından işe yaramıyor, sadece gereksiz yük ve bazı Safari sürümlerinde bilinen çapraz-kaynak fetch müdahale sorunlarına açık kapı bırakıyordu. Artık yalnızca aynı kaynaktaki (uygulamanın kendi) dosyalar önbellekleniyor; API istekleri doğrudan ağa gidiyor.
- **Kullanılmayan CSS kuralları** (`.rates`, `.rate`, `.rate small`, `.rate b`) kaldırıldı — HTML'de bu sınıflara sahip hiçbir öğe olmadığı doğrulandı, yani görünümde sıfır etki var, sadece gereksiz kod temizlendi.

## 4. Performans / daha hızlı yükleme

- CSS ve JS, `index.html` içinden ayrı `style.css` ve `app.js` dosyalarına taşındı → tarayıcı bunları bağımsız olarak önbellekleyebiliyor, gelecekteki güncellemelerde tüm sayfa yeniden inmek zorunda kalmıyor.
- API alan adlarına `preconnect`/`dns-prefetch` eklendi → ilk istekteki DNS/TLS gecikmesi azaltıldı.
- Logo görseli `preload` edildi ve `<img>` etiketine `width`/`height` eklendi → ilk boyamada (LCP) gecikme ve düzen kayması (layout shift) azaldı.
- Servis çalışanı kaydı artık `window.load` olayına ertelendi; ilk sayfa yüklemesiyle yarışmıyor.
- `sw.js` içinde `skipWaiting` + `clients.claim` eklendi → güncellenen sürüm bir sonraki açılışta değil, hemen devreye giriyor (daha hızlı "refresh").

## 5. Mobil / Safari uyumluluğu

- `viewport-fit=cover` + `env(safe-area-inset-*)` dolgu eklendi → çentikli iPhone'larda içerik çentik/alt çubuk altında kalmıyor.
- `-webkit-tap-highlight-color`, `-webkit-appearance` sıfırlamaları eklendi → iOS Safari'de dokunuşta gri highlight/varsayılan native görünüm farkı gideriliyor (tasarım değişmiyor, sadece tutarlılık).
- `touch-action:manipulation` ile buton üzerindeki 300ms dokunma gecikmesi kaldırıldı.

## Değişmeyenler (bilerek dokunulmadı)

- Tüm hesaplama formülleri, ID'ler, metinler, renkler, düzen — birebir aynı (otomatik test ile doğrulandı).
- API endpoint'leri aynı (yalnızca dövizde arızi durum için ek bir yedek eklendi).
- `KURLARI YENİLE` butonu, 5 dakikalık otomatik döngü, durum mesajları — aynı.
- GitHub Pages uyumluluğu: tüm yollar hâlâ göreli (`./...`), herhangi bir sunucu/derleme adımı gerekmiyor.

## Dosya yapısı

```
index.html       (güncellendi: ikon/splash/meta etiketleri, CSS/JS ayrıştırıldı)
style.css        (yeni: index.html'den ayrıştırılan stiller)
app.js           (yeni: index.html'den ayrıştırılan, iyileştirilmiş mantık)
manifest.json    (güncellendi: tam ikon seti)
sw.js            (yeniden yazıldı: sürüm temizliği, daha iyi önbellekleme)
logo.jpeg        (değişmedi)
icons/           (yeni: 14 ikon dosyası, mevcut logodan üretildi)
splash/          (yeni: 14 iOS splash ekranı, mevcut logodan üretildi)
```
