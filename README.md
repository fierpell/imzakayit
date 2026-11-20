# İmzaKayıt

Karşı tarafa tek seferlik link atıp sözleşme imzalatmak, imzalandığı anda da haberdar olup belgeyi elime almak için yazdım. Sıfır harici paketle direkt Node.js (20+) üzerinden ayağa kalkıyor, `localhost` dışında çalıştırınca da otomatik olarak Firebase Hosting + Firestore moduna geçiyor.

Mantığı basit: panelden sözleşmeyi yazıp `/imza/:token` linkini paylaşıyorsun. Karşı taraf imzalayana kadar metni güncelleyebiliyor veya linki iptal edebiliyorsun. İmza ekranında ister çizimli ister yazılı imza ve opsiyonel 6 haneli PIN var. İmza atıldığı anda link dışarıya kapanıyor (`autoBurnAfterSign`), panel açıksa SSE veya `onSnapshot` üzerinden anlık bildirim düşüp imzalı `.html` arşivi direkt bilgisayarına iniyor. İstersen Telegram botu veya webhook da bağlayabiliyorsun. İmzalanan belgelerin değiştirilmediğini `/dogrula` sayfasından SHA-256 ile doğrulayabiliyorsun.

Güvenlik tarafında da boş bırakmadım; yerelde şifreler salted scrypt, oturumlar HMAC-SHA256 imzalı HttpOnly cookie ve rate limiter ile korunuyor. Firebase tarafında ise `firestore.rules` ilk kurulumda tek bir yönetici UID'sine kilitleniyor. Listeleme, silme, oluşturma ve PIN kayıtları sadece yöneticiye açık; karşı taraf sadece token'ını bildiği belgeyi açıp imzalayabiliyor. Yerel veriler ve kişisel Firebase ayarları `.gitignore` ile hariç tutulduğu için repoda hiçbir özel veri yok.

Yerelde çalıştırmak ve testleri koşmak için:

```bash
npm start
npm test
```

Kendi Firebase projene kurmak istersen örnek config dosyasını kopyalayıp bilgilerini girmen yeterli:

```bash
cp public/app/firebase-config.example.js public/app/firebase-config.js
firebase deploy --only firestore,auth,hosting --project PROJE_ID
```

Not: Üretilen imza ve SHA-256 kaydı teknik bütünlük kanıtı içindir, 5070 sayılı kanun kapsamındaki resmi e-İmza yerine geçmez.
