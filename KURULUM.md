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

1. [https://dash15.lively-chat.com/agentconsole/chats](https://dash15.lively-chat.com/agentconsole/chats) adresine girin ve oturum açın. Sayaç yalnızca bu **sohbet ekranında** çalışır (Agents listesinde değil).
2. Konsol sayfasına **bir kez tıklayın** (Chrome sesi kilitlemesin diye).
3. Araç çubuğundaki eklenti simgesine tıklayın.
4. Eşiği ayarlayın (ör. 60 / 90 / 120 sn). İsterseniz kendi MP3/WAV dosyanızı ekleyin.
5. **Alarmı dene** ile sesi kontrol edin.

Müşteri mesajı eşiği aşınca siren çalar. Temsilci yanıtlayınca sol listedeki sayaç 0 olur; eklenti de 0’a iner ve alarm durur. Sağdaki Info’daki `53 min 43 s` gibi oturum süresi kullanılmaz.

Ses yoksa popup’ta **ses düzeyi %0** olmasın; en az %50 yapıp konsola bir kez tıklayın.

## Çalışmazsa

- Konsol sekmesi açık mı? Eklenti yalnızca `lively-chat.com` / `comm100.com` / `comm100app.com` üzerinde tarar.
- Eklentiyi Yenile + konsol sekmesini yenileyin.
- Adres çubuğunun sağında eklenti izni istenirse **İzin ver**in.
- Ses yoksa konsola tıklayıp **Alarmı dene**yin; sistem sesi kısık olmasın.
