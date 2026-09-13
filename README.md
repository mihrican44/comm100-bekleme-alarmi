# Comm100 Bekleme Alarmı

Comm100 canlı destek **ajan konsolunda** yanıtsız müşteri süresini izleyen Chrome eklentisi. Kaynak **yalnızca sol listedeki** `12s` / `2m` rozetidir. Sağdaki Info oturum süresi (`53 min 43 s`) yok sayılır. Temsilci yanıtlayınca sayaç **0** olur. Eşik aşılınca yüksek siren çalar.

**Günlük kullanım için demo sayfası gerekmez.** Eklentiyi Chrome’a yükleyip paneli açın: [KURULUM.md](KURULUM.md)

## Kurulum (özet)

1. Bu klasörü bilgisayarınıza alın (`manifest.json` bu dizinde olmalı).
2. Chrome’da `chrome://extensions` → **Geliştirici modu** → **Paketlenmemiş öğe yükle**.
3. [Ajan konsolunu](https://dash15.lively-chat.com/agentconsole/) açın, sayfaya bir kez tıklayın.
4. Eklenti simgesinden eşiği ayarlayın.

## Kullanım

- **Sesli uyarı:** aç / kapat
- **Eşik süresi:** varsayılan 120 saniye
- **Ses düzeyi:** varsayılan %100
- **Ses dosyası ekle:** kendi alarmınız (MP3 / WAV / OGG, en fazla 2 MB)
- **Alarmı dene:** test tonu
- **5 dk sessiz:** geçici susturma

Eşik dolana kadar sessizdir. Temsilci yanıtlayınca sol rozet sıfırlanır; eklenti de **0** gösterir ve alarm kesilir.

## Desteklenen zaman biçimleri

Yalnızca sol listedeki kompakt rozetler:

| Biçim | Örnek | Saniye |
| --- | --- | --- |
| `Xs` | `12s` | 12 |
| `Xm` | `2m` | 120 |
| `XmYs` | `2m15s` | 135 |

Yok sayılanlar: Info paneli `53 min 43 s`, mesaj saati `02:01`, sohbet süresi.

## Mimari

| Dosya | Görev |
| --- | --- |
| `manifest.json` | MV3, host izinleri, content script, popup |
| `content.js` | 2 sn tarama, regex parser |
| `alarm.js` | Yüksek siren + özel ses oynatıcı |
| `sounds/alarm.wav` | Dahili uyandırma sireni |
| `background.js` | Varsayılan ayarlar, sekme rozeti |
| `popup.html` / `popup.js` | Eşik, ses düzeyi, dosya yükleme |

Host izinleri: `https://*.lively-chat.com/*`, `https://*.comm100.com/*`, `https://*.comm100app.com/*`.

## Gizlilik

Ayarlar tarayıcıda kalır. Sohbet içeriği dışarı gönderilmez.
