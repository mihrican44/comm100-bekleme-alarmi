# Gerçek kullanım (demo değil)

Bu bir Chrome eklentisidir. Demo sayfası sadece test içindir. Günlük işte **kendi Chrome’unuza yükleyip** Comm100 ajan konsolunu açarsınız.

## 1. Klasörü bilgisayara alın

Proje klasörünün içinde `manifest.json`, `content.js`, `popup.html` ve `sounds/` olmalı. Zip indirdiyseniz klasörü açın.

## 2. Chrome’a eklenti olarak yükleyin

1. Chrome’u açın.
2. Adres çubuğuna şunu yazıp Enter’a basın: `chrome://extensions`
3. Sağ üstten **Geliştirici modu**nu açın.
4. **Paketlenmemiş öğe yükle**ye tıklayın.
5. **Bu proje klasörünü** seçin (içinde `manifest.json` görünen dizin).
6. Listede **Comm100 Bekleme Alarmı** görünür. Puzzle parçası ikonundan eklentiyi **sabitleyin**.

Kod güncellenince aynı sayfada eklentinin üzerindeki **Yenile** (dairesel ok) düğmesine basın.

## 3. Gerçek paneli açın

1. [https://dash15.lively-chat.com/agentconsole/](https://dash15.lively-chat.com/agentconsole/) adresine girin ve oturum açın.
2. Konsol sayfasına **bir kez tıklayın** (Chrome sesi kilitlemesin diye).
3. Araç çubuğundaki eklenti simgesine tıklayın.
4. Eşiği ayarlayın (ör. 60 / 90 / 120 sn). İsterseniz kendi MP3/WAV dosyanızı ekleyin.
5. **Alarmı dene** ile sesi kontrol edin.

Müşteri mesajı eşiği aşınca siren çalar. Temsilci yanıtlayınca durur.

## Çalışmazsa

- Konsol sekmesi açık mı? Eklenti yalnızca `lively-chat.com` / `comm100.com` / `comm100app.com` üzerinde tarar.
- Eklentiyi Yenile + konsol sekmesini yenileyin.
- Adres çubuğunun sağında eklenti izni istenirse **İzin ver**in.
- Ses yoksa konsola tıklayıp **Alarmı dene**yin; sistem sesi kısık olmasın.
