# Comm100 Bekleme Alarmı

Manifest V3 Chrome eklentisi. Comm100 / Lively Chat ajan konsolundaki yanıtsız müşteri sürelerini tarar; en uzun bekleme `alarmThresholdSeconds` değerini aşınca tarayıcının Web Audio API’si ile 880 Hz kesikli alarm üretir.

Harici ses dosyası yoktur. Class ve id’ler dinamik olduğu için tarama metin ve aria etiketlerine dayanır.

## Kurulum

1. Bu klasörü bilgisayarınıza alın.
2. Chrome’da `chrome://extensions` sayfasını açın.
3. Sağ üstten **Geliştirici modu**nu açın.
4. **Paketlenmemiş öğe yükle** ile bu dizinini seçin.
5. [Comm100 ajan konsolu](https://dash15.lively-chat.com/agentconsole/) oturumunu açın.
6. Alarmın çalabilmesi için konsola bir kez tıklayın (tarayıcı otomatik oynatma politikası).

## Kullanım

Eklenti simgesine tıklayın.

- **Sesli uyarı:** alarmı açar / kapatır
- **Eşik süresi:** varsayılan 120 saniye (60 / 90 / 120 / 180 kısayolları)
- **Ses düzeyi:** bip yüksekliği
- **Alarmı dene:** 880 Hz test tonu
- **5 dk sessiz:** geçici susturma

Eşik `chrome.storage.sync` üzerinde tutulur. `content.js` değişikliği `chrome.storage.onChanged` ile sayfa yenilenmeden alır.

Temsilci yanıt verdiğinde, sayaç sıfırlandığında veya sohbet kapandığında alarm kesilir.

## Desteklenen zaman biçimleri

| Biçim | Örnek | Saniye |
| --- | --- | --- |
| `mm:ss` | `02:15` | 135 |
| `hh:mm:ss` | `1:02:03` | 3723 |
| `Xm Ys` | `2m 15s` | 135 |
| `Xs` | `45s` | 45 |

## Mimari

| Dosya | Görev |
| --- | --- |
| `manifest.json` | MV3, host izinleri, content script, popup |
| `content.js` | 2 sn tarama, regex parser, Web Audio alarmı |
| `background.js` | Varsayılan ayarlar, sekme rozeti |
| `popup.html` / `popup.js` | Eşik ve durum paneli |

Host izinleri: `https://*.lively-chat.com/*`, `https://*.comm100.com/*`, `https://*.comm100app.com/*`.

İzinler: `storage`, `activeTab`.

## Yerel demo

Eklentiyi Comm100’e yüklemeden tarayıcıyı ve parser’ı denemek için:

```bash
python3 -m http.server 43147 --bind 127.0.0.1
```

Sonra `http://127.0.0.1:43147/demo/` adresini açın. Demo eşik 30 saniyedir; gerçek eklentide varsayılan 120 saniyedir.

## Gizlilik

Ayarlar yalnızca `chrome.storage.sync` içinde tutulur. Sohbet içeriği dışarı gönderilmez.
